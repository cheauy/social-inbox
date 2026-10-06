import "server-only";

/*
 * Per-phase durations for one request, reported as a Server-Timing header so
 * they can be read in the browser's network panel against production data.
 */
export function phaseTimer() {
  const phases: Array<[string, number]> = [];
  let last = performance.now();
  return {
    mark(name: string) {
      const now = performance.now();
      phases.push([name, now - last]);
      last = now;
    },
    header() {
      return phases.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(", ");
    },
  };
}
