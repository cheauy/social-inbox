const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const { loader } = require('./tenh-seven/harness.cjs');

const load = loader();
const { retainLocalImagePreview } = load('lib/inbox/local-image-preview.ts');
const { withOptimisticRenderKey } = load('lib/inbox/confirm-outgoing-message.ts');

function reconciliation() {
  const source = fs.readFileSync('components/inbox/inbox-view.tsx', 'utf8');
  const ast = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'reconcileOptimisticMessage') declaration = node.getText(ast);
    ts.forEachChild(node, visit);
  })(ast);
  const context = { retainLocalImagePreview, withOptimisticRenderKey, Date };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.reconcileOptimisticMessage;
}

const pending = (id, position) => ({
  id,
  __render_key: id,
  conversation_id: 'chat',
  platform_message_id: id,
  direction: 'outgoing',
  message_type: 'image',
  attachment_url: `blob:${position}`,
  platform_created_at: '2026-10-02T01:38:00.000Z',
  created_at: '2026-10-02T01:38:00.000Z',
  raw_payload: { tenh_client_request_id: id, tenh_media_group: { provider: 'telegram', id: 'batch', position } },
});

const saved = (id, requestId, position) => ({
  id,
  conversation_id: 'chat',
  platform_message_id: `telegram:chat:${101 + position}`,
  direction: 'outgoing',
  message_type: 'image',
  attachment_url: `/stored/${position}`,
  platform_created_at: '2026-10-02T01:39:00.000Z',
  created_at: '2026-10-02T01:39:05.000Z',
  raw_payload: { tenh_client_request_id: requestId, tenh_media_group: { provider: 'telegram', id: 'batch', position } },
});

test('reverse webhook/response arrival confirms each album slot without reorder or time jump', () => {
  const reconcile = reconciliation();
  const firstId = 'optimistic:attachment:first';
  const secondId = 'optimistic:attachment:second';
  const first = saved('stored-first', firstId, 0);
  const second = saved('stored-second', secondId, 1);
  let rows = [pending(firstId, 0), pending(secondId, 1)];
  rows = reconcile(rows, secondId, second, 'blob:1');
  rows = reconcile(rows, firstId, first, 'blob:0');
  assert.deepEqual(Array.from(rows, row => row.id), ['stored-first', 'stored-second']);
  assert.deepEqual(Array.from(rows, row => row.__render_key), [firstId, secondId]);
  assert.deepEqual(Array.from(rows, row => row.platform_created_at), [
    '2026-10-02T01:38:00.000Z',
    '2026-10-02T01:38:00.000Z',
  ]);
  rows = reconcile(rows, secondId, second, 'blob:1');
  assert.equal(rows.length, 2, 'a duplicate late response must not remove a reconciled row');
});

test('client and route carry one exact request id and position per album file', () => {
  const client = fs.readFileSync('components/inbox/inbox-view.tsx', 'utf8');
  const route = fs.readFileSync('app/api/telegram/send-photo/route.ts', 'utf8');
  assert.match(client, /formData\.append\("clientRequestIds", pending\.tempId\)/);
  assert.match(route, /formData\.getAll\("clientRequestIds"\)/);
  assert.match(route, /tenh_client_request_id: clientRequestId/);
  assert.match(route, /position:index/);
});
