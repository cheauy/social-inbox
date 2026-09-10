/*
 * The side panel: the same three facts as the popup, kept beside Facebook.
 *
 * Deliberately not a second Inbox. Tags, notes and quick replies live in TENH,
 * and a half-copy of them here would be a second place to look and a second
 * place to be wrong.
 */

const TENH_ORIGIN = "https://app.tenhchat.com";

function ask(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      void chrome.runtime.lastError;
      resolve(response ?? {});
    });
  });
}

const view = {
  pairState: document.getElementById("pairState"),
  facebookState: document.getElementById("facebookState"),
  pageName: document.getElementById("pageName"),
  composerState: document.getElementById("composerState"),
  openTenh: document.getElementById("openTenh"),
  openFacebook: document.getElementById("openFacebook"),
};

async function render() {
  const status = await ask({ type: "TENH_STATUS" });

  view.pairState.textContent = status.paired
    ? (status.device?.name ?? "Paired")
    : "Not paired — open the extension to pair";

  const facebook = status.facebook;

  view.facebookState.textContent = facebook?.loggedIn
    ? "Signed in"
    : facebook
      ? "Signed out"
      : "No tab";
  view.facebookState.className = `state ${facebook?.loggedIn ? "on" : "off"}`;

  view.pageName.textContent = facebook?.pageName
    ? facebook.pageName
    : facebook?.pageId
      ? `Page ${facebook.pageId}`
      : "No Page identified";

  view.composerState.textContent =
    facebook?.composerState === "available"
      ? "Facebook is showing an enabled reply box."
      : facebook?.composerState === "unavailable"
        ? "Facebook is showing a reply box it has disabled."
        : "No reply box on this tab.";
}

view.openTenh.addEventListener("click", () => {
  void chrome.tabs.create({ url: `${TENH_ORIGIN}/dashboard/inbox` });
});

view.openFacebook.addEventListener("click", () => {
  void ask({ type: "OPEN_IN_FACEBOOK" });
});

/* The panel stays open while somebody works, so it refreshes on its own. */
void render();
setInterval(() => void render(), 5000);
