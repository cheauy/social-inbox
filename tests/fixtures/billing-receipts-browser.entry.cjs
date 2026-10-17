/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");
const { BillingHistoryView } = require("../../components/subscription/billing-history-view.tsx");
const { InvoiceReceiptView } = require("../../components/subscription/invoice-receipt-view.tsx");

const h = React.createElement;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const requests = [];
const printCalls = [];
const linkClicks = [];
window.fixtureLanguage = new URLSearchParams(location.search).get("lang") === "km" ? "km" : "en";
window.fixtureLinkClicks = linkClicks;
window.fixturePopupCalls = 0;
window.open = () => { window.fixturePopupCalls += 1; throw new Error("Unexpected popup"); };

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), ...(detail ? { detail } : {}) });
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}
async function until(condition, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (condition()) return;
    await pause(20);
  }
  throw new Error(`Timed out: ${label}; ${document.body.innerText.slice(0, 1000)}`);
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
const t = (en, km) => window.fixtureLanguage === "km" ? km : en;
const date = "2026-10-15T07:00:00.000Z";
const ids = Object.fromEntries(["sandbox", "production", "manual", "unknown", "missing"].map((name, index) => [name, `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`]));
const provenance = {
  sandbox: { provider: "payway", environment: "sandbox", providerVerified: true, confirmedPaid: false },
  production: { provider: "payway", environment: "production", providerVerified: true, confirmedPaid: true },
  manual: { provider: "manual", environment: "manual", providerVerified: false, confirmedPaid: true },
  unknown: { provider: "unknown", environment: "unknown", providerVerified: false, confirmedPaid: false },
  missing: { provider: "unknown", environment: "unknown", providerVerified: false, confirmedPaid: false },
};
const amounts = { sandbox: 900, production: 29, manual: 11, unknown: 700, missing: 5 };
const names = { sandbox: "Sandbox Workspace", production: "Production Workspace", manual: "Manual Workspace", unknown: "Historical Workspace", missing: "Receiptless Workspace" };
const items = Object.keys(ids).map(name => ({
  id: `payment-${name}`, sourceId: `source-${name}`, source: name === "manual" ? "manual" : "payway", businessId: `business-${name}`,
  workspaceName: names[name], transactionId: `transaction-${name}`, paymentMethod: name === "manual" ? "manual_bank_transfer" : "aba_payway",
  planCode: "pro", billingCycle: "monthly", amount: amounts[name], currency: "USD", status: "approved",
  providerStatus: name === "unknown" || name === "missing" ? null : "APPROVED", approvalCode: name === "production" ? "APPROVAL-123" : null,
  reviewNote: null, createdAt: date, paidAt: date, reviewedAt: date, periodStart: date, periodEnd: "2026-11-15T07:00:00.000Z",
  invoiceId: name === "missing" ? null : ids[name], invoiceNumber: name === "missing" ? null : `TENH-${name.toUpperCase()}`, ...provenance[name],
}));
const statusLabels = {
  pending: ["Payment pending.", "កំពុងរង់ចាំការទូទាត់។"],
  failed: ["Failed", "បានបរាជ័យ"], declined: ["Declined", "ត្រូវបានបដិសេធ"], rejected: ["Rejected", "ត្រូវបានច្រានចោល"],
  cancelled: ["Cancelled", "បានលុបចោល"], draft: ["Draft", "សេចក្ដីព្រាង"], recovery_required: ["Needs review", "ត្រូវការពិនិត្យ"],
  submitted: ["Payment pending.", "កំពុងរង់ចាំការទូទាត់។"],
};
for (const status of Object.keys(statusLabels)) items.push({
  ...items[0], id: `payment-${status}`, sourceId: `source-${status}`, workspaceName: `${status} Workspace`, transactionId: `transaction-${status}`,
  status, amount: 1234, invoiceId: ids.sandbox, ...provenance.unknown, paidAt: null, reviewedAt: null, periodStart: null, periodEnd: null,
});
const summary = { total: items.length, approved: 5, pending: 2, attention: 4, approvedUsdTotal: 40, testUsdTotal: 900, unverifiedUsdTotal: 705, receipts: 4 };
const invoices = Object.fromEntries(Object.keys(ids).map(name => [name, {
  id: ids[name], invoiceNumber: `TENH-${name.toUpperCase()}`, sourceType: name === "manual" ? "manual" : "payway", sourcePaymentId: `source-${name}`,
  transactionId: name === "unknown" ? null : `transaction-${name}`, workspaceName: names[name], customerName: "Receipt Customer", billingEmail: "billing@example.invalid",
  planCode: "pro", planName: name === "unknown" ? null : "Pro", billingCycle: "monthly", billingCycleLabel: "Monthly", amount: name === "unknown" ? null : amounts[name],
  currency: name === "unknown" ? null : "USD", paymentMethod: name === "manual" ? "manual_bank_transfer" : "aba_payway",
  approvalCode: name === "production" ? "APPROVAL-123" : null, status: "approved", paidAt: name === "unknown" ? null : date,
  periodStart: name === "unknown" ? null : date, periodEnd: name === "unknown" ? null : "2026-11-15T07:00:00.000Z",
  issuedAt: name === "unknown" ? null : date, createdAt: date, ...provenance[name],
}]));
let invoiceRoutes = {};
function resetRoutes() {
  invoiceRoutes = Object.fromEntries(Object.keys(ids).map(name => [ids[name], { status: 200, invoice: invoices[name] }]));
}
resetRoutes();
window.fetch = async (url, options = {}) => {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) throw new Error(`Nonlocal fixture request: ${target.origin}`);
  const request = { path: target.pathname, cache: options.cache, hasSignal: Boolean(options.signal), aborted: false };
  requests.push(request);
  const abort = () => { request.aborted = true; };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) { abort(); throw new DOMException("Aborted", "AbortError"); }
  let response;
  if (target.pathname === "/api/subscription/billing-history") response = { status: 200, body: { success: true, items, summary } };
  else if (target.pathname.startsWith("/api/subscription/invoices/")) {
    const route = invoiceRoutes[decodeURIComponent(target.pathname.split("/").pop())] || { status: 404 };
    if (route.wait) await new Promise((resolve, reject) => {
      route.wait.promise.then(resolve);
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    response = { status: route.status, body: route.status === 200 ? { success: true, invoice: route.invoice } : { success: false, error: "SECRET_DATABASE_DETAILS_MUST_NOT_RENDER" } };
  } else throw new Error(`Unexpected fixture API request: ${target.pathname}`);
  if (options.signal?.aborted) { abort(); throw new DOMException("Aborted", "AbortError"); }
  return Response.json(response.body, { status: response.status });
};

let fontGate = null, imageGate = null;
const originalFontsReady = document.fonts.ready;
Object.defineProperty(document.fonts, "ready", { configurable: true, get: () => fontGate?.promise || originalFontsReady });
const nativeDecode = HTMLImageElement.prototype.decode;
HTMLImageElement.prototype.decode = async function () {
  await nativeDecode.call(this).catch(() => {});
  if (imageGate) await imageGate.promise;
};
function setPrintMode(mode = "normal") {
  window.print = mode === "unsupported" ? undefined : () => {
    printCalls.push({ invoiceId: document.querySelector(".tenh-receipt-card")?.dataset.invoiceId, mode });
    if (mode === "throw") throw new Error("Fixture print failure");
  };
}
setPrintMode();

const root = createRoot(document.getElementById("root"));
let state = { screen: "history", invoiceId: ids.sandbox, autoPrint: false, mount: 0 };
function render(patch = {}) {
  state = { ...state, ...patch };
  flushSync(() => root.render(h(React.StrictMode, null,
    h("div", { className: "flex h-dvh min-h-0 flex-col overflow-hidden" },
      h("header", { "data-fixture-app-nav": true, className: "shrink-0 border-b bg-white p-3" }, "Fixture app navigation"),
      h("div", { className: "flex min-h-0 flex-1 overflow-hidden" },
        h("aside", { "data-fixture-app-nav": true, className: "hidden w-28 shrink-0 border-r bg-white p-3 lg:block" }, "Fixture sidebar"),
        h("main", { className: "min-h-0 min-w-0 flex-1 overflow-y-auto" }, state.screen === "history" ? h(BillingHistoryView, { key: state.mount }) : h(InvoiceReceiptView, {
          key: state.mount, invoiceId: state.invoiceId, autoPrint: state.autoPrint, returnTo: "/dashboard/subscription/billing-history",
        })),
      ),
    ),
  )));
}
async function history() {
  render({ screen: "history", mount: state.mount + 1 });
  await until(() => document.querySelectorAll("article").length === items.filter(item=>item.status !== "pending").length, "history loaded");
}
async function receipt(name = "sandbox", autoPrint = false, fresh = true) {
  render({ screen: "receipt", invoiceId: ids[name], autoPrint, ...(fresh ? { mount: state.mount + 1 } : {}) });
  await until(() => document.querySelector(".tenh-receipt-card")?.dataset.invoiceId === ids[name], `${name} receipt`);
}
const card = () => document.querySelector(".tenh-receipt-card");
const dialog = () => document.querySelector('[role="dialog"]');
const button = (text, scope = document) => [...scope.querySelectorAll("button")].find(element => element.textContent.trim() === text);
const pdfButton = () => button(t("Print / Save PDF", "បោះពុម្ព / រក្សាទុក PDF"));
const closeDialog = async () => { dialog().querySelector("button[aria-label]").click(); await until(() => !dialog(), "dialog closed"); };
const printCount = () => printCalls.length;
const noPaidClaim = text => !/(?:\bPaid\b|\bVerified by PayWay\b|Payment verified and approved|បានបង់ប្រាក់|បានផ្ទៀងផ្ទាត់ដោយ PayWay)/.test(text);

async function runHistoryChecks() {
  await history();
  check("history no horizontal overflow", document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`);
  check("history hides the requested intro and financial summary metrics", !/Review ABA PayWay|Real paid total|Test payments \(USD\)|Unverified approvals \(USD\)/.test(document.body.textContent));
  for (const item of items) {
    if(item.status === "pending") { check(`${item.id} pending is absent from history`, ![...document.querySelectorAll("article")].some(row=>row.textContent.includes(item.workspaceName))); continue; }
    const row = [...document.querySelectorAll("article")].find(element => element.textContent.includes(item.workspaceName));
    check(`${item.id} workspace name visible`, Boolean(row));
    const hasReceipt = item.status === "approved" && Boolean(item.invoiceId);
    check(`${item.id} row receipt eligibility`, Boolean(row.querySelector('a[href*="/invoices/"]')) === hasReceipt);
    if (statusLabels[item.status]) {
      check(`${item.status} status stays truthful`, row.textContent.includes(statusLabels[item.status][window.fixtureLanguage === "km" ? 1 : 0]) && noPaidClaim(row.textContent));
    }
    button(t("View details", "មើលព័ត៌មានលម្អិត"), row).click();
    await until(dialog, `${item.id} details`);
    const details = dialog();
    check(`${item.id} details workspace`, details.textContent.includes(item.workspaceName));
    const rect = details.getBoundingClientRect();
    check(`${item.id} responsive dialog`, rect.left >= 0 && rect.right <= innerWidth + 1 && details.scrollWidth <= details.clientWidth + 1, `${rect.left}/${rect.right}/${details.scrollWidth}/${details.clientWidth}`);
    const actions = [...details.querySelectorAll('a[href*="/invoices/"]')];
    check(`${item.id} details receipt eligibility`, hasReceipt ? actions.length === 2 : actions.length === 0);
    if (hasReceipt) {
      const pdf = actions.find(element => element.textContent.includes(t("Print / Save PDF", "បោះពុម្ព / រក្សាទុក PDF")));
      const view = actions.find(element => element !== pdf);
      const destination = pdf && new URL(pdf.href);
      check(`${item.id} PDF action is same-tab opt-in print`, Boolean(destination && destination.searchParams.get("autoprint") === "1" && destination.searchParams.get("return_to") === "/dashboard/subscription/billing-history" && !pdf.target && !view.target && !new URL(view.href).searchParams.has("autoprint")));
    } else {
      check(`${item.id} no prepared or paid claims`, noPaidClaim(details.textContent) && !details.textContent.includes("Receipt is being prepared") && !details.textContent.includes("បង្កាន់ដៃកំពុងត្រូវបានរៀបចំ"));
      if (item.status === "approved") check("approved missing invoice explicitly unavailable", details.textContent.includes(t("Receipt unavailable.", "មិនមានបង្កាន់ដៃទេ។")));
    }
    if (item.id === "payment-sandbox") check("sandbox details identify test without settlement", details.textContent.includes(t("Test payment", "ការទូទាត់សាកល្បង")) && details.textContent.includes(t("Test only · no real-money settlement", "ការសាកល្បងប៉ុណ្ណោះ · មិនមែនការទូទាត់ប្រាក់ពិត")) && noPaidClaim(details.textContent));
    if (item.id === "payment-manual") check("manual approval never claims PayWay verification", details.textContent.includes(t("Approved by TENH", "បានអនុម័តដោយ TENH")) && !details.textContent.includes(t("Verified by PayWay", "បានផ្ទៀងផ្ទាត់ដោយ PayWay")));
    if (item.id === "payment-unknown") check("unknown approval stays unverified", details.textContent.includes(t("Payment unverified", "មិនទាន់ផ្ទៀងផ្ទាត់ការទូទាត់")) && noPaidClaim(details.textContent));
    await closeDialog();
  }
  check("history never opened a popup or print dialog", window.fixturePopupCalls === 0 && printCount() === 0);
  const first = document.querySelector("article");
  button(t("View details", "មើលព័ត៌មានលម្អិត"), first).click();
  await until(dialog, "sandbox evidence dialog");
  return { checks: checks.length, items: items.length };
}

async function runReceiptChecks() {
  const before = printCount();
  for (const name of ["sandbox", "production", "manual", "unknown"]) {
    await receipt(name);
    await pause(35);
    check(`${name} ordinary view does not auto print`, printCount() === before);
    check(`${name} receipt uses saved workspace`, card().textContent.includes(names[name]));
    check(`${name} receipt localized heading`, card().querySelector("h1").textContent.trim() === t("TENH Receipt", "បង្កាន់ដៃ TENH"));
    check(`${name} receipt locale`, card().lang === window.fixtureLanguage);
    check(`${name} receipt fits viewport`, document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`);
    if (name === "sandbox") check("sandbox receipt has visible test warning and no paid claim", Boolean(card().querySelector(".tenh-receipt-test")) && card().textContent.includes(t("Test payment", "ការទូទាត់សាកល្បង")) && noPaidClaim(card().textContent));
    if (name === "production") check("production receipt has provider verification", card().textContent.includes(t("Verified by PayWay", "បានផ្ទៀងផ្ទាត់ដោយ PayWay")));
    if (name === "manual") check("manual receipt has TENH approval only", card().textContent.includes(t("Approved by TENH", "បានអនុម័តដោយ TENH")) && !card().textContent.includes(t("Verified by PayWay", "បានផ្ទៀងផ្ទាត់ដោយ PayWay")));
    if (name === "unknown") {
      check("unknown receipt does not fabricate missing money or dates", card().textContent.includes("—") && !card().textContent.includes("$0.00") && noPaidClaim(card().textContent));
      check("null saved plan name renders a placeholder", card().textContent.includes("TENH Chat —"));
    }
  }
  let count = printCount();
  pdfButton().click(); pdfButton().click();
  await until(() => printCount() === count + 1, "manual print once");
  check("manual print suppresses duplicate clicks", printCount() === count + 1);
  window.dispatchEvent(new Event("afterprint"));
  await pause(30);
  check("manual afterprint stays on receipt", Boolean(card()) && !pdfButton().disabled);

  const absentPlan = { ...invoices.unknown }; delete absentPlan.planName;
  invoiceRoutes[ids.unknown] = { status: 200, invoice: absentPlan };
  await receipt("unknown");
  check("missing saved plan name renders a placeholder", card().textContent.includes("TENH Chat —"));
  count = printCount(); pdfButton().click();
  await until(() => printCount() === count + 1, "missing plan receipt printing");
  check("missing plan receipt still prints once", printCalls.at(-1).invoiceId === ids.unknown);
  window.dispatchEvent(new Event("afterprint"));
  invoiceRoutes[ids.unknown] = { status: 200, invoice: invoices.unknown };

  count = printCount();
  const slowFetch = gate(); fontGate = gate(); imageGate = gate();
  invoiceRoutes[ids.sandbox].wait = slowFetch;
  render({ screen: "receipt", invoiceId: ids.sandbox, autoPrint: true, mount: state.mount + 1 });
  await pause(70);
  check("slow authorized fetch prints no loading state", !card() && printCount() === count);
  slowFetch.release();
  await until(card, "authorized sandbox loaded");
  await pause(50);
  check("auto print waits for fonts", printCount() === count);
  fontGate.release(); fontGate = null;
  await pause(50);
  check("auto print waits for image decode", printCount() === count);
  imageGate.release(); imageGate = null;
  delete invoiceRoutes[ids.sandbox].wait;
  await until(() => printCount() === count + 1, "authorized auto print once");
  render(); render();
  window.fixtureLanguage = window.fixtureLanguage === "km" ? "en" : "km"; render();
  await pause(40);
  window.fixtureLanguage = window.fixtureLanguage === "km" ? "en" : "km"; render();
  await pause(40);
  check("StrictMode and rerenders never repeat auto print", printCount() === count + 1);

  count = printCount();
  const staleRequestStart = requests.length;
  const staleFetch = gate(); invoiceRoutes[ids.sandbox].wait = staleFetch;
  render({ invoiceId: ids.sandbox, autoPrint: true, mount: state.mount + 1 });
  await pause(45);
  render({ invoiceId: ids.production });
  await until(() => card()?.dataset.invoiceId === ids.production && printCount() === count + 1, "new invoice auto print");
  staleFetch.release(); delete invoiceRoutes[ids.sandbox].wait;
  await pause(45);
  const obsoleteRequests = requests.slice(staleRequestStart).filter(request => request.path.endsWith(ids.sandbox));
  check("invoice ID change aborts old fetch and prints matching invoice only", printCount() === count + 1 && printCalls.at(-1).invoiceId === ids.production && obsoleteRequests.length > 0 && obsoleteRequests.every(request => request.aborted));

  count = printCount(); fontGate = gate();
  await receipt("sandbox", true);
  render({ invoiceId: ids.production });
  await until(() => card()?.dataset.invoiceId === ids.production, "new invoice awaiting fonts");
  fontGate.release(); fontGate = null;
  await until(() => printCount() === count + 1, "matching ready invoice printed");
  check("invoice change during readiness discards old print task", printCalls.at(-1).invoiceId === ids.production && printCount() === count + 1);

  for (const status of [401, 403, 404, 500]) {
    count = printCount();
    invoiceRoutes[ids.sandbox] = { status };
    render({ invoiceId: ids.sandbox, autoPrint: true, mount: state.mount + 1 });
    await until(() => !card() && document.body.innerText.includes(t("Unable to open receipt", "មិនអាចបើកបង្កាន់ដៃបានទេ")), `${status} error`);
    await pause(35);
    check(`${status} errors do not print or reveal server internals`, printCount() === count && !document.body.textContent.includes("SECRET_DATABASE_DETAILS_MUST_NOT_RENDER"));
    if (status === 401) check("401 supplies sign-in link", Boolean(document.querySelector('a[href="/login"]')));
    if (status === 404) check("404 says unavailable", document.body.innerText.includes(t("This receipt is unavailable.", "មិនមានបង្កាន់ដៃនេះទេ។")));
    if (status === 500) {
      check("500 supplies safe retry", Boolean(button(t("Retry", "ព្យាយាមម្តងទៀត"))));
      invoiceRoutes[ids.sandbox] = { status: 200, invoice: invoices.sandbox };
      button(t("Retry", "ព្យាយាមម្តងទៀត")).click();
      await until(() => card() && printCount() === count + 1, "successful authorized retry auto print");
      render(); await pause(40);
      check("retry success auto prints once", printCount() === count + 1);
    }
  }

  count = printCount();
  invoiceRoutes[ids.sandbox] = { status: 200, invoice: invoices.production };
  render({ invoiceId: ids.sandbox, autoPrint: true, mount: state.mount + 1 });
  await until(() => !card() && Boolean(button(t("Retry", "ព្យាយាមម្តងទៀត"))), "mismatched receipt response rejected");
  check("mismatched API receipt never renders or prints", printCount() === count && !document.body.innerText.includes(names.production));

  resetRoutes();
  for (const mode of ["throw", "unsupported"]) {
    setPrintMode(mode); count = printCount();
    await receipt("sandbox", true);
    await until(() => document.querySelector('[role="status"]')?.textContent.includes(t("browser menu", "ម៉ឺនុយកម្មវិធីរុករក")), `${mode} fallback`);
    render(); await pause(40);
    check(`${mode} printing gives localized fallback without repeat`, printCount() === count + (mode === "throw" ? 1 : 0) && !pdfButton().disabled);
  }
  setPrintMode();
  count = printCount();
  pdfButton().click();
  await until(() => printCount() === count + 1, "fallback manual recovery");
  window.dispatchEvent(new Event("afterprint"));
  await pause(20);
  check("manual recovery after failed auto stays on receipt", Boolean(card()) && !pdfButton().disabled);
  check("invoice requests use no-store and AbortController", requests.filter(request => request.path.includes("/invoices/")).every(request => request.cache === "no-store" && request.hasSignal));
  check("receipt actions never use window.open", window.fixturePopupCalls === 0);
  await receipt("sandbox");
  return { checks: checks.length, printCalls: [...printCalls], requests: requests.length };
}

window.billingFixture = {
  history, receipt, render, runHistoryChecks, runReceiptChecks,
  plan: async variant => {
    const invoice = { ...invoices.unknown };
    if (variant === "missing") delete invoice.planName;
    invoiceRoutes[ids.unknown] = { status: 200, invoice };
    await receipt("unknown");
  },
  result: () => ({ checks: [...checks], requests: [...requests], printCalls: [...printCalls], popupCalls: window.fixturePopupCalls, language: window.fixtureLanguage }),
  error: async (status = 404) => {
    invoiceRoutes[ids.sandbox] = { status };
    render({ screen: "receipt", invoiceId: ids.sandbox, autoPrint: true, mount: state.mount + 1 });
    await until(() => !card() && document.body.innerText.includes(t("Unable to open receipt", "មិនអាចបើកបង្កាន់ដៃបានទេ")), "print error evidence");
  },
};
render();
