// Share only overlapping reads. Do not retain account data after completion.
let pending: Promise<Response> | null = null;

export async function readWorkspaces(signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  if (!pending) {
    const request = fetch("/api/workspaces", { cache: "no-store" });
    pending = request;
    void request.finally(() => {
      if (pending === request) pending = null;
    }).catch(() => undefined);
  }
  const shared = pending;
  if (!signal) return (await shared).clone();
  let onAbort: (() => void) | undefined;
  try {
    const response = await new Promise<Response>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      void shared.then(resolve, reject);
    });
    return response.clone();
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

// A mutation must not join a read started before its workspace changed.
export function invalidateWorkspaceRead() {
  pending = null;
}
