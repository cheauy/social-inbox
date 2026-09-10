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
 * page -- including the one this script fetches for itself below.
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

/* ------------------------------------------------- connecting by itself */

/*
 * A browser that is signed in to TENH connects itself.
 *
 * This runs in the content script rather than the service worker on purpose:
 * a content script's fetch is same-origin with the page, so it carries the
 * TENH session cookie the person is already using, and TENH can answer "this
 * is Dara, in this workspace" without a code being typed anywhere.
 *
 * The token that comes back stays here and goes straight to the worker. It is
 * never postMessaged, never written to the page, and never reachable from
 * page JavaScript -- content scripts run in their own world, which is the
 * whole reason this is safe to do at all.
 */
async function connectIfSignedIn() {
  const state = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TENH_PAIRING_STATE" }, (response) => {
      void chrome.runtime.lastError;
      resolve(response ?? {});
    });
  });

  if (!state || state.paired !== false || !state.installationId) return;

  try {
    const response = await fetch("/api/extension/auto-pair", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browserInstallationId: state.installationId,
        deviceName: state.deviceName,
        extensionVersion: chrome.runtime.getManifest().version,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result?.success || !result.token) return;

    chrome.runtime.sendMessage(
      {
        type: "TENH_AUTO_PAIRED",
        token: result.token,
        device: result.device ?? null,
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
  } catch {
    /*
     * Signed out, offline, or an older TENH without the route. All three mean
     * the same thing here: stay unpaired, say nothing, and let the person pair
     * with a code if they want to. Nothing on the page depends on this.
     */
  }
}

void connectIfSignedIn();

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
