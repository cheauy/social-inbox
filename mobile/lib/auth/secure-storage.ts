import * as SecureStore from "expo-secure-store";

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// Supabase sessions can exceed Android SecureStore's per-value limit. Each chunk
// stays encrypted; a generation pointer is published only after all writes finish.
const size = 1500;
const keyFor = (key: string) => `tenh.${key.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
type Index = { generation: string; count: number };
async function index(key: string): Promise<Index | null> {
  const value = await SecureStore.getItemAsync(key, options);
  if (!value) return null;
  try { const parsed = JSON.parse(value); return typeof parsed.generation === "string" && Number.isInteger(parsed.count) && parsed.count > 0 && parsed.count < 1000 ? parsed : null; } catch { return null; }
}
async function clear(key: string, previous: Index | null) {
  if (previous) await Promise.all(Array.from({ length: previous.count }, (_, i) => SecureStore.deleteItemAsync(`${key}.${previous.generation}.${i}`, options)));
}
export const secureStorage = {
  async getItem(rawKey: string) {
    const key = keyFor(rawKey), saved = await index(key);
    if (!saved) return null;
    const chunks = await Promise.all(Array.from({ length: saved.count }, (_, i) => SecureStore.getItemAsync(`${key}.${saved.generation}.${i}`, options)));
    return chunks.some(chunk => chunk === null) ? null : chunks.join("");
  },
  async setItem(rawKey: string, value: string) {
    const key = keyFor(rawKey), previous = await index(key);
    // Encode first so chunk lengths are byte-safe even for Khmer profile names.
    const encoded = encodeURIComponent(value);
    const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const count = Math.max(1, Math.ceil(encoded.length / size));
    await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.setItemAsync(`${key}.${generation}.${i}`, encoded.slice(i * size, (i + 1) * size), options)));
    await SecureStore.setItemAsync(key, JSON.stringify({ generation, count }), options);
    await clear(key, previous);
  },
  async removeItem(rawKey: string) {
    const key = keyFor(rawKey), previous = await index(key);
    await SecureStore.deleteItemAsync(key, options);
    await clear(key, previous);
  },
};
export const sessionStorage = {
  ...secureStorage,
  async getItem(key: string) {
    const value = await secureStorage.getItem(key);
    if (value === null) return null;
    try { return decodeURIComponent(value); } catch { return null; }
  },
};
