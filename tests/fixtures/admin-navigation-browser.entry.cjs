/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");
const { TenhAdminWorkspace } = require("../../components/admin/tenh-admin-workspace.tsx");

const h = React.createElement;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], requests = [];
const tabs = ["overview", "billing", "usage", "manual-payments", "customer-reports", "announcements", "connections", "webhook-events", "channel-health", "security"];
const englishLabels = ["Overview", "Workspaces", "Usage", "Payment reviews", "Customer reports", "User alerts", "Connections", "Webhooks", "Diagnostics", "Security"];
const initialSummary = { manualSubmitted: 7, manualApproved: 11, manualRejected: 2, reportsOpen: 4, reportsReviewing: 3, reportsResolved: 9, reportActionable: 7, activeAnnouncements: 2, actionable: 16 };
let summary = { ...initialSummary };
window.fixtureLanguage = new URLSearchParams(location.search).get("lang") === "km" ? "km" : "en";
const originalPush = history.pushState.bind(history), originalReplace = history.replaceState.bind(history);
history.pushState = (...args) => { originalPush(...args); window.dispatchEvent(new Event("fixture-location")); };
history.replaceState = (...args) => { originalReplace(...args); window.dispatchEvent(new Event("fixture-location")); };
window.fixtureNavigate = (href, replace = false) => history[replace ? "replaceState" : "pushState"]({}, "", href);
window.fetch = async (url, options = {}) => {
  const target = new URL(url, location.href), method = options.method || "GET";
  requests.push({ path: target.pathname, method, cache: options.cache });
  if (target.origin !== location.origin || target.pathname !== "/api/tenh-admin/summary" || method !== "GET") throw new Error(`Unexpected fixture request: ${method} ${target.pathname}`);
  return Response.json({ success: true, summary: { ...summary } });
};

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), ...(detail ? { detail } : {}) });
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}
async function until(condition, label) {
  for (let attempt = 0; attempt < 180; attempt++) { if (condition()) return; await pause(20); }
  throw new Error(`Timed out: ${label}; ${document.body.innerText.slice(0, 1000)}`);
}
const visible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
const sidebar = () => document.querySelector("[data-admin-sidebar]");
const drawer = () => document.querySelector("[data-admin-drawer]");
const trigger = () => document.querySelector("[data-admin-menu-trigger]");
const main = () => document.querySelector("[data-admin-main]");
const currentNav = () => [...document.querySelectorAll("[data-admin-navigation]")].find(visible);
const navLinks = () => [...(currentNav()?.querySelectorAll("a") || [])];
const linkTab = link => new URL(link.href).searchParams.get("tab");
const panel = () => document.querySelector("[data-fixture-panel]");
const currentTab = () => panel()?.dataset.fixturePanel;
const activeLinks = () => navLinks().filter(link => link.getAttribute("aria-current") === "page");
const root = createRoot(document.getElementById("root"));
let mount = 0;
function render(fresh = false) {
  if (fresh) mount++;
  const requested = new URLSearchParams(location.search).get("tab");
  const initialTab = location.pathname.endsWith("/mfa") ? "security" : tabs.includes(requested) ? requested : "overview";
  flushSync(() => root.render(h(React.StrictMode, null,
    h("div", { "data-dashboard-shell": true, className: "flex h-dvh min-h-0 flex-col overflow-hidden" },
      h("header", { "data-dashboard-header": true, className: "flex h-14 shrink-0 items-center border-b border-slate-200 bg-white px-4 text-sm text-slate-700" }, "Fixture global header"),
      h("div", { className: "min-h-0 min-w-0 flex-1 overflow-hidden" }, h("div", { className: "h-full min-h-0 overflow-hidden" }, h(TenhAdminWorkspace, {
        key: mount, adminEmail: "admin.navigation.fixture@example.invalid", initialTab, adminMfaRequired: true,
      }))),
    ),
  )));
}
async function openDrawer() {
  check("mobile menu trigger is visible", visible(trigger()));
  trigger().focus(); trigger().click();
  await until(() => drawer()?.open, "native drawer opened");
  await pause(40);
}
async function closeDrawer() {
  document.querySelector("[data-admin-drawer-close]").click();
  await until(() => !drawer()?.open, "drawer closed");
  await pause(35);
}
async function ensureNavigation() { if (innerWidth < 1280 && !drawer()?.open) await openDrawer(); }
function assertActive(tab) {
  const links = [...document.querySelectorAll("[data-admin-navigation]")].flatMap(nav => [...nav.querySelectorAll('a[aria-current="page"]')]);
  check(`${tab} active state matches every shared navigation`, links.length > 0 && links.every(link => linkTab(link) === tab));
  check(`${tab} existing panel remains selected`, currentTab() === tab, currentTab());
}
async function navigate(tab) {
  await ensureNavigation();
  const link = navLinks().find(item => linkTab(item) === tab);
  check(`${tab} keeps existing route href`, link?.getAttribute("href") === `/dashboard/admin?tab=${tab}`, link?.getAttribute("href"));
  link.click();
  await until(() => new URLSearchParams(location.search).get("tab") === tab && currentTab() === tab, `${tab} navigation`);
  if (innerWidth < 1280) await until(() => !drawer()?.open, "navigation closes drawer");
  assertActive(tab);
}
function setInput(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const focusables = () => [...drawer().querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(element => visible(element) && !element.disabled && element.tabIndex >= 0);
function assertLayout(label) {
  check(`${label} has no page overflow`, document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`);
  check(`${label} content stays inside viewport`, Boolean(main()) && main().getBoundingClientRect().left >= 0 && main().getBoundingClientRect().right <= innerWidth + 1);
  if (innerWidth < 1280) {
    const bounds = trigger().getBoundingClientRect();
    check(`${label} menu trigger fits header`, bounds.left >= 0 && bounds.right <= innerWidth && bounds.height >= 40);
    const header = trigger().closest("header"), brand = [...header.children].find(element => element !== trigger() && visible(element));
    check(`${label} header controls do not overlap`, Boolean(brand) && bounds.right <= brand.getBoundingClientRect().left + 1);
    check(`${label} content starts below its header`, main().getBoundingClientRect().top >= header.getBoundingClientRect().bottom - 1);
  }
}
function linkHasBadge(tab, value) {
  const candidates = [...document.querySelectorAll("[data-admin-navigation] a")].filter(link => linkTab(link) === tab);
  return candidates.length > 0 && candidates.every(link => [...link.querySelectorAll("span")].some(span => span.textContent.trim() === String(value)));
}
async function changeSummary(next) {
  summary = { ...initialSummary, ...next };
  window.dispatchEvent(new Event("tenh-admin-summary-changed"));
  await pause(70);
}

async function runNavigationChecks() {
  await until(() => Boolean(main()) && Boolean(panel()), "workspace ready");
  await ensureNavigation();
  await until(() => linkHasBadge("overview", 16), "initial summary badges");
  const links = navLinks();
  check("all ten existing routes share one ordered menu", JSON.stringify(links.map(linkTab)) === JSON.stringify(tabs), links.map(linkTab).join(","));
  check("one active navigation item per menu", activeLinks().length === 1);
  check("new sidebar has no old card descriptions", !/Workspace traffic and safeguards|Revenue, subscriptions, and admin queues|Approve or reject transfer receipts|Every Page and Bot/.test(currentNav().textContent));
  check("all navigation targets are at least 44px high", links.every(link => link.getBoundingClientRect().height >= 44), links.map(link => link.getBoundingClientRect().height).join(","));
  check("long navigation labels fit without clipping", links.every(link => link.scrollWidth <= link.clientWidth + 1));
  check("navigation uses small outline icons", links.every(link => { const icon = link.querySelector("svg"); return icon && icon.getAttribute("fill") === "none" && icon.getAttribute("stroke") === "currentColor" && icon.getBoundingClientRect().width >= 16 && icon.getBoundingClientRect().width <= 24; }));
  if (window.fixtureLanguage === "en") {
    check("grouped menu keeps requested compact labels", links.every((link, index) => link.textContent.includes(englishLabels[index])));
    const groupText = currentNav().textContent.toUpperCase(), groups = ["GENERAL", "BILLING & SUPPORT", "CHANNELS", "SETTINGS"];
    const positions = groups.map(group => groupText.indexOf(group));
    check("navigation group order matches the mockup", positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), positions.join(","));
  }
  check("summary badges use returned counts", linkHasBadge("overview", 16) && linkHasBadge("manual-payments", 7) && linkHasBadge("customer-reports", 7) && linkHasBadge("announcements", 2));
  if (innerWidth >= 1280) {
    check("desktop sidebar is 240px", Math.abs(sidebar().getBoundingClientRect().width - 240) <= 1, sidebar().getBoundingClientRect().width);
    check("desktop hides menu trigger and drawer", !visible(trigger()) && !drawer()?.open);
  } else {
    check("tablet and mobile hide the permanent sidebar", !visible(sidebar()));
    check("drawer is a real modal dialog", drawer() instanceof HTMLDialogElement && drawer().matches(":modal"));
    await closeDrawer();
  }
  for (const tab of tabs) await navigate(tab);
  history.back();
  await until(() => currentTab() === "channel-health", "browser back");
  assertActive("channel-health");
  history.forward();
  await until(() => currentTab() === "security", "browser forward");
  assertActive("security");
  check("security panel retains existing MFA requirement prop", panel().dataset.mfaRequired === "true");
  history.pushState({}, "", "/dashboard/admin?tab=connections");
  await until(() => currentTab() === "connections", "direct query route resolution");
  assertActive("connections");
  history.pushState({}, "", "/dashboard/admin/mfa");
  await until(() => currentTab() === "security", "security MFA path route resolution");
  assertActive("security");
  history.pushState({}, "", "/dashboard/admin?tab=overview");
  await until(() => currentTab() === "overview", "overview restored");
  await changeSummary({ actionable: 12, manualSubmitted: 3, reportActionable: 5, activeAnnouncements: 4 });
  check("queue badges update dynamically", linkHasBadge("overview", 12) && linkHasBadge("manual-payments", 3) && linkHasBadge("customer-reports", 5) && linkHasBadge("announcements", 4));
  await changeSummary({ actionable: 156, manualSubmitted: 125, reportActionable: 8, activeAnnouncements: 3 });
  check("large badges are capped from live values", linkHasBadge("overview", "99+") && linkHasBadge("manual-payments", "99+"));
  await changeSummary(initialSummary);
  check("admin panels and navigation only read the mocked summary", requests.every(request => request.path === "/api/tenh-admin/summary" && request.method === "GET" && request.cache === "no-store"));
  assertLayout("navigation");
  return { checks: checks.length, routes: tabs.length };
}

async function prepareDrawerChecks() {
  await navigate("connections");
  const filter = panel().querySelector("input");
  setInput(filter, "Keep this channel filter"); await pause(30);
  await openDrawer();
  check("native modal focuses within the drawer", drawer().contains(document.activeElement));
  check("trigger exposes expanded state", trigger().getAttribute("aria-expanded") === "true");
  check("body and HTML scroll are locked", [document.body, document.documentElement].every(element => ["hidden", "clip"].includes(getComputedStyle(element).overflowY)));
  check("main pane scroll is locked", ["hidden", "clip"].includes(getComputedStyle(main()).overflowY));
  return { checks: checks.length, focusableCount: focusables().length };
}
function focusBoundary(which) { const list = focusables(); list[which === "first" ? 0 : list.length - 1].focus(); return list.length; }
function assertFocusBoundary(which) {
  const list = focusables(), expected = list[which === "first" ? 0 : list.length - 1];
  check(`native modal traps ${which === "first" ? "forward" : "reverse"} Tab`, document.activeElement === expected && drawer().contains(document.activeElement), document.activeElement?.outerHTML.slice(0, 180));
}
async function assertClosed(reason) {
  await until(() => !drawer()?.open, `${reason} closes drawer`); await pause(40);
  check(`${reason} restores trigger focus`, document.activeElement === trigger());
  check(`${reason} restores scroll`, getComputedStyle(document.body).overflowY !== "hidden" && getComputedStyle(document.documentElement).overflowY !== "hidden" && getComputedStyle(main()).overflowY !== "hidden");
  check(`${reason} preserves existing panel filters`, panel().querySelector("input")?.value === "Keep this channel filter");
}
async function checkShortDrawer() {
  await openDrawer();
  const last = navLinks().at(-1);
  last.scrollIntoView({ block: "end" }); await pause(45);
  const bounds = last.getBoundingClientRect();
  check("short drawer reaches its final route", bounds.top >= 0 && bounds.bottom <= innerHeight + 1, `${bounds.top}/${bounds.bottom}/${innerHeight}`);
  const scrollable = [drawer(), ...drawer().querySelectorAll("*")].some(element => element.scrollHeight > element.clientHeight + 1 && ["auto", "scroll"].includes(getComputedStyle(element).overflowY));
  check("drawer owns its vertical scrolling", scrollable);
  return { checks: checks.length, lastBounds: { top: bounds.top, bottom: bounds.bottom } };
}
async function checkSafeArea() {
  await openDrawer();
  const element = drawer(), originalStyle = element.style.cssText;
  check("drawer uses all four actual safe-area insets", ["top", "right", "bottom", "left"].every(side => originalStyle.includes(`safe-area-inset-${side}`)));
  try {
    Object.assign(element.style, { paddingTop: "28px", paddingBottom: "24px", paddingLeft: "8px", paddingRight: "8px" });
    await pause(45);
    const bounds = element.getBoundingClientRect(), close = document.querySelector("[data-admin-drawer-close]").getBoundingClientRect();
    check("synthetic safe area keeps close control reachable", close.top >= bounds.top + 28 && close.right <= bounds.right - 8 + 1 && close.bottom <= innerHeight - 24);
    const last = navLinks().at(-1); last.scrollIntoView({ block: "end" }); await pause(45);
    const lastBounds = last.getBoundingClientRect();
    check("synthetic safe area keeps final route reachable", lastBounds.top >= bounds.top + 28 && lastBounds.bottom <= bounds.bottom - 24 + 1, `${lastBounds.top}/${lastBounds.bottom}/${bounds.bottom}`);
    check("synthetic safe area has no horizontal overflow", element.scrollWidth <= element.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1);
  } finally {
    element.style.cssText = originalStyle;
  }
  check("actual safe-area environment style is restored", element.style.cssText === originalStyle);
  await closeDrawer();
  return { checks: checks.length, restoredStyle: element.style.cssText };
}
async function assertResizeClosed() {
  await until(() => !drawer()?.open && visible(sidebar()), "desktop resize closes drawer");
  check("desktop resize releases body/main locks", getComputedStyle(document.body).overflowY !== "hidden" && getComputedStyle(main()).overflowY !== "hidden");
  check("resize preserves content filters", panel().querySelector("input")?.value === "Keep this channel filter");
}
function colorChannels(color) {
  const context = document.createElement("canvas").getContext("2d");
  context.fillStyle = color; context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
}
function contrastFor(element) {
  const foreground = colorChannels(getComputedStyle(element).color);
  let background;
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    const channels = colorChannels(getComputedStyle(ancestor).backgroundColor);
    if (channels[3] > 250) { background = channels; break; }
  }
  const luminance = channels => channels.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(foreground), luminance(background || [255, 255, 255])].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
async function setTheme(theme) {
  document.documentElement.dataset.tenhWorkspaceTheme = theme;
  await pause(300);
  await ensureNavigation();
  check(`${theme} labels remain visible`, navLinks().every(link => visible(link) && link.scrollWidth <= link.clientWidth + 1));
  const contrastRatios = navLinks().map(contrastFor);
  check(`${theme} navigation text has readable contrast`, contrastRatios.every(ratio => ratio >= 4.5), contrastRatios.map(ratio => ratio.toFixed(2)).join(","));
  const badgeContrastRatios = [...currentNav().querySelectorAll("[data-admin-badge]")].map(contrastFor);
  check(`${theme} count badges have readable contrast`, badgeContrastRatios.length === 4 && badgeContrastRatios.every(ratio => ratio >= 4.5), badgeContrastRatios.map(ratio => ratio.toFixed(2)).join(","));
  assertLayout(`${theme} theme`);
  return { theme, contrastRatios, badgeContrastRatios, sidebarColor: getComputedStyle(currentNav()).color, background: getComputedStyle(sidebar() || drawer()).backgroundColor };
}

window.adminNavigationFixture = {
  runNavigationChecks, prepareDrawerChecks, openDrawer, closeDrawer, focusBoundary, assertFocusBoundary, assertClosed, checkShortDrawer, checkSafeArea, assertResizeClosed, setTheme,
  drawerBackdropPoint: () => { const bounds = drawer().getBoundingClientRect(); return { x: Math.min(innerWidth - 5, Math.max(bounds.right + 5, innerWidth - 12)), y: Math.max(80, innerHeight / 2) }; },
  assertDirect: async tab => { await until(() => currentTab() === tab, `${tab} initial direct route`); assertActive(tab); },
  result: () => ({ checks: [...checks], requests: [...requests], language: window.fixtureLanguage, currentTab: currentTab(), route: `${location.pathname}${location.search}` }),
};
render();
