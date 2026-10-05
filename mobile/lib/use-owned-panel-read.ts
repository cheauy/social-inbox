import { useEffect, useRef, useState } from "react";

/** One mounted panel's read; successful rows survive only their owner. */
export function useOwnedPanelRead<T>(owner: string, active: boolean, open: boolean, load: (signal: AbortSignal) => Promise<T[]>, invalidation?: unknown, isCurrent?: () => boolean) {
  const activity = useRef({ owner, active, open, invalidation, epoch: 0 });
  if (activity.current.owner !== owner || activity.current.active !== active || activity.current.open !== open || !Object.is(activity.current.invalidation, invalidation)) {
    activity.current = { owner, active, open, invalidation, epoch: activity.current.epoch + 1 };
  }
  const loadRef = useRef(load); loadRef.current = load;
  const [snapshot, setSnapshot] = useState<{ owner: string; rows: T[] } | null>(null);
  const [failure, setFailure] = useState<{ owner: string; message: string } | null>(null);
  const [flight, setFlight] = useState<{ owner: string; loading: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active || !open) return;
    const controller = new AbortController(), epoch = activity.current.epoch;
    const owns = () => (!isCurrent || isCurrent()) && !controller.signal.aborted && activity.current.owner === owner &&
      activity.current.epoch === epoch && activity.current.active && activity.current.open;
    setFlight({ owner, loading: true }); setFailure(null);
    void Promise.resolve().then(() => {
      if (!owns()) return null;
      return loadRef.current(controller.signal);
    }).then(rows => { if (rows !== null && owns()) setSnapshot({ owner, rows }); })
      .catch(error => {
        if (!owns()) return;
        if ([401, 403, 404, 409].includes(error?.status)) setSnapshot(null);
        setFailure({ owner, message: error instanceof Error ? error.message : "Unable to load this record. Please retry." });
      })
      .finally(() => { if (owns()) setFlight({ owner, loading: false }); });
    return () => controller.abort();
  }, [owner, active, open, revision, invalidation]);
  return {
    rows: snapshot?.owner === owner ? snapshot.rows : null,
    loading: active && open && (flight?.owner === owner ? flight.loading : true),
    error: failure?.owner === owner ? failure.message : "",
    retry: () => { if (!isCurrent || isCurrent()) setRevision(value => value + 1); },
  };
}
