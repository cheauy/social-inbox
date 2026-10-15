/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");
const { createRoot } = require("react-dom/client");
const stubs = require("./workspace-storage-browser-stubs.cjs");

const checks = [], mutations = [], listQueries = [], byteTransfers = [];
const mediaMeasurements = {};
const identity = { businessId: "fixture-business", memberId: "fixture-member" };
const actualNow = Date.now;
let fakeNow = null, online = true, revoked = false;
Date.now = () => fakeNow ?? actualNow();
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
const nativeInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
const renewalIntervals = new Map(); let nextInterval = -1;
window.setInterval = (callback, delay, ...args) => {
  if (delay !== 30_000) return nativeInterval(callback, delay, ...args);
  const id = nextInterval--; renewalIntervals.set(id, () => callback(...args)); return id;
};
window.clearInterval = id => { if (!renewalIntervals.delete(id)) nativeClearInterval(id); };
const visibilityObservers = new Set(); let visibleNames = null;
const intersects = target => visibleNames === null || visibleNames.has(target.closest("article")?.querySelector('button[aria-label]')?.getAttribute("aria-label").replace(/^(Select|Deselect) /, ""));
window.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set(); visibilityObservers.add(this); }
  observe(target) { this.targets.add(target); queueMicrotask(() => { if (this.targets.has(target)) this.callback([{ target, isIntersecting: intersects(target) }], this); }); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); visibilityObservers.delete(this); }
  takeRecords() { return []; }
};
function visibility(names) {
  visibleNames = new Set(names);
  for (const observer of visibilityObservers) for (const target of observer.targets) observer.callback([{ target, isIntersecting: intersects(target) }], observer);
}
const tickRenewals = () => { for (const callback of [...renewalIntervals.values()]) callback(); };
const previewModes = new Map(), favoriteGates = new Map();
const originalClient = stubs.createClient;
const prepared = new Map();
let sequence = 0, failedTransfer = false, lostFinalization = false;
stubs.createClient = () => ({
  ...originalClient(),
  storage: { from: () => ({ uploadToSignedUrl: async (path, _token, file) => {
    byteTransfers.push({ path, name: file.name, bytes: file.size });
    const operation = [...prepared.values()].find(item => item.path === path);
    if (!operation) return { error: new Error("Unknown prepared upload") };
    await new Promise(resolve => setTimeout(resolve, 30));
    if (file.name === "interrupted.png" && !failedTransfer) {
      failedTransfer = true; return { error: new Error("Simulated offline transfer") };
    }
    operation.uploaded = true;
    return { error: null };
  } }) },
});
const { WorkspaceStorageModal } = require("../../components/inbox/workspace-storage-modal.tsx");

