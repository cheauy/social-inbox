// Share overlapping catalogue reads only; keep no completed account data.
let pending: Promise<Response> | null = null;

export async function readInboxChannels(): Promise<Response> {
  if (!pending) {
    const request = fetch("/api/inbox/channels", {
      method: "GET", cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    pending = request;
    void request.finally(() => {
      if (pending === request) pending = null;
    }).catch(() => undefined);
  }
  return (await pending).clone();
}
