/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");
const { AdminConnections } = require("../../components/admin/admin-connections.tsx");

const h = React.createElement;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], requests = [], mutations = [], unexpectedRequests = [];
window.fixtureLanguage = new URLSearchParams(location.search).get("lang") === "km" ? "km" : "en";
const t = (en, km) => window.fixtureLanguage === "km" ? km : en;
function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), ...(detail ? { detail } : {}) });
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}
async function until(condition, label, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (condition()) return;
    await pause(20);
  }
  throw new Error(`Timed out: ${label}; ${document.body.innerText.slice(0, 1200)}`);
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
function item(index, kind, accountName, businessName, extra = {}) {
  const connection = {
    connectionId: `connection-${index}`, businessId: `business-${index}`, businessName, accountName,
    isActive: true, tokenStatus: kind === "telegram" ? "verified" : "valid", tokenError: null,
    createdAt: "2026-10-15T07:00:00.000Z", blocksReconnect: true,
    ...(kind === "telegram" ? { botId: String(900000 + index), botUsername: `fixture_bot_${index}`, webhookStatus: "active", webhookUrl: null, webhookRegisteredAt: null, connectedAt: "2026-10-15T07:00:00.000Z", hasStoredToken: true } : { pageId: String(800000 + index) }),
    ...extra,
  };
  return { kind, connection };
}
const completeInventory = [
  item(1, "telegram", "Alpha Help Bot", "North Hub", { botUsername: "alpha_help", businessId: "12345678-1234-4123-8123-123456789abc" }),
  item(2, "messenger", "Customer Messenger", "Alpha Retail"),
  item(3, "telegram", "សេវាអតិថិជន", "ភ្នំពេញកម្ពុជា", { botUsername: "khmer_help" }),
  item(4, "messenger", "ផ្សារខ្មែរ", "កម្ពុជាពាណិជ្ជកម្ម"),
  item(5, "telegram", "VeryLongUnbrokenChannelNameForMobileWrapping", "A Very Long Business Workspace Name"),
  item(6, "messenger", "Riverside Page", "Riverside Shop"),
];
const largeInventory = Array.from({ length: 245 }, (_, index) => item(index + 1000, index % 2 ? "messenger" : "telegram", `Channel ${String(index).padStart(3, "0")}`, `Business ${index}`));
largeInventory[210].connection.accountName = "Slow Search Channel";
largeInventory[211].connection.accountName = "Fast Search Channel";
largeInventory[233].connection.accountName = "BeyondLimit Search Channel";
largeInventory[233].connection.businessName = "Beyond 200 Workspace";
largeInventory[233].connection.botUsername = "beyond_limit";
let inventory = completeInventory.map(entry => ({ ...entry, connection: { ...entry.connection } }));
let responseStatus = 200, initialGate = null, slowQueryGate = null, pageGate = null;
let duplicatePages = false;
function searchMatches(entry, query) {
  const normalized = query.trim().normalize("NFC").toLowerCase();
  const connection = entry.connection;
  if (normalized.startsWith("@")) return entry.kind === "telegram" && Boolean(connection.botUsername?.replace(/^@/, "").toLowerCase().includes(normalized.slice(1)));
  return [connection.accountName, connection.businessName, entry.kind === "telegram" ? connection.botId : connection.pageId]
    .some(value => value?.normalize("NFC").toLowerCase().includes(normalized)) ||
    (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(normalized) && [connection.businessId, connection.connectionId].some(value => value.toLowerCase() === normalized));
}
window.fetch = async (url, options = {}) => {
  const target = new URL(url, location.href);
  const method = options.method || "GET";
  const request = { path: target.pathname, query: target.searchParams.get("query") || "", platform: target.searchParams.get("platform") || "all", offset: Number(target.searchParams.get("offset") || 0), limit: Number(target.searchParams.get("limit") || 50), paged: target.searchParams.get("paged"), method, cache: options.cache, aborted: false };
  requests.push(request);
  options.signal?.addEventListener("abort", () => { request.aborted = true; }, { once: true });
  if (target.origin !== location.origin || target.pathname !== "/api/tenh-admin/connections") {
    unexpectedRequests.push({ path: target.pathname, method });
    throw new Error(`Unexpected fixture request: ${target.pathname}`);
  }
  if (method === "POST") {
    const body = JSON.parse(options.body);
    mutations.push(body);
    const found = inventory.find(entry => entry.connection.connectionId === body.connectionId);
    if (!found || (found.kind === "telegram" ? body.confirmBotId !== found.connection.botId : body.confirmPageId !== found.connection.pageId)) return Response.json({ success: false, error: "Confirmation does not match" }, { status: 400 });
    found.connection.blocksReconnect = false;
    return Response.json({ success: true, message: "Fixture connection released" });
  }
  if (method !== "GET") throw new Error(`Unexpected method ${method}`);
  const status = responseStatus;
  let matching = inventory.filter(entry => (request.platform === "all" || entry.kind === request.platform) && searchMatches(entry, request.query));
  const end = Math.min(matching.length, request.offset + request.limit - (duplicatePages && request.offset > 0 ? 1 : 0));
  const start = duplicatePages && request.offset > 0 ? request.offset - 1 : request.offset;
  matching = matching.slice(start, end);
  const waiting = request.query.toLowerCase() === "slow" ? slowQueryGate : request.offset > 0 ? pageGate : initialGate;
  if (waiting) await waiting.promise;
  if (status !== 200) return Response.json({ success: false, error: status === 401 ? "Sign in required" : status === 403 ? "Admin access required" : "Temporary fixture failure" }, { status });
  const total = inventory.filter(entry => (request.platform === "all" || entry.kind === request.platform) && searchMatches(entry, request.query)).length;
  return Response.json({ success: true, items: matching, hasMore: end < total, nextOffset: end < total ? end : null, query: request.query, platform: request.platform });
};

