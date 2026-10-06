const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { execFileSync } = require("child_process");
const vm = require("vm");
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const { loader } = require("./tenh-seven/harness.cjs");

/*
 * Conversation switching after Inbox -> Menu -> Inbox.
 *
 * The URL-to-selection effect under test is the real one: the fixed hook from
 * lib/inbox/use-url-conversation-selection.ts, and -- for the reproduction --
 * the original useEffect extracted verbatim from components/inbox/inbox-view.tsx
 * at HEAD. Both run in real React with jsdom, against a browser-like history
 * stack whose useSearchParams can lag behind pushState, the way Next's does
 * during navigation.
 *
 * The Inbox side mirrors selectConversationSmoothly: it sets the selection,
 * aborts every other conversation's request, loads messages with a delay,
 * ignores a response that is no longer the desired conversation, and pushes the
 * URL when asked to.
 */

const CONVERSATIONS = ["A", "B", "C", "D"].map((id) => ({ id }));

/* ------------------------------------------------------------------ hooks */

const { useUrlConversationSelection } = loader({ react: React })("lib/inbox/use-url-conversation-selection.ts");

function legacyEffect() {
  const head = execFileSync("git", ["show", "HEAD:components/inbox/inbox-view.tsx"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const source = ts.createSourceFile("head.tsx", head, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  (function visit(node) {
    if (!effect && ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(source) === "useEffect" &&
      node.expression.arguments[0].getText(source).includes("fallbackId !==")) effect = node.getText(source);
    ts.forEachChild(node, visit);
  })(source);
  assert.ok(effect, "original URL selection effect found at HEAD");
  const context = { useEffect: React.useEffect };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(
    `globalThis.useLegacy = function ({ requestedConversationId, clientSelectedConversationId, liveConversations, selectConversationSmoothly }) { ${effect} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText, context);
  return context.useLegacy;
}

/* ------------------------------------------------------------ browser */

function browser(initialUrl) {
  const stack = [initialUrl];
  let index = 0;
  let reported = initialUrl;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const report = (value, lag) => {
    if (lag == null) { reported = value; notify(); return; }
    setTimeout(() => { reported = value; notify(); }, lag);
  };
  return {
    lag: null,
    get current() { return stack[index]; },
    get reported() { return reported; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    push(value) { stack.splice(index + 1); stack.push(value); index += 1; report(value, this.lag); },
    back() { index -= 1; report(stack[index], null); },
    forward() { index += 1; report(stack[index], null); },
  };
}

/* ------------------------------------------------------------- the Inbox */

function mount({ url, mode = "fixed", delays = {} }) {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = {};
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved[key] = global[key];
    global[key] = value;
  }

  const nav = browser(url);
  const requests = [];
  const legacy = mode === "legacy" ? legacyEffect() : null;
  let api;

  function Inbox() {
    const requested = React.useSyncExternalStore(nav.subscribe, () => nav.reported);
    const [selected, setSelected] = React.useState(requested);
    const [shown, setShown] = React.useState(requested ? `messages:${requested}` : null);
    const desired = React.useRef(selected);
    const controllers = React.useRef({});
    const ownPushes = React.useRef([]);

    const selectConversationSmoothly = React.useCallback(async (id, updateHistory = false) => {
      if (id === desired.current && id === selected) return;
      desired.current = id;
      setSelected(id);
      for (const [other, controller] of Object.entries(controllers.current)) {
        if (other !== id) { controller.aborted = true; delete controllers.current[other]; }
      }
      const controller = { aborted: false };
      controllers.current[id] = controller;
      const request = { id, aborted: () => controller.aborted };
      requests.push(request);
      if (updateHistory) { ownPushes.current.push(id); nav.push(id); }
      await new Promise((resolve) => setTimeout(resolve, delays[id] ?? 5));
      if (controller.aborted || desired.current !== id) return;
      setShown(`messages:${id}`);
    }, [selected]);

    const isAvailable = React.useCallback((id) => CONVERSATIONS.some((row) => row.id === id), []);
    const selectFromUrl = React.useCallback((id) => { void selectConversationSmoothly(id, false); }, [selectConversationSmoothly]);

    if (legacy) {
      legacy({ requestedConversationId: requested, clientSelectedConversationId: selected, liveConversations: CONVERSATIONS, selectConversationSmoothly });
    } else {
      useUrlConversationSelection({ requestedConversationId: requested, selectedConversationId: selected, isAvailable, select: selectFromUrl, ownPushesRef: ownPushes });
    }

    api = {
      // Old click path: no URL update. Fixed click path: URL updated.
      click: (id) => selectConversationSmoothly(id, mode !== "legacy"),
      state: () => ({ url: nav.current, reported: nav.reported, selected, header: selected, shown }),
    };
    return null;
  }

  const root = createRoot(dom.window.document.getElementById("root"));
  const settle = async (ms = 40) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };

  return {
    nav, requests, settle,
    start: async () => { await act(async () => root.render(React.createElement(Inbox))); await settle(); },
    click: async (id) => { await act(async () => { api.click(id); }); },
    state: () => api.state(),
    close: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value; }
    },
  };
}

const aligned = (state, id) => {
  assert.equal(state.selected, id, "active row");
  assert.equal(state.header, id, "header");
  assert.equal(state.url, id, "URL");
  assert.equal(state.shown, `messages:${id}`, "displayed messages");
};

/* ------------------------------------------------------------ reproduction */

test("REPRODUCTION (original code): A -> Menu -> Inbox, click B snaps back to A and aborts B", async () => {
  const inbox = mount({ url: "A", mode: "legacy" }); // remembered return URL ?conversation=A
  try {
    await inbox.start();
    await inbox.click("B");
    await inbox.settle();
    const state = inbox.state();
    assert.equal(state.url, "A", "URL never left A");
    assert.equal(state.selected, "A", "selection pulled back to A");
    assert.equal(inbox.requests.find((request) => request.id === "B").aborted(), true, "B's request was aborted");
  } finally { await inbox.close(); }
});

/* ------------------------------------------------------------------ fixed */

test("A -> Menu -> Inbox -> B -> C: URL, row, header and messages follow each click", async () => {
  const inbox = mount({ url: "A" });
  try {
    await inbox.start();
    await inbox.click("B"); await inbox.settle();
    aligned(inbox.state(), "B");
    await inbox.click("C"); await inbox.settle();
    aligned(inbox.state(), "C");
  } finally { await inbox.close(); }
});

test("useSearchParams lagging behind pushState cannot pull a click back", async () => {
  const inbox = mount({ url: "A" });
  try {
    await inbox.start();
    inbox.nav.lag = 30; // the URL keeps reporting A for a while after clicking B
    await inbox.click("B");
    await inbox.settle(5);
    assert.equal(inbox.state().reported, "A", "stale snapshot still visible");
    assert.equal(inbox.state().selected, "B", "but the click stands");
    await inbox.settle(80);
    aligned(inbox.state(), "B");
  } finally { await inbox.close(); }
});

test("rapid clicks with delayed responses and a lagging URL: the newest click wins everywhere", async () => {
  const inbox = mount({ url: "A", delays: { B: 60, C: 10, D: 30 } });
  try {
    await inbox.start();
    inbox.nav.lag = 15;
    await inbox.click("B");
    await inbox.click("C");
    await inbox.click("D");
    await inbox.settle(150);
    aligned(inbox.state(), "D");
    assert.equal(inbox.requests.find((request) => request.id === "B").aborted(), true, "older request cancelled");
    assert.equal(inbox.requests.find((request) => request.id === "C").aborted(), true, "older request cancelled");
  } finally { await inbox.close(); }
});

test("direct link to A, then B: B is selected and the URL follows", async () => {
  const inbox = mount({ url: "A" });
  try {
    await inbox.start();
    aligned(inbox.state(), "A");
    await inbox.click("B"); await inbox.settle();
    aligned(inbox.state(), "B");
  } finally { await inbox.close(); }
});

test("bare Inbox: nothing is forced open, and a click selects and sets the URL", async () => {
  const inbox = mount({ url: null });
  try {
    await inbox.start();
    assert.equal(inbox.state().selected, null);
    await inbox.click("C"); await inbox.settle();
    aligned(inbox.state(), "C");
  } finally { await inbox.close(); }
});

test("browser Back and Forward still move between conversations", async () => {
  const inbox = mount({ url: "A" });
  try {
    await inbox.start();
    await inbox.click("B"); await inbox.settle();
    await inbox.click("C"); await inbox.settle();
    await act(async () => inbox.nav.back()); await inbox.settle();
    aligned(inbox.state(), "B");
    await act(async () => inbox.nav.back()); await inbox.settle();
    aligned(inbox.state(), "A");
    await act(async () => inbox.nav.forward()); await inbox.settle();
    aligned(inbox.state(), "B");
  } finally { await inbox.close(); }
});

test("Back to a conversation whose own push was skipped by a lagging URL still navigates", async () => {
  const inbox = mount({ url: "A", delays: { B: 5, C: 5 } });
  try {
    await inbox.start();
    inbox.nav.lag = 20;
    await inbox.click("B");
    await inbox.click("C");   // the URL may jump straight from A to C
    await inbox.settle(100);
    aligned(inbox.state(), "C");
    await act(async () => inbox.nav.back()); await inbox.settle();
    aligned(inbox.state(), "B");
  } finally { await inbox.close(); }
});

test("a filter/channel URL without ?conversation= keeps the open thread", async () => {
  const inbox = mount({ url: "A" });
  try {
    await inbox.start();
    await inbox.click("B"); await inbox.settle();
    await act(async () => inbox.nav.push(null)); await inbox.settle();
    assert.equal(inbox.state().selected, "B");
    assert.equal(inbox.state().shown, "messages:B");
  } finally { await inbox.close(); }
});

/* ---------------------------------------------- wiring in the real InboxView */

test("the real InboxView routes row and search clicks through the URL and uses the fixed hook", () => {
  const source = fs.readFileSync("components/inbox/inbox-view.tsx", "utf8");
  const select = /const selectSearchConversation = useCallback\(\(conversationId: string, match\?: InboxSearchMatch\) => \{[\s\S]*?\}, \[selectConversationSmoothly\]\);/.exec(source);
  assert.ok(select, "selectSearchConversation found");
  assert.match(select[0], /selectConversationSmoothly\(conversationId, true\)/, "clicks update history");
  assert.match(source, /onSelectConversation=\{\s*selectSearchConversation/, "rows and search results use it");
  assert.match(source, /useUrlConversationSelection\(\{/);
  assert.match(source, /ownConversationUrlPushesRef\.current\.push\(\s*conversationId,?\s*\);\s*window\.history\.pushState/, "own pushes recorded before pushing");
  assert.doesNotMatch(source, /fallbackId !==\s*clientSelectedConversationId/, "old override effect removed");
});
