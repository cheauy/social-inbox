/** Tab-lifetime, workspace-scoped catalog reads; sign-out reloads the document. */
export function createQuickPickerCache<T extends { loadedAt: number }>(ttlMs = 60_000) {
  const entries = new Map<string, T>();
  const flights = new Map<string, Promise<T>>();
  const versions = new Map<string, number>();
  return {
    get: (key: string) => entries.get(key),
    fresh: (key: string) => { const entry = entries.get(key); return !!entry && Date.now() - entry.loadedAt < ttlMs; },
    invalidate(key: string) { entries.delete(key); versions.set(key, (versions.get(key) ?? 0) + 1); flights.delete(key); },
    load(key: string, read: () => Promise<T>): Promise<T> {
      const existing = flights.get(key);
      if (existing) return existing;
      const version = versions.get(key) ?? 0;
      const flight = Promise.resolve().then(read).then(value => {
        if ((versions.get(key) ?? 0) === version && flights.get(key) === flight) {
          entries.delete(key); entries.set(key, value);
          while (entries.size > 8) entries.delete(entries.keys().next().value!);
        }
        return value;
      }).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
      flights.set(key, flight);
      return flight;
    },
  };
}
