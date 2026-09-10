/*
 * The popup: what this browser is, and the two buttons that change it.
 *
 * It asks the service worker for state and shows it. There is deliberately no
 * Facebook control here -- nothing in this extension sends from Facebook, and
 * a popup full of buttons would suggest otherwise. There is no pairing control
 * either: a browser signed in to TENH connects itself, so a code to copy would
 * be a step invented for its own sake.
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
  connect: document.getElementById("connect"),
  unpair: document.getElementById("unpair"),
  openTenh: document.getElementById("openTenh"),
  openFacebook: document.getElementById("openFacebook"),
  signIn: document.getElementById("signIn"),
  retry: document.getElementById("retry"),
  keepActive: document.getElementById("keepActive"),
  keepActiveNote: document.getElementById("keepActiveNote"),
  redetect: document.getElementById("redetect"),
  test: document.getElementById("test"),
  repairResult: document.getElementById("repairResult"),
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
    setState(view.pairState, "Connected", "on");
    view.deviceName.textContent = status.device?.name ?? "";
    view.pairCard.hidden = true;
    view.pairedCard.hidden = false;
  } else {
    setState(view.pairState, "Not connected", "off");
    view.deviceName.textContent = "";
    view.pairCard.hidden = false;
    view.pairedCard.hidden = true;
  }

  view.keepActive.checked = status.keepCompanionActive === true;
  view.keepActiveNote.textContent =
    status.keepCompanionActive === true
      ? "A Facebook tab stays loaded in the background."
      : "Facebook starts only when a feature needs it.";

  renderFacebook(status);
}

/*
 * What to tell somebody about Facebook.
 *
 * These five states are the whole vocabulary, and none of them is "no tab".
 * "No tab" was true and useless: it described the extension's situation, not
 * the customer's, and it read like a fault when nothing was wrong. Sleeping is
 * the normal, correct state of a browser doing ordinary TENH work.
 *
 * Every one of them ends up saying the same thing in different words: TENH is
 * fine either way.
 */
function renderFacebook(status) {
  const companion = status.companion ?? { state: "sleeping" };

  view.signIn.hidden = true;
  view.retry.hidden = true;

  if (companion.state === "ready") {
    setState(view.facebookState, "Ready", "on");

    view.pageName.textContent =
      companion.pageName ??
      (companion.pageId ? `Page ${companion.pageId}` : "Companion active");

    view.composerState.textContent =
      companion.composerState === "available"
        ? "Facebook is showing an enabled reply box."
        : companion.composerState === "unavailable"
          ? "Facebook is showing a reply box it has disabled."
          : "Companion active.";

    return;
  }

  if (companion.state === "connecting") {
    setState(view.facebookState, "Connecting…", "warn");
    view.pageName.textContent = "Preparing Facebook companion.";
    view.composerState.textContent = "";

    return;
  }

  if (companion.state === "sign_in_required") {
    setState(view.facebookState, "Sign-in required", "warn");
    view.pageName.textContent =
      "Sign in to Facebook once on this browser to enable companion features.";
    view.composerState.textContent = "";
    view.signIn.hidden = false;

    return;
  }

  if (companion.state === "error") {
    setState(view.facebookState, "Connection issue", "warn");
    view.pageName.textContent =
      "Facebook companion unavailable. Normal TENH messaging is still working.";
    view.composerState.textContent = "";
    view.retry.hidden = false;

    return;
  }

  setState(view.facebookState, "Sleeping", "off");
  view.pageName.textContent =
    "Facebook will start automatically when a companion feature is needed.";
  view.composerState.textContent = "";
}

/*
 * The only way in, and it is not a button that connects anything.
 *
 * Connecting happens on TENH's own page, where the person's session already
 * is. So this opens TENH and gets out of the way -- there is nothing here to
 * type, get wrong, or be asked for a second time.
 */
view.connect.addEventListener("click", () => {
  void chrome.tabs.create({ url: `${TENH_ORIGIN}/dashboard/inbox` });
  window.close();
});

/*
 * Sign-in is a person's job, always.
 *
 * This brings the Facebook tab forward -- the only moment the extension is
 * allowed to move somebody's screen without them pressing "open Facebook" --
 * and then does nothing at all. It does not read the form, fill it, or look at
 * a cookie afterwards.
 */
view.signIn.addEventListener("click", async () => {
  await ask({ type: "TENH_SIGN_IN_FACEBOOK" });
  window.close();
});

view.retry.addEventListener("click", async () => {
  setState(view.facebookState, "Connecting…", "warn");
  view.pageName.textContent = "Preparing Facebook companion.";
  view.retry.hidden = true;

  await ask({ type: "TENH_PREPARE_FACEBOOK" });
  await render();
});

view.keepActive.addEventListener("change", async (event) => {
  const enabled = event.target.checked === true;

  view.keepActiveNote.textContent = enabled
    ? "Preparing a Facebook tab…"
    : "Facebook starts only when a feature needs it.";

  await ask({ type: "TENH_SET_KEEP_ACTIVE", enabled });
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

/*
 * Repair, for the day Facebook rearranges its page.
 *
 * Detection is a best effort against somebody else's interface, and it will
 * eventually be wrong. When it is, these two buttons say so plainly instead of
 * leaving a stale green dot, and TENH itself carries on regardless -- messages
 * still arrive through Meta's webhook and still send through the API.
 */
view.redetect.addEventListener("click", async () => {
  view.repairResult.textContent = "Looking again…";

  const result = await ask({ type: "TENH_REDETECT" });

  view.repairResult.textContent = !result.foundTab
    ? "No Facebook tab is open in this browser."
    : result.facebook?.loggedIn
      ? "Facebook detected again."
      : "A Facebook tab is open, but this build cannot read it. Normal TENH messaging is still active.";

  await render();
});

view.test.addEventListener("click", async () => {
  view.repairResult.textContent = "Testing…";

  const result = await ask({ type: "TENH_TEST" });

  view.repairResult.textContent = !result.reachable
    ? "TENH could not be reached from this browser."
    : result.paired
      ? "Connected to TENH."
      : result.error ?? "This browser is no longer paired with TENH.";

  await render();
});

void render();
