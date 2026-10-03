const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const parsed = ts.createSourceFile('inbox.tsx', fs.readFileSync('components/inbox/inbox-view.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect, setReply, edit, cancelEdit;
function visit(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(parsed) === 'setReply') setReply = n.initializer.arguments[0].getText(parsed);
  if (ts.isCallExpression(n) && n.expression.getText(parsed) === 'useEffect' && n.arguments[0]?.getText(parsed).includes('const drafts = conversationTextDraftsRef.current')) effect = n.arguments[0].getText(parsed);
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'handleEditTelegramMessage') edit = n.getText(parsed);
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'handleCancelTelegramEdit') cancelEdit = n.getText(parsed);
  ts.forEachChild(n, visit);
} visit(parsed);
function fixture() {
  const context = { conversationTextDraftsRef: { current: new Map() }, composerConversationKeyRef: { current: null }, composerDraftRef: { current: { reply: '', quote: null, revision: 0 } },
    liveConversationsRef: { current: [{ id: 'telegram', business_id: 'a' }, { id: 'messenger', business_id: 'b' }] }, resolvedActiveConversationId: null, accessibleBusinessIds: ['a', 'b'], MESSAGE_CACHE_MAX_CONVERSATIONS: 25,
    editingTelegramMessageId: null,
    window: { requestAnimationFrame: fn => fn() }, document: { querySelector: () => ({ focus() {} }) },
    setReplyState() {}, setEditingTelegramMessageId: value => { context.editingTelegramMessageId = value; }, setReplyingToTelegramMessageId() {}, setReplyingToFacebookMessageId: () => { context.composerDraftRef.current.quote = null; }, setSendError() {}, setReplyingToCommentId() {}, };
  vm.createContext(context); vm.runInContext(ts.transpileModule('globalThis.setReply = ' + setReply + ';globalThis.sync = ' + effect + ';' + edit + ';' + cancelEdit + ';globalThis.edit = handleEditTelegramMessage;globalThis.cancelEdit = handleCancelTelegramEdit;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.select = id => { context.resolvedActiveConversationId = id; context.sync(); };
  return context;
}
test('unsent text survives Telegram -> Messenger -> Telegram, while quotes and workspace drafts stay separate', () => {
  const d = fixture(); d.select('telegram'); d.setReply('QA unsent draft audit'); d.composerDraftRef.current.quote = 'private-message';
  d.select('messenger'); assert.equal(d.composerDraftRef.current.reply, ''); assert.equal(d.composerDraftRef.current.quote, null); d.setReply('Messenger draft');
  d.select('telegram'); assert.equal(d.composerDraftRef.current.reply, 'QA unsent draft audit'); assert.equal(d.composerDraftRef.current.quote, null);
  d.select('messenger'); assert.equal(d.composerDraftRef.current.reply, 'Messenger draft');
});
test('same-thread metadata refresh preserves new work, and a sent/cleared draft never resurrects', () => {
  const d = fixture(); d.select('telegram'); d.setReply('typed'); const revision = d.composerDraftRef.current.revision; d.sync();
  assert.equal(d.composerDraftRef.current.reply, 'typed'); assert.equal(d.composerDraftRef.current.revision, revision);
  d.select('messenger'); d.select('telegram'); d.setReply(''); d.select('messenger'); d.select('telegram'); assert.equal(d.composerDraftRef.current.reply, '');
});
test('revoked membership removes its draft and a reused identifier in another workspace cannot recover it', () => {
  const d = fixture(); d.select('telegram'); d.setReply('workspace a text'); d.select('messenger'); d.accessibleBusinessIds = ['b']; d.sync();
  assert.equal(d.conversationTextDraftsRef.current.has('a:telegram'), false);
  d.liveConversationsRef.current = [{ id: 'telegram', business_id: 'b' }, { id: 'messenger', business_id: 'b' }]; d.select('telegram'); assert.equal(d.composerDraftRef.current.reply, '');
});
test('the text-only cache retains at most 25 inactive conversation drafts', () => {
  const d = fixture(); d.liveConversationsRef.current = Array.from({ length: 30 }, (_, i) => ({ id: String(i), business_id: 'a' }));
  for (let i = 0; i < 30; i++) { d.select(String(i)); d.setReply('draft ' + i); }
  assert.equal(d.conversationTextDraftsRef.current.size, 25); assert.equal(d.conversationTextDraftsRef.current.has('a:0'), false);
  assert.ok([...d.conversationTextDraftsRef.current.values()].every(value => typeof value === 'string'));
});

test('editing a sent Telegram message never becomes a new-message draft after A -> B -> A', () => {
  const d = fixture(); d.select('telegram'); d.edit('sent-message', 'edited sent text');
  d.select('messenger'); d.setReply('ordinary Messenger draft'); d.select('telegram');
  assert.equal(d.editingTelegramMessageId, null);
  assert.equal(d.composerDraftRef.current.reply, '', 'edit text must not be restored under ordinary Send mode');
  assert.equal(d.conversationTextDraftsRef.current.has('a:telegram'), false);
  d.select('messenger'); assert.equal(d.composerDraftRef.current.reply, 'ordinary Messenger draft');
});

test('the oldest destination restores before eviction and the active draft is outside the inactive cap', () => {
  const d = fixture(); d.liveConversationsRef.current = Array.from({ length: 26 }, (_, i) => ({ id: String(i), business_id: 'a' }));
  for (let i = 0; i < 26; i++) { d.select(String(i)); d.setReply('draft ' + i); }
  assert.equal(d.conversationTextDraftsRef.current.size, 25); assert.equal(d.conversationTextDraftsRef.current.get('a:0'), 'draft 0');
  d.select('0'); assert.equal(d.composerDraftRef.current.reply, 'draft 0');
  assert.equal(d.conversationTextDraftsRef.current.has('a:0'), false, 'active text belongs only to the composer');
  assert.equal(d.conversationTextDraftsRef.current.size, 25); assert.equal(d.conversationTextDraftsRef.current.get('a:25'), 'draft 25');
  d.select('25'); assert.equal(d.composerDraftRef.current.reply, 'draft 25'); assert.equal(d.conversationTextDraftsRef.current.get('a:0'), 'draft 0');
  d.select('0'); assert.equal(d.composerDraftRef.current.reply, 'draft 0'); assert.equal(d.conversationTextDraftsRef.current.size, 25);
});

test('edit mode metadata updates keep the edit, while canceled edit text can become an ordinary draft', () => {
  const d = fixture(); d.select('telegram'); d.edit('sent-message', 'editing');
  const revision = d.composerDraftRef.current.revision; d.sync(); assert.equal(d.editingTelegramMessageId, 'sent-message'); assert.equal(d.composerDraftRef.current.revision, revision);
  d.cancelEdit(); assert.equal(d.composerDraftRef.current.reply, ''); d.setReply('new ordinary text'); d.select('messenger'); d.select('telegram');
  assert.equal(d.editingTelegramMessageId, null); assert.equal(d.composerDraftRef.current.reply, 'new ordinary text');
});

test('reverse Messenger -> Telegram edit -> Messenger restores only the ordinary draft', () => {
  const d = fixture(); d.select('messenger'); d.setReply('ordinary Messenger text');
  d.select('telegram'); d.edit('sent-message', 'changed sent Telegram text'); d.select('messenger');
  assert.equal(d.composerDraftRef.current.reply, 'ordinary Messenger text'); assert.equal(d.editingTelegramMessageId, null);
  d.select('telegram'); assert.equal(d.composerDraftRef.current.reply, ''); assert.equal(d.editingTelegramMessageId, null);
});
