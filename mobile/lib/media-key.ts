export function stableMediaKey(uri: string) {
  try {
    const url = new URL(uri);
    const storage = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (storage && url.origin === new URL(storage).origin && url.pathname.startsWith("/storage/v1/object/sign/")) {
      url.searchParams.delete("token");
      return url.href;
    }
    if (["fbcdn.net", "fbsbx.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      // Signatures and CDN routing change without changing the underlying
      // image. Keep crop/format parameters and the path (including filename)
      // so edited artwork or a different resolution gets a different entry.
      for (const name of [...url.searchParams.keys()]) {
        if (["oh", "oe", "ccb", "_nc_sid"].includes(name) || name.startsWith("_nc_")) url.searchParams.delete(name);
      }
      url.searchParams.sort();
      return `facebook-cdn:${url.pathname}${url.search}`;
    }
  } catch { /* Local asset. */ }
  return uri;
}
