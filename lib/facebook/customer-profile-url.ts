type FacebookProfileIdentity = {
  facebook_profile_id?: string | null;
  platform_user_id?: string | null;
};

export function normalizeFacebookProfileUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/profile.php") {
      if (url.searchParams.getAll("id").length !== 1) return null;
      return getFacebookCustomerProfileUrl({ facebook_profile_id: url.searchParams.get("id") });
    }
    const numeric = path.match(/^\/(?:people\/[^/]+\/)?(\d{1,30})$/)?.[1];
    if (numeric) return getFacebookCustomerProfileUrl({ facebook_profile_id: numeric });
    const username = path.slice(1);
    if (!/^[a-zA-Z0-9._-]{2,100}$/.test(username) || /\.php$/i.test(username)) return null;
    if (["me", "events", "stories", "reel", "business", "latest", "messages", "login", "logout", "checkpoint", "settings", "help", "groups", "pages", "watch", "reels", "marketplace", "search", "friends", "bookmarks", "gaming", "ads", "privacy", "notifications", "home", "photo", "photos", "posts", "videos", "share", "story"].includes(username.toLowerCase())) return null;
    return `https://www.facebook.com/${username}`;
  } catch { return null; }
}

export function getFacebookCustomerProfileUrl(contact: FacebookProfileIdentity | null | undefined): string | null {
  // A Page-scoped Messenger ID is never a fallback for a public Facebook ID.
  const publicId = contact?.facebook_profile_id?.trim();
  return publicId && publicId !== contact?.platform_user_id?.trim() && /^[0-9]{1,30}$/.test(publicId)
    ? `https://www.facebook.com/profile.php?id=${publicId}`
    : null;
}

export function normalizeCustomerProfileLink(value: unknown, messengerId?: string | null): string | null {
  const url = normalizeFacebookProfileUrl(value);
  if (!url || (messengerId && new URL(url).searchParams.get("id") === messengerId.trim())) return null;
  return url;
}
