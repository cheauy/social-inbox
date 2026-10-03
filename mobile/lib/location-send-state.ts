import { sessionStorage } from "./auth/secure-storage";

export type LocationAttempt = { requestId: string; latitude: number; longitude: number };
export const locationAttemptKey = (account: string, workspace: string, conversation: string) =>
  `location-send.${account}.${workspace}.${conversation}`;

async function read(key: string): Promise<LocationAttempt | null> {
  const value = await sessionStorage.getItem(key);
  if (value === null) return null;
  const parsed = JSON.parse(value) as LocationAttempt;
  if (!/^[0-9a-f-]{36}$/i.test(parsed.requestId) || !Number.isFinite(parsed.latitude) ||
      Math.abs(parsed.latitude) > 90 || !Number.isFinite(parsed.longitude) || Math.abs(parsed.longitude) > 180) {
    throw new Error("The saved location request could not be read. Contact TENH support before sending another location.");
  }
  return parsed;
}

// Serialize storage transitions across simultaneously mounted thread screens.
const transitions = new Map<string, Promise<unknown>>();
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = transitions.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  transitions.set(key, result);
  void result.finally(() => { if (transitions.get(key) === result) transitions.delete(key); }).catch(() => {});
  return result;
}
export const readLocationAttempt = (key: string) => serial(key, () => read(key));
export const saveLocationAttempt = (key: string, attempt: LocationAttempt) => serial(key, async () => {
  if (await read(key)) throw new Error("An earlier location is unresolved. Close and reopen the map to check delivery.");
  await sessionStorage.setItem(key, JSON.stringify(attempt));
});
export const clearLocationAttempt = (key: string, requestId: string) => serial(key, async () => {
  if ((await read(key))?.requestId === requestId) await sessionStorage.removeItem(key);
});
