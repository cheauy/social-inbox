/*
 * The side panel: TENH's own record of the customer, beside Facebook.
 *
 * Everything on it is read from TENH and written back to TENH. The tags are
 * the workspace's tags, the notes are the notes the Inbox shows, the quick
 * replies are the saved replies the phone uses. There is no companion copy of
 * any of it, which is why a tag added here is on the website a second later
 * and why nothing here can drift out of date.
 *
 * It is deliberately not a second Inbox. No conversation list, no message
 * history, no search: those exist, they work, and they are one click away.
 */

const TENH_ORIGIN = "https://app.tenhchat.com";

/* Slow enough to be free, quick enough that a colleague's change shows up
   while somebody is still looking at the panel. */
const REFRESH_MS = 8000;

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
  liveState: document.getElementById("liveState"),
  facebookState: document.getElementById("facebookState"),
  pageName: document.getElementById("pageName"),
  composerState: document.getElementById("composerState"),
  customerCard: document.getElementById("customerCard"),
  unmatchedCard: document.getElementById("unmatchedCard"),
  conversationStatus: document.getElementById("conversationStatus"),
  customerName: document.getElementById("customerName"),
  assignedTo: document.getElementById("assignedTo"),
  tagChips: document.getElementById("tagChips"),
  tagPicker: document.getElementById("tagPicker"),
  notes: document.getElementById("notes"),
  quickReplies: document.getElementById("quickReplies"),
  quickReplyHint: document.getElementById("quickReplyHint"),
  openTenh: document.getElementById("openTenh"),
  openFacebook: document.getElementById("openFacebook"),
  error: document.getElementById("error"),
};

let context = null;

/* Text only, set through textContent everywhere below: a customer's name and a
   colleague's note are somebody else's words, and they are never HTML here. */
function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

function renderFacebook(status) {
  const facebook = status.facebook;

  view.pairState.textContent = status.paired
    ? status.device?.name ?? "Paired"
    : "Not paired — open the extension to pair";

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

function renderTags() {
  view.tagChips.replaceChildren();

  const applied = context?.customer?.tags ?? [];

  for (const tag of applied) {
    const chip = element("button", "chip");

    chip.style.background = tag.color || "#0089cc";
    chip.title = "Remove this tag";
    chip.append(element("span", "dot"), element("span", null, tag.name));
    chip.addEventListener("click", () => changeTag(tag.id, "remove"));

    view.tagChips.append(chip);
  }

  const appliedIds = new Set(applied.map((tag) => tag.id));
  const placeholder = element("option", null, "Add a tag…");

  placeholder.value = "";
  view.tagPicker.replaceChildren(placeholder);

  for (const tag of context?.tags ?? []) {
    if (appliedIds.has(tag.id)) continue;

    const option = element("option", null, tag.name);

    option.value = tag.id;
    view.tagPicker.append(option);
  }
}

function renderNotes() {
  view.notes.replaceChildren();

  const customerNote = context?.customer?.customerNote;
  const notes = context?.notes ?? [];

  if (customerNote) view.notes.append(element("div", "note", customerNote));

  for (const note of notes) {
    view.notes.append(element("div", "note", note.text));
  }

  if (!customerNote && notes.length === 0) {
    view.notes.append(element("p", "empty", "No notes yet."));
  }
}

function renderQuickReplies() {
  view.quickReplies.replaceChildren();

  const replies = context?.quickReplies ?? [];

  if (replies.length === 0) {
    view.quickReplies.append(
      element("p", "empty", "This workspace has no quick replies yet."),
    );

    return;
  }

  for (const reply of replies) {
    const button = element("button", "reply");

    button.append(
      element("span", "reply-title", reply.title ?? reply.shortcut ?? "Reply"),
      element("span", "reply-text", reply.text ?? ""),
    );

    button.addEventListener("click", () => insert(reply.text ?? ""));
    view.quickReplies.append(button);
  }
}

function renderCustomer() {
  const matched = context?.matched === true;

  view.customerCard.hidden = !matched;
  view.unmatchedCard.hidden = matched || !context;

  if (!matched) return;

  view.customerName.textContent = context.customer?.name ?? "Customer";
  view.conversationStatus.textContent = context.conversation?.status ?? "";
  view.conversationStatus.className = "state on";

  view.assignedTo.textContent = context.conversation?.assignedTo
    ? `Assigned to ${context.conversation.assignedTo.name ?? "a teammate"}`
    : "Not assigned to anybody";

  renderTags();
  renderNotes();
}

async function refresh() {
  const status = await ask({ type: "TENH_STATUS" });

  renderFacebook(status);

  if (!status.paired) {
    view.liveState.textContent = "Not paired";
    view.liveState.className = "pill off";
    context = null;

    renderCustomer();
    renderQuickReplies();

    return;
  }

  const answer = await ask({ type: "TENH_CONTEXT" });

  if (answer.error || answer.paired === false) {
    view.liveState.textContent = "Offline";
    view.liveState.className = "pill off";
    view.error.textContent = answer.error ?? "";

    return;
  }

  view.error.textContent = "";
  view.liveState.textContent = "Live";
  view.liveState.className = "pill";

  context = answer;

  renderCustomer();
  renderQuickReplies();
}

async function changeTag(tagId, action) {
  if (!tagId) return;

  view.error.textContent = "";

  const result = await ask({ type: "TENH_TAG", tagId, action });

  if (!result.ok) {
    view.error.textContent = result.error ?? "Unable to change that tag.";

    return;
  }

  await refresh();
}

async function insert(text) {
  view.error.textContent = "";

  const result = await ask({ type: "TENH_INSERT_QUICK_REPLY", text });

  if (result.inserted) {
    view.quickReplyHint.textContent = "Inserted. Read it, then press Send.";

    return;
  }

  view.quickReplyHint.textContent =
    "Inserted into Facebook's box. You press Send.";

  /* Facebook decides whether a reply box exists and whether it works. When it
     has closed one, the panel says so rather than finding another way in. */
  view.error.textContent =
    result.reason === "composer_unavailable"
      ? "Facebook is not offering an enabled reply box for this conversation."
      : "No Facebook conversation is open in this browser.";
}

view.tagPicker.addEventListener("change", (event) => {
  const tagId = event.target.value;

  event.target.value = "";

  void changeTag(tagId, "add");
});

view.openTenh.addEventListener("click", () => {
  void chrome.tabs.create({ url: `${TENH_ORIGIN}/dashboard/inbox` });
});

view.openFacebook.addEventListener("click", () => {
  void ask({ type: "OPEN_IN_FACEBOOK" });
});

/* The panel stays open while somebody works, so it refreshes on its own. */
void refresh();
setInterval(() => void refresh(), REFRESH_MS);