const imageUrl = label => `/tenh-storage-media.svg?label=${encodeURIComponent(label)}`;
const categories = [{ id: "campaigns", name: "Campaigns", created_at: "2026-10-01", updated_at: "2026-10-01" }];
let files = Array.from({ length: 245 }, (_, index) => ({
  id: `file-${String(index + 1).padStart(3, "0")}`,
  name: `${index % 3 === 0 ? "Search image" : "Image"} ${String(index + 1).padStart(3, "0")}`,
  mimeType: index === 1 ? "video/mp4" : "image/png", sizeBytes: 1000 + index, kind: index === 1 ? "video" : "image",
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, -Math.floor(index / 3))).toISOString(),
  categoryId: index >= 210 ? "campaigns" : null,
  favorite: index === 240, deletedAt: null,
  contentVersion: `original-${index}`, previewExpiresAt: Date.now() + 600_000,
  previewUrl: index === 1 ? "data:video/mp4;base64,AAAA" : imageUrl(index + 1),
}));
const ordered = records => [...records].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
const json = (body, status = 200) => Response.json({ ...identity, ...body }, { status });
const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  const target = new URL(url, location.href);
  if (!target.pathname.startsWith("/api/workspace-storage/")) return nativeFetch(url, options);
  if (options.headers["x-tenh-business-id"] !== identity.businessId || options.headers["x-tenh-member-id"] !== identity.memberId) {
    return json({ success: false, error: "Fixture identity was not pinned" }, 403);
  }
  if (revoked) return json({ success: false, error: "Fixture membership revoked" }, 403);
  if (!options.method || options.method === "GET") {
    const query = Object.fromEntries(target.searchParams);
    listQueries.push(query);
    await new Promise(resolve => setTimeout(resolve, 35));
    const matching = ordered(files.filter(file =>
      (query.view !== "favorites" || file.favorite) &&
      (!query.view?.startsWith("category:") || file.categoryId === query.view.slice(9)) &&
      ((file.kind === "image" || file.kind === "video") === (query.kind !== "files")) &&
      file.name.toLowerCase().includes((query.q || "").toLowerCase()),
    ));
    const start = query.cursor ? matching.findIndex(file => file.id === query.cursor) + 1 : 0;
    const page = matching.slice(start, start + Math.min(30, Number(query.limit || 30)));
    const hasMore = start + page.length < matching.length;
    return json({ success: true, files: page, categories, canManage: true, organizationAvailable: true,
      hasMore, nextCursor: hasMore ? page.at(-1).id : null, pendingDeletions: [] });
  }
  const body = JSON.parse(options.body || "{}"); mutations.push(body);
  if (body.action === "prepare-upload") {
    let operation = body.uploadId && prepared.get(body.uploadId);
    if (!operation) {
      const uploadId = `prepared-${++sequence}`;
      operation = { uploadId, path: `${identity.businessId}/${uploadId}.png`, fileName: body.fileName,
        sizeBytes: body.sizeBytes, categoryId: body.categoryId, uploaded: false, result: null };
      prepared.set(uploadId, operation);
    }
    return json({ success: true, upload: { uploadId: operation.uploadId, path: operation.path, bucket: "mock-private", token: "synthetic" } });
  }
  if (body.action === "finalize-upload") {
    const operation = prepared.get(body.uploadId);
    if (!operation || operation.path !== body.storagePath) return json({ success: false, error: "Unknown upload" }, 403);
    if (!operation.uploaded) return json({ success: false, code: "UPLOAD_INCOMPLETE", error: "Upload has not completed" }, 409);
    if (!operation.result) {
      operation.result = { id: `added-${operation.uploadId}`, name: operation.fileName, mimeType: "image/png", kind: "image",
        sizeBytes: operation.sizeBytes, createdAt: new Date(Date.now() + sequence).toISOString(),
        categoryId: operation.categoryId, favorite: false, deletedAt: null,
        contentVersion: operation.uploadId, previewExpiresAt: Date.now() + 600_000, previewUrl: imageUrl(operation.uploadId) };
      files = [...files, operation.result];
    }
    if (operation.fileName === "lost-response.png" && !lostFinalization) {
      lostFinalization = true; throw new Error("Finalization response interrupted");
    }
    return json({ success: true, clientFile: operation.result });
  }
  if (body.action === "refresh-previews") {
    await new Promise(resolve => setTimeout(resolve, 35));
    const mode = previewModes.get(body.fileIds[0]);
    if (mode === "error") return json({ success: false, error: "Preview temporarily unavailable" }, 500);
    if (mode === "deny") { revoked = true; return json({ success: false, error: "Fixture membership revoked" }, 403); }
    if (mode === "missing") {
      files = files.filter(file => !body.fileIds.includes(file.id));
      return json({ success: true, previews: [] });
    }
    files = files.map(file => body.fileIds.includes(file.id)
      ? { ...file, previewUrl: imageUrl(`${file.id}-renewed-${Date.now()}`), previewExpiresAt: Date.now() + 600_000 } : file);
    return json({ success: true, previews: files.filter(file => body.fileIds.includes(file.id)).map(file => ({
      id: file.id, contentVersion: file.contentVersion, previewUrl: file.previewUrl, previewExpiresAt: file.previewExpiresAt,
    })) });
  }
  if (body.action === "toggle-favorite") {
    const gate = favoriteGates.get(body.fileId)?.shift();
    if (gate) { await gate.wait.promise; if (gate.fail) return json({ success: false, error: "Favorite change failed" }, 500); }
    files = files.map(file => file.id === body.fileId ? { ...file, favorite: body.favorite } : file);
    return json({ success: true, favorite: body.favorite });
  }
  return json({ success: false, error: `Unhandled fixture action ${body.action}` }, 400);
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (condition, description) => {
  for (let index = 0; index < 150; index++) { if (condition()) return; await pause(30); }
  throw new Error(`Timed out: ${description}`);
};
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
};
const dialog = () => document.querySelector('[role="dialog"][aria-label="Workspace Storage"]');
const button = text => [...dialog().querySelectorAll("button")].find(item => item.textContent.trim() === text);
const selectors = () => [...dialog().querySelectorAll('article > button[aria-label^="Select "], article > button[aria-label^="Deselect "]')];
const selected = () => selectors().filter(item => item.getAttribute("aria-pressed") === "true");
const nameOf = item => item.getAttribute("aria-label").replace(/^(Select|Deselect) /, "");
const fileOf = item => files.find(file => file.name === nameOf(item));
const favoriteButton = file => dialog().querySelector(`button[aria-label$="favorites: ${file.name}"]`);
const favoriteRequests = file => mutations.filter(item => item.action === "toggle-favorite" && item.fileId === file.id);
const previewRequests = file => mutations.filter(item => item.action === "refresh-previews" && item.fileIds.includes(file.id));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function refresh() {
  const count = listQueries.length; button("Refresh").click();
  await pause(60);
  await until(() => listQueries.length > count && button("Refresh") && loaded(), "refresh completion");
}
const loaded = () => !dialog()?.querySelector('[aria-label="Loading workspace files"]');
async function chooseView(name) {
  const count = listQueries.length;
  button(name).click();
  await until(() => listQueries.length > count && loaded() && !button("Refreshing…"), `${name} view`);
}
async function allPages() {
  while (button("Load more")) {
    const count = selectors().length;
    button("Load more").click();
    await until(() => selectors().length > count, "next page");
  }
}
async function search(value) {
  const input = document.getElementById("storage-search"), count = listQueries.length;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await until(() => listQueries.length > count && listQueries.at(-1).q === value && loaded(), "search server response");
}

