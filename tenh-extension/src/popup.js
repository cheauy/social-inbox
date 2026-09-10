/*
 * The popup: what this browser is, and the two buttons that change it.
 *
 * It asks the service worker for state and shows it. There is deliberately no
 * Facebook control here -- nothing in this extension types into Facebook, and
 * a popup full of buttons would suggest otherwise.
 */

const TENH_ORIGIN = "https://app.tenhchat.com";

const view = {
  version: document.getElementById("version"),
  pairState: document.getElementById("pairState"),
  deviceName: document.getElementById("deviceName"),
  facebookState: document.getElementById("facebookState"),
  pageName: document.getElementById("pageName"),
  composerState: document.getElementById("composerState"),
  pairCard: document.getElementById("pairCard"),
  pairedCard: document.getElementById("pairedCard"),
  code: document.getElementById("code"),
  pair: document.getElementById("pair"),
  unpair: document.getElementById("unpair"),
  openTenh: document.getElementById("openTenh"),
  openFacebook: document.getElementById("openFacebook"),
  error: document.getElementById("error"),
};

function ask(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      void chrome.runtime.lastError;
      resolve(response ?? {});
    });
  });
}

function setState(element, text, tone) {
  element.textContent = text;
  element.className = `state ${tone}`;
}

async function render() {
  const status = await ask({ type: "TENH_STATUS" });

  view.version.textContent = status.version ? `Version ${status.version}` : "";

  if (status.paired) {
    setState(view.pairState, "Paired", "on");
    view.deviceName.textContent = status.device?.name ?? "";
    view.pairCard.hidden = true;
    view.pairedCard.hidden = false;
  } else {
    setState(view.pairState, "Not paired", "off");
    view.deviceName.textContent = "";
    view.pairCard.hidden = false;
    view.pairedCard.hidden = true;
  }

  const facebook = status.facebook;

  if (!facebook) {
    setState(view.facebookState, "No tab", "off");
    view.pageName.textContent = "No Facebook tab open";
    view.composerState.textContent = "";
    return;
  }

  setState(
    view.facebookState,
    facebook.loggedIn ? "Signed in" : "Signed out",
    facebook.loggedIn ? "on" : "warn",
  );

  view.pageName.textContent = facebook.pageName
    ? facebook.pageName
    : facebook.pageId
      ? `Page ${facebook.pageId}`
      : "No Page identified on this tab";

  view.composerState.textContent =
    facebook.composerState === "available"
      ? "Facebook is showing an enabled reply box."
      : facebook.composerState === "unavailable"
        ? "Facebook is showing a reply box it has disabled."
        : "No reply box on this tab.";
}

view.pair.addEventListener("click", async () => {
  const code = view.code.value.trim().toUpperCase();

  view.error.textContent = "";

  if (!code) {
    view.error.textContent = "Paste the code from TENH first.";
    return;
  }

  view.pair.disabled = true;
  view.pair.textContent = "Pairing…";

  const result = await ask({ type: "TENH_PAIR", code });

  view.pair.disabled = false;
  view.pair.textContent = "Pair this browser";

  if (!result.paired) {
    view.error.textContent = result.error ?? "Pairing failed.";
    return;
  }

  view.code.value = "";
  await render();
});

view.unpair.addEventListener("click", async () => {
  await ask({ type: "TENH_UNPAIR" });
  await render();
});

view.openTenh.addEventListener("click", () => {
  void chrome.tabs.create({ url: `${TENH_ORIGIN}/dashboard/inbox` });
});

view.openFacebook.addEventListener("click", async () => {
  await ask({ type: "OPEN_IN_FACEBOOK" });
  window.close();
});

void render();
