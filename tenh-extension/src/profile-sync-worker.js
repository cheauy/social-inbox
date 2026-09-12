import "./profile-sync-helpers.js";

/** Separate passive-profile handler: does not change transport/retry/ACK logic. */
export function createProfileSyncHandler({ extensionId, getState, getTab, callTenh, notify, status }) {
  const helpers = globalThis.TenhProfileSyncHelpers;
  const pending = new Map(), recent = new Map();
  return async function sync(message, sender) {
    if (sender?.id !== extensionId || sender.frameId !== 0 || !Number.isInteger(sender?.tab?.id)) return { saved: false, reason: "untrusted_sender" };
    const requested = { pageId: message?.pageId, psid: message?.psid };
    const initial = helpers.context(sender.url || sender.tab.url);
    if (!initial || initial.pageId !== requested.pageId || initial.psid !== requested.psid) return { saved: false, reason: "profile_context_mismatch" };
    const url = helpers.profile(message.publicProfileUrl, requested);
    if (!url) return { saved: false, reason: "invalid_profile_url" };
    const state = await getState();
    if (!state.token) return { saved: false, reason: "tenh_sign_in_required" };
    if (state.profileSyncEnabled === false) return { saved: false, reason: "profile_sync_disabled" };
    // Current tab URL is re-read, not trusted from a queued old sender snapshot.
    const tab = await getTab(sender.tab.id).catch(() => null);
    const actual = helpers.context(tab?.url);
    if (!actual || actual.pageId !== requested.pageId || actual.psid !== requested.psid) return { saved: false, reason: "profile_context_changed" };
    const key = JSON.stringify([state.token, requested.pageId, requested.psid, url]);
    const previous = recent.get(key);
    if (previous && Date.now() - previous.at < 300000) return { ...previous.result, unchanged: true };
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      let result;
      try {
        const response = await callTenh("/api/save-profile-url", { method: "POST", token: state.token,
          body: { psid: requested.psid, pageId: requested.pageId, publicProfileUrl: url } });
        const data = response.result || {};
        if (!response.ok || data.success !== true || data.psid !== requested.psid || data.pageId !== requested.pageId || data.publicProfileUrl !== url) {
          result = { saved: false, reason: data.code || (response.status === 404 ? "profile_receiver_or_customer_missing" : "profile_sync_rejected") };
        } else {
          result = { saved: true, reason: "profile_synced", conversationId: data.conversationId };
          if (recent.size >= 100) recent.delete(recent.keys().next().value);
          recent.set(key, { at: Date.now(), result });
          // The page re-fetches its authorized profile record; it never consumes a URL from this event.
          if (typeof data.conversationId === "string") await notify({ type: "customer.profile.updated", conversationId: data.conversationId, pageId: requested.pageId, at: Date.now() }).catch(() => {});
        }
      } catch { result = { saved: false, reason: "profile_sync_network_unavailable" }; }
      await status({ at: Date.now(), reason: result.reason, saved: result.saved }).catch(() => {});
      return result;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}
