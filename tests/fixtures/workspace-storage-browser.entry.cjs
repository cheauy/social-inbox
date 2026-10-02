/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");
const { createRoot } = require("react-dom/client");
const { ReplyBox } = require("../../components/inbox/reply-box.tsx");

const h = React.createElement;
const checks = [];
const mutations = [];
const alerts = [];
window.alert = message => alerts.push(String(message));
let sendCalls = 0;
let listRequests = 0;
let categories = [
  { id: "campaigns", name: "Campaigns", created_at: "2026-10-01", updated_at: "2026-10-01" },
  { id: "products", name: "Products", created_at: "2026-10-01", updated_at: "2026-10-01" },
];
let files = Array.from({ length: 7 }, (_, index) => ({
  id: `photo-${index + 1}`,
  name: `Photo ${index + 1}`,
  mimeType: "image/jpeg",
  sizeBytes: 1200 + index,
  kind: "image",
  createdAt: new Date(Date.UTC(2026, 9, 8, 0, 0, index)).toISOString(),
  categoryId: index < 2 ? "campaigns" : null,
  favorite: false,
  deletedAt: null,
  previewUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="hsl(${index * 45} 70% 70%)"/><text x="16" y="64">${index + 1}</text></svg>`)}`,
}));
files.push({ id: "document-1", name: "Price list.pdf", mimeType: "application/pdf", sizeBytes: 2048, kind: "file", createdAt: "2026-10-08T00:00:00Z", categoryId: null, favorite: false, deletedAt: null, previewUrl: null });

const json = (value, status = 200) => Response.json(value, { status });
window.fetch = async (url, options = {}) => {
  const target = new URL(url, location.href);
  if (target.pathname === "/api/workspace-storage/files" && (!options.method || options.method === "GET")) {
    listRequests += 1;
    await new Promise(resolve => setTimeout(resolve, 80));
    return json({ success: true, canManage: true, organizationAvailable: true, categories, files });
  }
  const body = options.body ? JSON.parse(options.body) : {};
  mutations.push({ path: target.pathname, ...body });
  if (target.pathname === "/api/workspace-storage/categories") {
    if (body.action === "add") categories = [...categories, { id: `category-${categories.length}`, name: body.name, created_at: "2026-10-08", updated_at: "2026-10-08" }];
    if (body.action === "edit") categories = categories.map(item => item.id === body.categoryId ? { ...item, name: body.name } : item);
    if (body.action === "delete") { categories = categories.filter(item => item.id !== body.categoryId); files = files.map(file => file.categoryId === body.categoryId ? { ...file, categoryId: null } : file); }
    return json({ success: true });
  }
  if (body.action === "get-file-url") {
    const file = files.find(item => item.id === body.fileId);
    return file ? json({ success: true, signedUrl: file.previewUrl || "data:application/pdf,fixture" }) : json({ success: false, error: "Not found" }, 404);
  }
  if (body.action === "toggle-favorite") files = files.map(file => file.id === body.fileId ? { ...file, favorite: body.favorite } : file);
  if (body.action === "set-category") files = files.map(file => body.fileIds.includes(file.id) ? { ...file, categoryId: body.categoryId } : file);
  if (body.action === "delete-files") {
    files = files.filter(file => !body.fileIds.includes(file.id));
    return json({ success: true, deletedIds: body.fileIds, failedIds: [] });
  }
  return json({ success: true, favorite: body.favorite });
};

function App() {
  const [reply, setReply] = React.useState("Keep this typed text");
  return h("div", { className: "fixed inset-x-0 bottom-0 p-3" }, h(ReplyBox, {
    storageBusinessId: "fixture-business",
    storageMemberId: "fixture-member",
    platform: "telegram",
    reply,
    conversationId: "fixture-conversation",
    sending: false,
    error: null,
    contactId: "fixture-contact",
    businessId: "fixture-business",
    initialTags: [],
    onReplyChange: setReply,
    onSubmit: () => {},
    onSendAttachments: async () => { sendCalls += 1; return true; },
  }));
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
};
const buttonText = text => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === text);
const selectedText = count => [...document.querySelectorAll("span")].some(span => span.textContent.trim() === `${count} selected`);