const root = createRoot(document.getElementById("root"));
const modal = () => React.createElement(WorkspaceStorageModal, {
  businessId: identity.businessId, memberId: identity.memberId, onClose() {},
  onSend: async () => true, onDraft: async () => true,
});
root.render(modal());

(async () => {
  let observer;
  try {
    await until(() => dialog() && loaded() && selectors().length === 30, "first server page");
    const first = selectors()[0], grid = first.closest("article").parentElement;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
    check("first page stays bounded to 30 records", selectors().length === 30 && listQueries.length === 1);
    check("images use native lazy loading", [...grid.querySelectorAll("img")].every(image => image.loading === "lazy"));
    await allPages();
    const allLabels = selectors().map(item => item.getAttribute("aria-label"));
    check("server pagination reaches all 245 files", allLabels.length === 245, String(allLabels.length));
    check("stable tied ordering has no duplicate or missing items", new Set(allLabels).size === 245 && files.every(file => allLabels.includes(`Select ${file.name}`)));
    check("continuation requests remain bounded", listQueries.every(query => query.limit === "30") && listQueries.length === 9);

    await chooseView("Campaigns");
    check("older category applies on the server before pagination", selectors().length === 30 && listQueries.at(-1).view === "category:campaigns" && selectors().every(item => /2[1-4][0-9]/.test(item.getAttribute("aria-label"))));
    await allPages();
    check("older category continuation reaches all matching files", selectors().length === 35);
    await chooseView("Favorites");
    check("older favorite outside newest 200 remains visible", selectors().length === 1 && selectors()[0].getAttribute("aria-label").includes("241") && listQueries.at(-1).view === "favorites");
    await chooseView("Recent");
    await search("Search image");
    await allPages();
    const matching = files.filter(file => file.name.includes("Search image"));
    check("multi-page search includes older matches without duplicates", selectors().length === matching.length && new Set(selectors().map(item => item.getAttribute("aria-label"))).size === matching.length);
    await search("");
    await chooseView("Campaigns");
    const storage = dialog(), original = selectors()[0], image = original.querySelector("img"), source = image.src;
    const name = original.getAttribute("aria-label").slice(7);
    original.click(); await pause(40);
    const main = storage.querySelector("main"); main.scrollTop = 120;
    check("category fixture has scrollable content", main.scrollTop > 0);
    let skeletonFlashes = 0, removedExistingImage = 0;
    observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node.nodeType === 1 && (node.matches('[aria-label="Loading workspace files"]') || node.querySelector('[aria-label="Loading workspace files"]'))) skeletonFlashes++;
        for (const node of record.removedNodes) if (node === image || (node.nodeType === 1 && node.contains(image))) removedExistingImage++;
      }
    });
    observer.observe(storage, { childList: true, subtree: true });
    const beforeUploadReads = listQueries.length;
    const retainedMediaBefore = performance.getEntriesByName(source).length;
    const input = storage.querySelector('input[type="file"]'), data = new DataTransfer();
    for (const filename of ["success.png", "interrupted.png", "lost-response.png"]) data.items.add(new File(["mock"], filename, { type: "image/png" }));
    data.items.add(new File([], "invalid.png", { type: "image/png" }));
    input.files = data.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => button("Retry failed uploads") && button("Upload") && storage.textContent.includes("invalid.png"), "mixed upload completion");
    check("upload completion merges without any full-list refresh", listQueries.length === beforeUploadReads);
    check("mixed upload retains each failed filename and reason", storage.textContent.includes("interrupted.png: Simulated offline transfer") && storage.textContent.includes("lost-response.png: Finalization response interrupted") && storage.textContent.includes("invalid.png:"));
    check("successful upload is visible despite other failures", selectors().some(item => item.getAttribute("aria-label") === "Select success.png"));
    check("existing thumbnail DOM and valid URL survive upload", image.isConnected && storage.querySelector(`button[aria-label="Deselect ${name}"] img`) === image && image.src === source);
    check("upload preserves selected record, category and scroll", selected().length === 1 && button("Campaigns").getAttribute("aria-pressed") === "true" && main.scrollTop > 0);

    const count = listQueries.length, refreshPages = Math.ceil(selectors().length / 30);
    button("Refresh").click();
    await until(() => listQueries.length === count + refreshPages && button("Refresh") && selectors().some(item => item.getAttribute("aria-label") === "Select lost-response.png"), "background reconciliation refresh");
    check("background refresh preserves valid thumbnail DOM and URL", image.isConnected && storage.querySelector(`button[aria-label="Deselect ${name}"] img`) === image && image.src === source);
    check("background refresh preserves visible upload failures", storage.textContent.includes("interrupted.png: Simulated offline transfer") && storage.textContent.includes("lost-response.png: Finalization response interrupted"));
    check("background refresh preserves selected record, category and scroll", selected().length === 1 && button("Campaigns").getAttribute("aria-pressed") === "true" && main.scrollTop > 0);
    const successfulTransfers = byteTransfers.filter(item => item.name === "success.png").length;
    const reconciledFavorite = files.find(file => file.name === "lost-response.png");
    favoriteButton(reconciledFavorite).click();
    await until(() => files.find(file => file.id === reconciledFavorite.id).favorite, "favorite before upload reconciliation");
    const lostTransfers = byteTransfers.filter(item => item.name === "lost-response.png").length;
    button("Retry failed uploads").click();
    await until(() => button("Upload") && !storage.textContent.includes("Simulated offline transfer") && !storage.textContent.includes("Finalization response interrupted"), "failed-only reconciliation");
    check("retry keeps successful file bytes untouched", byteTransfers.filter(item => item.name === "success.png").length === successfulTransfers);
    check("lost finalization retries confirmation without retransferring bytes", byteTransfers.filter(item => item.name === "lost-response.png").length === lostTransfers);
    const resumed = mutations.filter(item => item.action === "prepare-upload" && item.fileName === "interrupted.png");
    check("finalization retry preserves an independent Favorite", favoriteButton(reconciledFavorite).getAttribute("aria-pressed") === "true");
    check("interrupted transfer reuses its original prepared upload", resumed.length === 2 && resumed[1].uploadId && new Set(byteTransfers.filter(item => item.name === "interrupted.png").map(item => item.path)).size === 1);
    check("invalid file feedback remains visible without a server upload", storage.textContent.includes("invalid.png:") && !mutations.some(item => item.fileName === "invalid.png"));
    const names = selectors().map(item => item.getAttribute("aria-label"));
    check("refresh and idempotent retries never duplicate files", ["success.png", "interrupted.png", "lost-response.png"].every(filename => names.filter(name => name === `Select ${filename}`).length === 1));
    await pause(60); observer.disconnect();
    check("upload and background refresh never flash a global skeleton", skeletonFlashes === 0, String(skeletonFlashes));
    check("existing thumbnail is never removed from the DOM", removedExistingImage === 0, String(removedExistingImage));
    const retainedMedia = performance.getEntriesByName(source).slice(retainedMediaBefore);
    Object.assign(mediaMeasurements, { observedThumbnailRemovals: removedExistingImage, globalSkeletonFlashes: skeletonFlashes,
      uploadListRequests: count - beforeUploadReads, retainedThumbnailRequests: retainedMedia.length,
      retainedThumbnailTransferredBytes: retainedMedia.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) });
    check("retained thumbnail makes no additional HTTP request during upload and refresh", retainedMedia.length === 0 && mediaMeasurements.retainedThumbnailTransferredBytes === 0);

    await chooseView("Recent");
    const favoriteFiles = selectors().map(fileOf).filter(file => file.kind === "image" && !file.favorite);
    const [favoriteA, favoriteB] = favoriteFiles;
    const firstToggle = deferred(), secondToggle = deferred();
    favoriteGates.set(favoriteA.id, [{ wait: firstToggle }, { wait: secondToggle }]);
    const beforeToggles = favoriteRequests(favoriteA).length;
    favoriteButton(favoriteA).click(); favoriteButton(favoriteA).click();
    await until(() => favoriteRequests(favoriteA).length === beforeToggles + 1, "first serialized favorite");
    check("rapid same-file toggles wait for the prior server response", favoriteRequests(favoriteA).length === beforeToggles + 1 && favoriteRequests(favoriteA).at(-1).favorite === true);
    firstToggle.resolve();
    await until(() => favoriteRequests(favoriteA).length === beforeToggles + 2, "second serialized favorite");
    check("the queued toggle carries the final user intent", favoriteRequests(favoriteA).at(-1).favorite === false);
    secondToggle.resolve();
    await until(() => favoriteButton(favoriteA).getAttribute("aria-pressed") === "false", "settled repeated favorite");
    await pause(35);
    check("same-file toggle ends in the final confirmed server state", files.find(file => file.id === favoriteA.id).favorite === false);

    const slowA = deferred(), fastB = deferred();
    favoriteGates.set(favoriteA.id, [{ wait: slowA }]); favoriteGates.set(favoriteB.id, [{ wait: fastB }]);
    favoriteButton(favoriteA).click(); favoriteButton(favoriteB).click();
    await until(() => favoriteRequests(favoriteA).length === beforeToggles + 3 && favoriteRequests(favoriteB).length === 1, "independent favorites started");
    fastB.resolve();
    await until(() => files.find(file => file.id === favoriteB.id).favorite, "second favorite commits first");
    slowA.resolve();
    await until(() => files.find(file => file.id === favoriteA.id).favorite, "first favorite commits late");
    await refresh();
    check("independent out-of-order successes both survive refresh", favoriteButton(favoriteA).getAttribute("aria-pressed") === "true" && favoriteButton(favoriteB).getAttribute("aria-pressed") === "true");

    const failedA = deferred(); favoriteGates.set(favoriteA.id, [{ wait: failedA, fail: true }]);
    favoriteButton(favoriteA).click(); favoriteButton(favoriteB).click();
    await until(() => !files.find(file => file.id === favoriteB.id).favorite, "independent success while another fails");
    failedA.resolve();
    await until(() => storage.textContent.includes("Favorite change failed") && favoriteButton(favoriteA).getAttribute("aria-pressed") === "true", "failed operation rollback");
    check("favorite rollback changes only its failed entity", favoriteButton(favoriteA).getAttribute("aria-pressed") === "true" && favoriteButton(favoriteB).getAttribute("aria-pressed") === "false");
    files = files.map(file => file.id === favoriteA.id ? { ...file, favorite: false } : file);
    await refresh();
    check("refresh accepts a newer server favorite state", favoriteButton(favoriteA).getAttribute("aria-pressed") === "false");
    favoriteButton(favoriteA).click();
    await until(() => files.find(file => file.id === favoriteA.id).favorite, "toggle after server refresh");
    check("settled favorite queues cannot override later server state", favoriteRequests(favoriteA).at(-1).favorite === true);

    const video = storage.querySelector("video");
    check("video thumbnails avoid metadata preloading", Boolean(video) && video.preload === "none");
    const previewFiles = selectors().filter(item => item.querySelector("img")).slice(0, 6).map(fileOf);
    const [expiring, lazy, failing, deleted, denied] = previewFiles;
    const imageFor = file => selectors().find(item => nameOf(item) === file.name)?.querySelector("img");
    visibility([]);
    const originalUrl = imageFor(expiring).src;
    fakeNow = actualNow() + 9 * 60_000;
    visibility([expiring.name]); tickRenewals(); tickRenewals();
    await until(() => imageFor(expiring).src !== originalUrl, "visible preview expiry renewal");
    check("near-expiry visible preview renews once despite overlapping triggers", previewRequests(expiring).length === 1);
    check("offscreen lazy previews do not renew with visible images", previewRequests(lazy).length === 0);
    const firstRenewedUrl = imageFor(expiring).src;
    fakeNow += 9 * 60_000; tickRenewals(); tickRenewals();
    await until(() => imageFor(expiring).src !== firstRenewedUrl, "modal left open past another URL lifetime");
    check("an open modal renews again near the next URL expiry", previewRequests(expiring).length === 2);
    visibility([lazy.name]);
    await until(() => previewRequests(lazy).length === 1 && files.find(file => file.id === lazy.id).previewExpiresAt > Date.now(), "lazy image becomes visible after expiry");
    check("expired lazy image renews only when it becomes needed", previewRequests(lazy).length === 1);
    online = false; fakeNow += 9 * 60_000; tickRenewals();
    window.dispatchEvent(new Event("online")); await pause(20);
    check("offline expiry does not repeatedly request new links", previewRequests(lazy).length === 1);
    online = true; window.dispatchEvent(new Event("online"));
    await until(() => previewRequests(lazy).length === 2, "online preview recovery");
    await pause(45);
    check("returning online resumes the affected visible preview", previewRequests(lazy).length === 2);

    visibility([]); previewModes.set(failing.id, "error");
    const imageError = file => imageFor(file).dispatchEvent(new Event("error"));
    for (let index = 0; index < 10; index++) imageError(failing);
    await pause(60);
    check("image-error storms share one preview renewal", previewRequests(failing).length === 1);
    imageError(failing); await pause(20);
    check("failed preview waits for backoff before retry", previewRequests(failing).length === 1);
    fakeNow += 2_001; imageError(failing); await pause(60);
    check("preview retries after its first backoff", previewRequests(failing).length === 2);
    fakeNow += 4_001; imageError(failing); await pause(60);
    fakeNow += 8_001; for (let index = 0; index < 10; index++) imageError(failing);
    await pause(30);
    check("preview failures are bounded to three attempts per retry window", previewRequests(failing).length === 3);

    previewModes.set(deleted.id, "missing"); imageError(deleted);
    await until(() => !imageFor(deleted), "deleted preview removal");
    check("missing preview removes the stale downloadable record", !selectors().some(item => nameOf(item) === deleted.name));
    previewModes.set(denied.id, "deny"); imageError(denied);
    await until(() => revoked && selectors().length === 0, "permission revocation clears private previews");
    check("preview permission denial clears all inaccessible records", storage.querySelectorAll("article img, article video").length === 0);
    root.render(null); await pause(30); root.render(modal());
    await until(() => dialog() && loaded() && dialog().textContent.includes("Fixture membership revoked"), "reopen revoked workspace");
    check("revoked preview data cannot return from the warm cache", selectors().length === 0 && dialog().querySelectorAll("article img, article video").length === 0);
    Date.now = actualNow;
    document.getElementById("result").textContent = JSON.stringify({ passed: true, width: innerWidth, columns, checks,
      fixtureMediaSource: "local-http-svg", listRequests: listQueries.length, mediaMeasurements, byteTransfers, mutations: mutations.map(item => item.action) });
  } catch (error) {
    observer?.disconnect();
    document.getElementById("result").textContent = JSON.stringify({ passed: false, width: innerWidth, error: error.message,
      checks, listQueries, byteTransfers, mutations, body: document.body.innerText.slice(0, 1600) });
  }
})();
