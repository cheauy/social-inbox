export function customerPhotoCandidates(uri?: string | null, contactId?: string | null, platform?: string | null): string[] {
  let original = uri?.trim() || null;
  // React Native's basic iOS Image loader cannot reliably decode remote WebP.
  // A distinct URL also avoids reusing an older WebP entry from the disk cache.
  if (original && /^\/api\/contacts\/[^/?]+\/(facebook|telegram)-avatar(?:\?|$)/.test(original)) {
    const url = new URL(original, "https://app.tenhchat.com");
    url.searchParams.set("format", "jpeg");
    original = url.pathname + url.search;
  }
  const facebook = platform === "facebook" || platform === "messenger";
  const stored = contactId && (facebook || platform === "telegram")
    ? `/api/contacts/${encodeURIComponent(contactId)}/${facebook ? "facebook" : "telegram"}-avatar?format=jpeg`
    : null;
  // Match the web: stable Facebook copy first; Telegram's saved URL then storage.
  return [...new Set((facebook ? [stored, original] : [original, stored]).filter((value): value is string => Boolean(value)))];
}
