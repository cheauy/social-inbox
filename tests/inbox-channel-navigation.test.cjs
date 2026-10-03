const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const file = 'components/inbox/inbox-channel-selector.tsx';
const source = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['navigateInbox', 'buildInboxUrl', 'selectChannel', 'selectSubscription', 'selectAllChannels']); const declarations = [];
function visit(n) { if (ts.isFunctionDeclaration(n) && names.has(n.name?.text)) declarations.push(n.getText(ast)); ts.forEachChild(n, visit); } visit(ast);
function fixture(enabled) {
  const actions = [], context = { pagingEnabled: enabled, searchParams: new URLSearchParams('conversation=chat&channel=old&view=pinned&status=pending'), URLSearchParams,
    startSwitching: fn => fn(), router: { push: href => actions.push(['route', href]) }, window: { history: { pushState: (state, title, href) => actions.push(['history', href]) } },
    setError() {}, setDeniedChannelId() {}, setSwitchingChannelId() {}, setSwitchingLabel() {}, setOpen() {}, isKhmer: false, shortSubscriptionId: id => id,
    accessErrorForChannel: () => 'denied', REMOVED_ACCESS_TITLE: 'removed', REMOVED_ACCESS_DETAIL: '', SUBSCRIPTION_LOCKED_TITLE: 'locked', SUBSCRIPTION_LOCKED_DETAIL: '' };
  vm.createContext(context); vm.runInContext(ts.transpileModule(declarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { actions, context };
}
for (const enabled of [true, false]) test(`channel, workspace and All Channels have one navigation owner; paging=${enabled}`, async () => {
  const d = fixture(enabled); await d.context.selectChannel({ id: 'telegram', name: 'Telegram', accessAllowed: true });
  await d.context.selectSubscription({ businessId: 'workspace-b', subscriptionId: 'sub', key: 'b', accessAllowed: true }); d.context.selectAllChannels();
  assert.equal(d.actions.length, 3); assert.ok(d.actions.every(a => a[0] === (enabled ? 'history' : 'route')));
  const paths = d.actions.map(a => new URL(a[1], 'https://fixture.invalid'));
  assert.equal(paths[0].searchParams.get('channel'), 'telegram'); assert.equal(paths[1].searchParams.get('workspace'), 'workspace-b'); assert.equal(paths[2].search, '');
  for (const url of paths) for (const key of ['conversation', 'view', 'status']) assert.equal(url.searchParams.get(key), null);
  assert.equal(paths[0].searchParams.get('workspace'), null); assert.equal(paths[1].searchParams.get('channel'), null);
});
test('denied channels and workspace groups cannot initiate either navigation path', async () => {
  const d = fixture(true); await d.context.selectChannel({ id: 'denied', accessAllowed: false }); await d.context.selectSubscription({ businessId: 'denied', accessAllowed: false }); assert.equal(d.actions.length, 0);
});
