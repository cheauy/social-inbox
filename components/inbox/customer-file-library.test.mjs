import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Exercise the real TSX presentation without a browser or customer records.
const filename = fileURLToPath(new URL("./customer-file-library.tsx", import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
});
const component = new Module(filename);
component.filename = filename;
component.require = createRequire(filename);
component._compile(compiled.outputText, filename);
const { CustomerFileLibrary } = component.exports;
const items = [
  { id: "photo", kind: "image", name: "receipt-photo", url: "/photo.jpg", createdAt: "2026-08-01", detail: "", savedId: "s1" },
  { id: "clip", kind: "video", name: "product-clip", url: "/clip.mp4", createdAt: "2026-09-01", detail: "", conversationId: "c1" },
  { id: "doc", kind: "file", name: "invoice.pdf", url: "/doc.pdf", createdAt: "2026-09-01", detail: "PDF", savedId: "s2" },
  { id: "voice", kind: "audio", name: "voice-message", url: "/voice.mp3", createdAt: "2026-09-01", detail: "Team" },
  { id: "link", kind: "link", name: "shop-link", url: "https://example.com/full/path", createdAt: "2026-09-01", detail: "", savedId: "s3" },
];
const render = (tab, loading = false) => renderToStaticMarkup(React.createElement(CustomerFileLibrary, {
  items, tab, onTab() {}, loading, deletingId: null, onDelete() {}, onDownload() {},
}));

test("media combines saved photos and conversation clips, newest month first", () => {
  const html = render("media");
  assert.ok(html.indexOf('View video: product-clip') < html.indexOf('View image: receipt-photo'));
  assert.ok(!html.includes('invoice.pdf'));
  assert.match(html, /Download/);
  assert.match(html, /conversation=c1/);
});
test("Files keeps documents and playable voice messages together", () => {
  const html = render("files");
  assert.match(html, /invoice.pdf/);
  assert.match(html, /<audio/);
  assert.ok(!html.includes('receipt-photo'));
});
test("Links shows the complete address and keeps the saved delete action", () => {
  const html = render("links");
  assert.match(html, /https:\/\/example.com\/full\/path/);
  assert.match(html, /Delete/);
  assert.ok(!html.includes('Download'));
});
test("loading shows skeletons instead of stale files", () => {
  const html = render("media", true);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading customer files/);
  assert.ok(!html.includes('receipt-photo'));
});
