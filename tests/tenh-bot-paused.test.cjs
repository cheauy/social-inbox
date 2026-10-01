const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const fail = () => { throw Error('Paused Bot must not reach permissions, storage or provider'); };
function pausedLoader() {
  return loader({
    '@/lib/auth/require-permission': { requirePermission: fail },
    '@/lib/supabase/admin': { supabaseAdmin: { from: fail, rpc: fail } },
    '@/lib/subscription/is-operational-subscription': { businessSubscriptionIsOperational: fail },
  }, { fetch: fail, process: { env: { TENH_BOT_EXECUTION_ENABLED: 'true', FACEBOOK_AUTO_REPLY_WORKER_ENABLED: 'true' } } });
}
test('every Bot API method returns Coming Soon even with worker flags enabled', async () => {
  for (const file of ['app/api/tenh-bot/rules/route.ts', 'app/api/tenh-bot/history/route.ts', 'app/api/tenh-bot/human-hold/route.ts', 'app/api/cron/tenh-bot/route.ts', 'app/api/cron/facebook-auto-reply/route.ts', 'app/api/facebook/auto-reply/route.ts']) {
    const route = pausedLoader()(file);
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) if (route[method]) {
      const response = await route[method](new Request('https://fixture.test/api'));
      assert.equal(response.status, 503, file + ':' + method);
      assert.equal((await response.json()).code, 'TENH_BOT_COMING_SOON');
    }
  }
});
test('direct Bot page renders Coming Soon without an administrator bypass', async () => {
  const load = loader({ '@/components/bot/tenh-bot-coming-soon': { TenhBotComingSoon: 'coming-soon' }, '@/components/bot/tenh-bot-workspace': { TenhBotWorkspace: 'configuration' }, '@/lib/auth/require-permission': { requirePermission: fail } });
  assert.equal((await load('app/dashboard/tenh-bot/page.tsx').default()).type, 'coming-soon');
});
test('paused execution and manual-reply hold do not touch storage or providers', async () => {
  const load = pausedLoader(), store = load('lib/bot/execution-store.ts');
  await store.holdBotForManualReply('business', 'conversation');
  await store.noteStoredFacebookBotEvent({ businessId: 'business', conversationId: 'conversation', platformMessageId: 'message' });
  await store.recordStoredBotMessage('message');
  assert.equal((await store.runStoredBotJobs({ supported: fail, execute: fail })).processed, 0);
  assert.equal((await load('lib/bot/worker.ts').runTenhBotWorker()).processed, 0);
  for (const [file, name] of [['facebook-text-transport', 'facebookBotTextTransport'], ['facebook-comment-hide-transport', 'facebookBotCommentHideTransport']]) {
    assert.equal((await load('lib/bot/' + file + '.ts')[name].execute({ kind: 'reply' })).definitiveRejection, true);
  }
  const legacy = load('lib/facebook/auto-reply.ts');
  assert.equal((await legacy.runAutoReplyBatch()).paused, true);
  await legacy.processAutoReplyJob({});
  assert.equal(await legacy.reconcileAutoReplyJob({}), false);
});
