/*
 * The doorway between app.tenhchat.com and the extension.
 *
 * A page cannot talk to an extension directly, and should not be able to: this
 * script is the only crossing, and it lets exactly four questions through. A
 * message that is not one of them -- from an ad frame, a stray library, an
 * injected script -- is dropped without a reply.
 *
 * Nothing sensitive travels this way. TENH sends a five-minute pairing code
 * and asks what a Facebook tab looks like; the extension answers with its
 * version and what it saw. No session, no cookie, no token goes back to the
 * page.
 */

const ALLOWED = new Set([
  "TENH_EXTENSION_PING",
  "TENH_PAIR",
  "TENH_UNPAIR",
  "OPEN_IN_FACEBOOK",
  "CHECK_FACEBOOK_REPLY_AVAILABILITY",
]);

window.addEventListener("message", (event) => {
  /* Same window, same origin, or it is not TENH speaking. */
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const data = event.data;

  if (!data || typeof data !== "object") return;
  if (data.source !== "TENH_WEB") return;
  if (typeof data.type !== "string" || !ALLOWED.has(data.type)) return;

  const requestId = typeof data.requestId === "string" ? data.requestId : null;

  chrome.runtime.sendMessage(
    {
      type: data.type,
      code: typeof data.code === "string" ? data.code : undefined,
      pageId: typeof data.pageId === "string" ? data.pageId : undefined,
      conversationId:
        typeof data.conversationId === "string" ? data.conversationId : undefined,
    },
    (response) => {
      /* A missing worker is an answer too: TENH shows "not installed" rather
         than waiting for something that is never coming. */
      const payload = chrome.runtime.lastError
        ? { error: "extension_unavailable" }
        : (response ?? {});

      window.postMessage(
        {
          source: "TENH_EXTENSION",
          type:
            data.type === "TENH_EXTENSION_PING"
              ? "TENH_EXTENSION_PONG"
              : `${data.type}_RESULT`,
          requestId,
          ...payload,
        },
        window.location.origin,
      );
    },
  );
});

/*
 * Announced once, so a page that loaded before this script did does not have
 * to poll to find out somebody is home.
 */
window.postMessage(
  {
    source: "TENH_EXTENSION",
    type: "TENH_EXTENSION_READY",
    version: chrome.runtime.getManifest().version,
  },
  window.location.origin,
);
