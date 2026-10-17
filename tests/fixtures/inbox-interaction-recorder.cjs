/* Fixture-only recorder. DOM/frame timing is never reported as production/server latency. */
function createInteractionRecorder({ clock, frame, visible, subscribeVisibility, tier, timeoutMs = 10000 }) {
  const requests = [], commits = [], results = [];
  let measuring = false;
  return {
    requests, commits, results,
    onRender(id, phase, actualDuration) { commits.push({ id, phase, actualDuration, at: clock() }); },
    wrapFetch(fetcher) {
      return async (url, options) => {
        const request = { url: String(url), method: options?.method || 'GET', start: clock() };
        requests.push(request);
        try { const response = await fetcher(url, options); request.status = response.status; return response; }
        catch (error) { request.error = error.message; throw error; }
        finally { request.end = clock(); }
      };
    },
    async measure(name, action, correct) {
      if (measuring) throw Error('Finish the current measurement first.');
      if (!visible()) throw Error('Foreground the fixture tab before measuring.');
      measuring = true;
      const start = clock(), requestStart = requests.length, commitStart = commits.length;
      const nextFrame = () => new Promise((resolve, reject) => {
        let settled = false, unsubscribe;
        const finish = error => { if (settled) return; settled = true; clearTimeout(timer); unsubscribe?.(); if (error) reject(error); else resolve(); };
        const timer = setTimeout(() => finish(Error('Correct visible data/frame did not arrive before the fixture deadline.')), Math.max(1, timeoutMs - (clock() - start)));
        unsubscribe = subscribeVisibility?.(() => { if (!visible()) finish(Error('Measurement stopped: fixture tab became hidden.')); });
        Promise.resolve().then(frame).then(() => {
          if (!visible()) finish(Error('Measurement stopped: fixture tab became hidden.'));
          else if (clock() - start >= timeoutMs) finish(Error('Correct visible data/frame did not arrive before the fixture deadline.'));
          else finish();
        }, finish);
      });
      try {
        action();
        while (!correct()) {
          if (!visible()) throw Error('Measurement stopped: fixture tab became hidden.');
          if (clock() - start >= timeoutMs) throw Error('Correct visible data did not arrive before the fixture deadline.');
          await nextFrame();
        }
        const correctDOM = clock();
        await nextFrame(); await nextFrame();
        const reads = requests.slice(requestStart), renders = commits.slice(commitStart);
        const result = { name, tier, clickToCorrectDOMMs: correctDOM - start, nextFrameOpportunityMs: clock() - start,
          requestCount: reads.length, pendingRequests: reads.filter(request => request.end == null).length,
          reactCommits: renders.length, reactActualDurationMs: renders.reduce((sum, commit) => sum + commit.actualDuration, 0),
          clientFetches: reads.map(request => ({ ...request, clientFetchMs: request.end == null ? null : request.end - request.start })),
          actualPaintMeasured: false, serverResponseMs: null, providerDeliveryMs: null };
        results.push(result); return result;
      } finally { measuring = false; }
    },
  };
}
module.exports = { createInteractionRecorder };
