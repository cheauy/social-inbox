/* Shared pure validation. Loaded in the isolated Facebook world and worker. */
(() => {
  const reserved = new Set(["me", "home", "login", "logout", "settings", "help", "search", "watch", "reel", "reels", "stories", "groups", "pages", "marketplace", "gaming", "events", "photos", "dialog", "share", "messages", "latest", "business", "privacy", "checkpoint", "friends", "notifications", "bookmarks", "posts", "videos"]);
  function context(value) {
    try {
      const url = new URL(value);
      if (url.origin !== "https://business.facebook.com" || !/^\/latest\/inbox(?:\/|$)/.test(url.pathname)) return null;
      const pageId = url.searchParams.get("asset_id"), psid = url.searchParams.get("selected_item_id");
      if (![pageId, psid].every(id => /^\d{1,30}$/.test(id || "")) || url.searchParams.getAll("asset_id").length !== 1 || url.searchParams.getAll("selected_item_id").length !== 1) return null;
      const type = url.searchParams.get("thread_type");
      if (type && type !== "FB_MESSAGE") return null;
      return { pageId, psid };
    } catch { return null; }
  }
  function profile(value, scope = {}) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
      let url = new URL(value, "https://www.facebook.com");
      if (url.protocol === "https:" && ["l.facebook.com", "lm.facebook.com"].includes(url.hostname) && url.pathname === "/l.php") url = new URL(url.searchParams.get("u") || "");
      if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
      const path = url.pathname.replace(/\/+$/, "");
      let id = null;
      if (path === "/profile.php") {
        if (url.searchParams.getAll("id").length !== 1) return null;
        id = url.searchParams.get("id");
      } else id = path.match(/^\/(?:people\/[^/]+\/)?(\d{1,30})$/)?.[1] || null;
      if (id !== null) return /^\d{1,30}$/.test(id) && id !== scope.psid && id !== scope.pageId ? `https://www.facebook.com/profile.php?id=${id}` : null;
      const username = path.slice(1);
      if (!/^[a-zA-Z0-9._-]{2,100}$/.test(username) || /\.php$/i.test(username) || reserved.has(username.toLowerCase())) return null;
      return `https://www.facebook.com/${username}`;
    } catch { return null; }
  }
  globalThis.TenhProfileSyncHelpers = Object.freeze({ context, profile });
})();
