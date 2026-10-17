const test = require('node:test'), assert = require('node:assert/strict');
const { createInteractionRecorder } = require('./fixtures/inbox-interaction-recorder.cjs');

test('recorder waits for correct data, separates request/React counts and labels mocked frames explicitly', async () => {
  let now = 0, frames = 0, correct = false;
  const recorder = createInteractionRecorder({ clock: () => now, tier: 'mocked_paint', visible: () => true,
    frame: async () => { now += 16; if (++frames === 3) correct = true; } });
  const fetcher = recorder.wrapFetch(async () => { now += 5; return Response.json({ fixture: true }); });
  const result = await recorder.measure('switch channel', () => { void fetcher('/fixture-only'); recorder.onRender('Inbox', 'update', 2); }, () => correct);
  assert.equal(result.tier, 'mocked_paint'); assert.equal(result.requestCount, 1); assert.equal(result.reactCommits, 1);
  assert.equal(result.clickToCorrectDOMMs, 53); assert.equal(result.actualPaintMeasured, false);
  assert.equal(result.clientFetches[0].clientFetchMs, 5); assert.equal(result.serverResponseMs, null); assert.equal(result.providerDeliveryMs, null);
});
test('a paused animation frame cancels on hide and a final-frame stall times out', async () => {
  let visible = true, changed;
  const recorder = createInteractionRecorder({clock:()=>0,tier:'mocked_paint',visible:()=>visible,frame:()=>new Promise(()=>{}),subscribeVisibility:fn=>{changed=fn;return()=>{changed=null;};}});
  const pending=recorder.measure('hide during frame',()=>{},()=>false);
  visible=false;changed();await assert.rejects(pending,/became hidden/);assert.equal(changed,null);
  const stalled = createInteractionRecorder({clock:()=>0,tier:'mocked_paint',visible:()=>true,frame:()=>new Promise(()=>{}),timeoutMs:16});
  await assert.rejects(stalled.measure('correct DOM but paused final frame',()=>{},()=>true),/fixture deadline/);
});
test('recorder rejects hidden tabs and stops a never-correct data result rather than timing a spinner', async () => {
  const hidden = createInteractionRecorder({ visible: () => false });
  await assert.rejects(hidden.measure('hidden', () => {}, () => true), /Foreground/);
  let now = 0;
  const recorder = createInteractionRecorder({ clock: () => now, tier: 'mocked_paint', visible: () => true, timeoutMs: 32, frame: async () => { now += 16; } });
  await assert.rejects(recorder.measure('incorrect rows', () => {}, () => false), /Correct visible data/);
});
