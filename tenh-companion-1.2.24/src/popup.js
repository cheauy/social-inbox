/* TENH Companion popup — status only. No manual pairing flow. */

const TENH_ORIGIN = "https://app.tenhchat.com";

const view = {
  version: document.getElementById("version"),
  connectionState: document.getElementById("connectionState"),
  deviceName: document.getElementById("deviceName"),
  connectionHint: document.getElementById("connectionHint"),
  facebookState: document.getElementById("facebookState"),
  pageName: document.getElementById("pageName"),
  composerState: document.getElementById("composerState"),
  facebookAction: document.getElementById("facebookAction"),
  openTenh: document.getElementById("openTenh"),
  redetect: document.getElementById("redetect"),
  test: document.getElementById("test"),
  repairResult: document.getElementById("repairResult"),
  profileLookupResult: document.getElementById("profileLookupResult"),
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
  const connected = status.connected === true || status.paired === true;
  const lookup = status.lastProfileLookup;
  if (view.profileLookupResult) view.profileLookupResult.textContent = "Customer profile links are managed in TENH Customer Details.";


  view.version.textContent = status.version ? `Version ${status.version}` : "";

  if (connected) {
    setState(view.connectionState, "Connected", "on");
    view.deviceName.textContent = status.device?.name ?? "This browser";
    view.connectionHint.textContent = "Connected automatically from your TENH login.";
  } else {
    setState(view.connectionState, "Sign in required", "warn");
    view.deviceName.textContent = "";
    view.connectionHint.textContent =
      "Open TENH and sign in. The extension connects automatically — no code or pairing step.";
  }

  const facebook = status.facebook;

  if (!facebook) {
    setState(view.facebookState, "Connecting…", "off");
    view.pageName.textContent = "TENH Companion is preparing Facebook automatically.";
    view.composerState.textContent = "";
    view.facebookAction.hidden = true;
    return;
  }

  setState(
    view.facebookState,
    facebook.loggedIn ? "Ready" : "Sign-in required",
    facebook.loggedIn ? "on" : "warn",
  );

  const pageCount = Number(status.facebookPageCount ?? status.facebookPages?.length ?? 0);
  const currentPage = facebook.pageName
    ? facebook.pageName
    : facebook.pageId
      ? `Page ${facebook.pageId}`
      : "No Page identified";

  view.pageName.textContent = pageCount > 1
    ? `${pageCount} Pages detected • Current: ${currentPage}`
    : currentPage;

  view.composerState.textContent =
    facebook.composerState === "available"
      ? "Facebook reply box is available."
      : facebook.composerState === "unavailable"
        ? "Facebook reply box is unavailable for this conversation."
        : "Facebook browser tools are standing by.";

  view.facebookAction.hidden = facebook.loggedIn === true;
  view.facebookAction.textContent = "Sign in to Facebook";
}

view.openTenh.addEventListener("click", () => {
  void chrome.tabs.create({ url: `${TENH_ORIGIN}/dashboard/inbox` });
  window.close();
});
view.facebookAction.addEventListener("click", async () => {
  await ask({ type: "OPEN_IN_FACEBOOK" });
  window.close();
});


view.redetect.addEventListener("click", async () => {
  view.repairResult.textContent = "Checking Facebook…";

  const result = await ask({ type: "TENH_REDETECT" });

  view.repairResult.textContent = !result.foundTab
    ? "Facebook browser tools are idle. They will start when needed."
    : result.facebook?.loggedIn
      ? "Facebook detected."
      : "Facebook needs sign-in. Normal TENH messaging is still active.";

  await render();
});

view.test.addEventListener("click", async () => {
  view.repairResult.textContent = "Testing…";

  const result = await ask({ type: "TENH_TEST" });
  const connected = result.connected === true || result.paired === true;

  view.repairResult.textContent = !result.reachable
    ? "TENH could not be reached from this browser."
    : connected
      ? "Connected to TENH."
      : result.error ?? "Open TENH and sign in to connect automatically.";

  await render();
});

void render();