createRoot(document.getElementById("root")).render(h(App));

(async () => {
  try {
    await pause(180);
    document.querySelector('button[aria-label="Attach content"]').click();
    await pause(100);
    const menu = document.querySelector('[role="menu"]');
    check("attachment menu opens", Boolean(menu));
    const menuRect = menu.getBoundingClientRect();
    check("attachment menu stays inside viewport", menuRect.left >= 0 && menuRect.right <= innerWidth && menu.scrollWidth <= menu.clientWidth, `${menuRect.left}/${menuRect.right}/${innerWidth}`);
    check("attachment menu exact labels and subtitles", menu.textContent.includes("Image & Video & File") && menu.textContent.includes("Select files directly from your device") && menu.textContent.includes("Storage") && menu.textContent.includes("Select from storage") && menu.textContent.includes("Send location"));
    const storageMenuItem = [...menu.querySelectorAll("button")].find(button => button.textContent.includes("Storage"));
    check("Storage menu item is actionable", Boolean(storageMenuItem));
    storageMenuItem.click();
    await pause(20);

    const coldStorage = document.querySelector('[role="dialog"][aria-label="Workspace Storage"]');
    check("cold open waits for authenticated data", Boolean(coldStorage?.querySelector('[role="status"][aria-label="Loading workspace files"]')) && !coldStorage?.querySelector('button[aria-label="Select Photo 1"]'));
    await pause(240);

    const storage = document.querySelector('[role="dialog"][aria-label="Workspace Storage"]');
    check("Storage dialog opens", Boolean(storage));
    const storageRect = storage.getBoundingClientRect();
    check("Storage dialog fits viewport", storageRect.left >= 0 && storageRect.right <= innerWidth && storage.scrollWidth <= storage.clientWidth, `${storage.scrollWidth}/${storage.clientWidth}`);
    const firstSelect = storage.querySelector('button[aria-label="Select Photo 1"]');
    check("Storage files load", Boolean(firstSelect));
    const grid = firstSelect.closest("article").parentElement;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
    const expectedColumns = innerWidth >= 768 ? 5 : innerWidth >= 640 ? 4 : innerWidth >= 390 ? 3 : 2;
    check("responsive Storage column count", columns === expectedColumns, `${columns}/${expectedColumns}`);
    check("manager categories render without Trash", Boolean(buttonText("Add category") && buttonText("Campaigns") && !buttonText("Trash")));
    const addCategory = buttonText("Add category").getBoundingClientRect();
    const recent = buttonText("Recent").getBoundingClientRect();
    check("Add category stays on the right", addCategory.left > recent.left, `${addCategory.left}/${recent.left}`);
    const renameCampaigns = storage.querySelector('button[aria-label="Rename Campaigns"]');
    const manageCampaigns = storage.querySelector('button[aria-label="Manage Campaigns"]');
    if (innerWidth >= 640) {
      renameCampaigns.focus();
      await pause(220);
      check("desktop category controls appear on keyboard focus", getComputedStyle(renameCampaigns.parentElement).opacity === "1");
    } else {
      check("touch category ellipsis is available", getComputedStyle(manageCampaigns).display !== "none");
    }

    [...storage.querySelectorAll("button")].find(button => button.textContent.includes("Files")).click();
    await pause(30);
    check("Files filter exposes documents", Boolean(storage.querySelector('button[aria-pressed="false"], button[aria-pressed="true"]') && storage.textContent.includes("Price list.pdf")));
    const mediaFilter = [...storage.querySelectorAll("button")].find(button => button.textContent.includes("Photos & videos"));
    mediaFilter.click();
    await pause(30);

    storage.querySelector('button[aria-label="Select Photo 1"]').click();
    storage.querySelector('button[aria-label="Select Photo 2"]').click();
    await pause(40);
    check("multi-selection count is stable", selectedText(2));

    storage.querySelector('button[aria-label="Preview Photo 1"]').click();
    await pause(40);
    check("preview opens the actual media dialog", Boolean(document.querySelector('[role="dialog"][aria-label="Preview Photo 1"]')));
    document.querySelector('button[aria-label="Close preview"]').click();
    await pause(40);

    const favorite = storage.querySelector('button[aria-label="Add to favorites: Photo 1"]');
    favorite.click();
    await pause(60);
    check("favorite is member action and preserves selection", mutations.some(item => item.action === "toggle-favorite" && item.fileId === "photo-1") && selectedText(2));

    const move = document.getElementById("storage-move-category");
    move.value = "products";
    move.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(80);
    check("category move keeps exact multi-selection", mutations.some(item => item.action === "set-category" && item.categoryId === "products" && item.fileIds.length === 2) && selectedText(2));

    buttonText("Send Now").click();
    await pause(180);
    check("Send Now uses provider send explicitly", !document.querySelector('[role="dialog"][aria-label="Workspace Storage"]') && sendCalls === 1, String(sendCalls));

    document.querySelector('button[aria-label="Attach content"]').click();
    await pause(40);
    [...document.querySelector('[role="menu"]').querySelectorAll("button")].find(button => button.textContent.includes("Storage")).click();
    await pause(10);
    check("warm reopen paints cached files immediately", Boolean(document.querySelector('button[aria-label="Select Photo 1"]')));
    await pause(170);
    const reopened = document.querySelector('[role="dialog"][aria-label="Workspace Storage"]');
    reopened.querySelector('button[aria-label="Select Photo 3"]').click();
    await pause(30);
    buttonText("Delete").click();
    await pause(40);
    const confirmation = document.querySelector('[role="alertdialog"]');
    check("permanent delete confirmation names exact count", confirmation.textContent.includes("Permanently delete 1 selected file?") && confirmation.textContent.includes("cannot be undone"));
    [...confirmation.querySelectorAll("button")].find(button => button.textContent.trim() === "Delete permanently").click();
    await pause(240);
    check("delete permanently removes exact selection", mutations.some(item => item.action === "delete-files" && item.fileIds.length === 1 && item.fileIds[0] === "photo-3") && selectedText(0));
    document.querySelector('button[aria-label="Close Storage"]').click();
    await pause(40);

    document.querySelector('button[aria-label="Attach content"]').click();
    await pause(40);
    [...document.querySelector('[role="menu"]').querySelectorAll("button")].find(button => button.textContent.includes("Storage")).click();
    await pause(180);
    const draftStorage = document.querySelector('[role="dialog"][aria-label="Workspace Storage"]');
    draftStorage.querySelector('button[aria-label="Select Photo 4"]').click();
    draftStorage.querySelector('button[aria-label="Select Photo 5"]').click();
    await pause(30);
    buttonText("Draft").click();
    await pause(180);
    check("Draft closes Storage without another provider send", !document.querySelector('[role="dialog"][aria-label="Workspace Storage"]') && sendCalls === 1, String(sendCalls));
    check("Draft preserves typed text", document.querySelector("textarea").value === "Keep this typed text");
    check("Draft stages both selected files", document.querySelector('button[aria-label="Attach content"]').textContent.includes("2"));

    check("each open has one background refresh", listRequests === 3, String(listRequests));
    document.getElementById("result").textContent = JSON.stringify({ passed: true, width: innerWidth, columns, checks, alerts, listRequests, sendCalls, mutations: mutations.map(item => item.action) });
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ passed: false, width: innerWidth, error: error.message, checks, alerts, listRequests, mutations, sendCalls, body: document.body.innerText.slice(0, 1200) });
  }
})();
