import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const view = 'components/inbox/inbox-view.tsx';
function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function find(ast, predicate) {
  let found;
  function visit(node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, 'requested production code exists');
  return found.getText(ast);
}
function run(source, context) {
  return vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}
function functions(file, names, context) {
  const ast = parse(file);
  for (const name of names) run(find(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === name), context);
}
const ref = value => ({ current: value });
function setup(isPinned = false) {
  const alerts = [], state = { is_pinned: isPinned, assigned_to: null };
  const context = vm.createContext({
    activeConversation: { id: 'c1', unread_count: 0, ...state },
    teamMembers: [{ id: 'm1', full_name: 'Agent' }], pinning: false, assigning: false,
    showSuccessToast: message => alerts.push(message),
    setLiveConversations: update => update([{ id: 'c1', ...state }]),
    sortLiveConversations: rows => rows,
    console: { error() {} }, router: { refresh() {} },
    Date, Math, window: { setTimeout },
  });
  for (const name of ['readBarrierMessageTimeRef', 'readRowVersionRef', 'persistedManualUnreadCountsRef', 'pinOverrideRef', 'assignmentOverrideRef']) context[name] = ref(new Map());
  for (const name of ['manualUnreadConversationIdsRef', 'unreadWriteInFlightRef', 'readInFlightRef']) context[name] = ref(new Set());
  for (const name of ['setMarkingUnread', 'setPinning', 'setPinError', 'setAssigning', 'setAssignmentError']) context[name] = () => {};
  return { context, alerts };
}

for (const [name, argument, pinned, expected] of [
  ['handleAssignmentChange', 'm1', false, 'Conversation assigned successfully.'],
  ['handleAssignmentChange', 'unassigned', false, 'Conversation unassigned successfully.'],
  ['handleAssignToMe', undefined, false, 'Conversation assigned to you successfully.'],
  ['handleTogglePin', undefined, false, 'Conversation pinned successfully.'],
  ['handleTogglePin', undefined, true, 'Conversation unpinned successfully.'],
  ['handleMarkUnread', undefined, false, 'Conversation marked as unread successfully.'],
]) test(`${expected} only after confirmed success`, async () => {
  for (const success of [true, false]) {
    const { context, alerts } = setup(pinned);
    if (argument === 'unassigned') context.activeConversation.assigned_to = 'm1';
    let finish;
    context.fetch = () => new Promise(resolve => { finish = resolve; });
    functions(view, [name], context);
    const pending = context[name](argument);
    assert.deepEqual(alerts, [], 'optimistic changes are not success');
    finish(new Response(JSON.stringify({ success, error: 'Rejected', conversation: {
      id: 'c1', assigned_to: argument === 'unassigned' ? null : 'm1',
      assigned_at: null, is_pinned: !pinned, unread_count: 1,
    } }), { status: success ? 200 : 400 }));
    await pending;
    assert.deepEqual(alerts, success ? [expected] : [], 'failures must not show success');
  }
});

test('success alerts reuse the existing timer and replace repeated alerts', () => {
  const { context } = setup();
  const timers = [], cleared = [], shown = [];
  Object.assign(context, {
    crypto: { randomUUID: () => String(timers.length) },
    seenActivityToastIdsRef: ref(new Set()), multiAgentToastTimerRef: ref(null),
    setMultiAgentToast: value => shown.push(value),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: id => cleared.push(id),
  });
  functions(view, ['isRecord', 'capitalizeFirst', 'buildMultiAgentToast', 'showMultiAgentToast', 'showSuccessToast'], context);
  context.showSuccessToast('First success');
  context.showSuccessToast('Second success');
  assert.equal(shown.at(-1).activityType, 'success');
  assert.equal(shown.at(-1).message, 'Second success');
  assert.deepEqual(cleared, [1]);
  assert.equal(timers.at(-1).delay, 4500);
  timers.at(-1).callback();
  assert.equal(shown.at(-1), null);
});

test('reminder creation reaches the Inbox success alert only after the server saves it', async () => {
  for (const success of [true, false]) {
    const { context, alerts } = setup();
    Object.assign(context, {
      canSave: true, remindAt: '2099-01-01T10:00', conversationId: 'c1', contactId: 'ct1',
      assignedTo: 'm1', note: 'Follow up', setSaving() {}, setError() {}, setReminderOpen() {},
      window: { dispatchEvent() {} }, CustomEvent: class {},
      fetch: async () => new Response(JSON.stringify({ success }), { status: success ? 200 : 400 }),
    });
    const callback = (file, name) => {
      const ast = parse(file);
      return run(`(${find(ast, node => ts.isJsxAttribute(node) && node.name.text === name).slice(name.length + 2, -1)})`, context);
    };
    context.onReminderCreated = callback(view, 'onReminderCreated');
    context.onCreated = callback('components/inbox/customer-profile.tsx', 'onCreated');
    functions('components/inbox/reminder-modal.tsx', ['readJson', 'createReminder'], context);
    await context.createReminder();
    assert.deepEqual(alerts, success ? ['Reminder created successfully.'] : []);
  }
});