const root = createRoot(document.getElementById("root"));
let mount = 0;
function render(fresh = false) {
  if (fresh) mount++;
  flushSync(() => root.render(h(React.StrictMode, null,
    h("main", { className: "mx-auto w-full max-w-7xl p-3 sm:p-5" }, h(AdminConnections, { key: mount })),
  )));
}
const rows = () => [...document.querySelectorAll("[data-connection-id]")];
const rowIds = () => rows().map(row => row.dataset.connectionId);
const search = () => document.querySelector('input[type="search"]');
const dialog = () => document.querySelector('[role="dialog"]');
const button = (label, scope = document) => [...scope.querySelectorAll("button")].find(element => element.textContent.trim() === label);
const loadMore = () => document.querySelector('[data-load-more]') || button(t("Load more", "ផ្ទុកបន្ថែម"));
const refresh = () => document.querySelector('[data-refresh-connections]') || button(t("Refresh", "ផ្ទុកឡើងវិញ"));
const releaseButton = row => row.querySelector('[data-release-connection]') || [...row.querySelectorAll("button")].find(element => /Release|ដោះលែង/.test(element.textContent));
function setInput(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function type(value, wait = 45) {
  setInput(search(), value);
  await pause(wait);
}
async function fresh(mode = "complete") {
  inventory = (mode === "large" ? largeInventory : mode === "empty" ? [] : completeInventory).map(entry => ({ ...entry, connection: { ...entry.connection } }));
  responseStatus = 200; initialGate = null; slowQueryGate = null; pageGate = null; duplicatePages = mode === "large";
  render(true);
  await until(() => mode === "empty" ? Boolean(search()) && !document.body.innerText.includes(t("Loading", "កំពុងផ្ទុក")) : rows().length === (mode === "large" ? 50 : completeInventory.length), `${mode} inventory loaded`);
}
function assertLayout(label) {
  check(`${label} no page overflow`, document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`);
  check(`${label} row content fits`, rows().every(row => row.scrollWidth <= row.clientWidth + 1), rows().map(row => `${row.scrollWidth}/${row.clientWidth}`).join(","));
}

async function runCompleteChecks() {
  await fresh();
  check("mixed inventory uses one row list", rows().length === 6 && rows().every(row => row.parentElement === rows()[0].parentElement));
  check("Telegram and Messenger rows are mixed", rows()[0].textContent.includes("Alpha Help Bot") && rows()[1].textContent.includes("Customer Messenger"));
  check("old platform count sections removed", !/Telegram\s*·\s*\d|Messenger\s*·\s*\d/.test(document.body.innerText));
  check("avatar backfill controls removed", !/Messenger customer photos|Fetch next 50 photos|Fetching avatars/.test(document.body.innerText));
  check("initial inventory uses opt-in paged read", requests.filter(request => request.method === "GET").every(request => request.paged === "true" && request.limit === 50 && request.cache === "no-store"));
  check("search has localized accessible name", Boolean(search()?.getAttribute("aria-label") || document.querySelector(`label[for="${search()?.id}"]`)));
  assertLayout("mixed list");
  if (innerWidth >= 768) check("rows stay compact", rows().every(row => row.getBoundingClientRect().height < 210), rows().map(row => row.getBoundingClientRect().height).join(","));
  const start = requests.length;
  for (const [query, expected] of [["  aLPHa  ", ["connection-1", "connection-2"]], ["@ALPHA_HELP", ["connection-1"]], ["North Hub", ["connection-1"]], ["ខ្មែរ", ["connection-4"]], ["កម្ពុជា", ["connection-3", "connection-4"]], ["12345678-1234-4123-8123-123456789abc", ["connection-1"]], ["12345678", []], ["*", []], ["@North", []]]) {
    await type(query);
    await until(() => JSON.stringify(rowIds()) === JSON.stringify(expected), `local query ${query}`);
    check(`complete local query ${query}`, JSON.stringify(rowIds()) === JSON.stringify(expected));
  }
  await type("nothing-will-match-this");
  await until(() => rows().length === 0, "local no results");
  check("local no results is explicit", /No .*match|No results|មិនមាន.*ត្រូវ|រកមិនឃើញ|គ្មានលទ្ធផល/.test(document.body.innerText));
  await type("");
  await until(() => rows().length === 6, "cleared local query");
  const platformFilter = document.querySelector("select");
  check("existing platform filter remains available", Boolean(platformFilter));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(platformFilter, "telegram");
  platformFilter.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => rows().length === 3, "local Telegram filter");
  check("complete platform filter stays within mixed inventory", rowIds().every(id => ["connection-1", "connection-3", "connection-5"].includes(id)));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(platformFilter, "all");
  platformFilter.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => rows().length === 6, "clear local platform filter");
  await pause(400);
  check("complete local typeahead does not fetch on keystrokes or clear", requests.length === start);
  check("search and row selection do not mutate", mutations.length === 0 && unexpectedRequests.length === 0);
  return { checks: checks.length, localSearchRequests: requests.length - start };
}

async function runServerChecks() {
  await fresh("large");
  check("incomplete inventory exposes paging", rows().length === 50 && Boolean(loadMore()));
  let start = requests.length;
  for (const query of ["b", "be", "bey", "beyond"]) await type(query, 25);
  await until(() => rowIds().includes(largeInventory[233].connection.connectionId), "server search reaches row beyond 200");
  const searchRequests = requests.slice(start).filter(request => request.query);
  check("incomplete search is debounced rather than one request per key", searchRequests.length === 1 && searchRequests[0].query.toLowerCase() === "beyond", JSON.stringify(searchRequests));
  check("server query finds records beyond first 200", rows().length === 1 && rows()[0].textContent.includes("BeyondLimit Search Channel"));
  const tokenRequestStart = requests.length;
  await type("900001:synthetic_token_not_a_real_credential", 450);
  check("pasted full Bot token never becomes a GET query", requests.length === tokenRequestStart && !requests.some(request => request.query.includes("synthetic_token")));
  check("pasted token shows a safe local warning", Boolean(document.querySelector('[role="alert"]')));
  await type("");
  await until(() => rows().length === 50, "clear incomplete server query");
  check("clear restores incomplete inventory", rowIds()[0] === largeInventory[0].connection.connectionId && rows().length === 50);

  slowQueryGate = gate();
  await type("slow");
  await until(() => requests.some(request => request.query === "slow"), "slow request starts");
  await type("fast");
  await until(() => rows().length === 1 && rows()[0].textContent.includes("Fast Search Channel"), "newer search wins");
  slowQueryGate.release(); slowQueryGate = null;
  await pause(100);
  check("late older search cannot replace newer results", rows().length === 1 && rows()[0].textContent.includes("Fast Search Channel"));

  await type(""); await until(() => rows().length === 50, "page test initial rows");
  pageGate = gate();
  loadMore().click();
  await until(() => requests.some(request => request.offset === 50), "old page request starts");
  await type("beyond");
  await until(() => rows().length === 1 && rows()[0].textContent.includes("BeyondLimit Search Channel"), "new query while old page pending");
  pageGate.release(); pageGate = null;
  await pause(100);
  check("late page cannot append to another query", rows().length === 1 && rows()[0].textContent.includes("BeyondLimit Search Channel"));

  await type(""); await until(() => rows().length === 50, "pagination reset");
  for (const expected of [99, 148, 197, 245]) {
    check(`Load more exists before ${expected}`, Boolean(loadMore()));
    loadMore().click();
    await until(() => rows().length === expected, `loaded ${expected} unique rows`);
    check(`${expected} rows contain no duplicate IDs`, new Set(rowIds()).size === expected);
  }
  check("all pages complete without a Load more control", !loadMore() || loadMore().disabled);
  check("paging and search remain read only", mutations.length === 0 && unexpectedRequests.length === 0);
  await type("beyond"); await until(() => rows().length === 1, "server evidence query");
  assertLayout("server search");
  return { checks: checks.length, requests: requests.length - start };
}

async function runStatesAndReleaseChecks() {
  await fresh();
  const before = mutations.length;
  releaseButton(rows()[0]).click();
  await until(dialog, "release confirmation");
  check("opening release selection does not mutate", mutations.length === before);
  const confirmation = dialog().querySelector("input");
  const confirmButton = () => [...dialog().querySelectorAll("button")].find(element => /Release|ដោះលែង/.test(element.textContent));
  check("release requires exact ID confirmation", Boolean(confirmation) && confirmButton().disabled);
  setInput(confirmation, "wrong"); await pause(30);
  check("wrong ID cannot release", confirmButton().disabled && mutations.length === before);
  setInput(confirmation, "900001:synthetic_token_not_a_real_credential"); await pause(30);
  check("full bot token remains blocked", confirmButton().disabled && mutations.length === before);
  const cancel = [...dialog().querySelectorAll("button")].find(element => /Cancel|បោះបង់/.test(element.textContent));
  cancel.click(); await until(() => !dialog(), "release cancelled");
  check("cancel retains selected connection without mutation", rowIds().includes("connection-1") && mutations.length === before);
  releaseButton(rows().find(row => row.dataset.connectionId === "connection-1")).click(); await until(dialog, "release reopened");
  setInput(dialog().querySelector("input"), "900001"); await pause(30);
  check("matching ID enables explicit release", !confirmButton().disabled);
  confirmButton().click(); await until(() => !dialog() && mutations.length === before + 1, "explicit mocked release");
  check("release preserves exact existing POST body", JSON.stringify(mutations.at(-1)) === JSON.stringify({ connectionId: "connection-1", confirmBotId: "900001" }), JSON.stringify(mutations.at(-1)));

  for (const status of [401, 403]) {
    await fresh(); responseStatus = status;
    check(`${status} refresh is available`, Boolean(refresh()));
    refresh().click();
    await until(() => rows().length === 0, `${status} clears previous rows`);
    check(`${status} refuses stale inventory`, rows().length === 0);
  }
  await fresh(); responseStatus = 500; refresh().click();
  await until(() => Boolean(document.querySelector('[role="alert"]')) && /failure|Unable|unavailable|មិនអាច|បរាជ័យ/.test(document.body.innerText), "server error state");
  check("server error is visible", Boolean(document.querySelector('[role="alert"]')));
  await fresh("empty");
  check("empty inventory has an explicit message", /No .*connections|No channels|មិនមាន.*ភ្ជាប់|គ្មាន/.test(document.body.innerText));

  inventory = completeInventory.map(entry => ({ ...entry, connection: { ...entry.connection } }));
  initialGate = gate(); render(true); await pause(60);
  check("loading inventory does not show stale rows", rows().length === 0 && /Loading|កំពុងផ្ទុក/.test(document.body.innerText));
  initialGate.release(); initialGate = null;
  await until(() => rows().length === 6, "loading response completes");
  check("no avatar or unrelated API requests", unexpectedRequests.length === 0);
  check("only explicit confirmation performs mutation", mutations.length === 1);
  assertLayout("final mixed inventory");
  return { checks: checks.length, mutations: [...mutations] };
}

window.adminConnectionsFixture = { runCompleteChecks, runServerChecks, runStatesAndReleaseChecks, result: () => ({ checks: [...checks], requests: [...requests], mutations: [...mutations], unexpectedRequests: [...unexpectedRequests], language: window.fixtureLanguage }) };
render();
