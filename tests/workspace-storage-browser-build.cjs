/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs"), path = require("path"), root = process.cwd(), temp = process.env.TEMP;
const webpack = require(path.join(root, "node_modules/next/dist/compiled/webpack/webpack")).webpack;
const loader = path.join(temp, "tenh-workspace-storage-loader.cjs");
const stub = path.join(root, "tests/fixtures/workspace-storage-browser-stubs.cjs");
fs.writeFileSync(loader, `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=function(s){return ts.transpileModule(s,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
webpack({
  mode: "production", optimization: { minimize: false },
  entry: path.join(root, "tests/fixtures/workspace-storage-browser.entry.cjs"),
  output: { path: temp, filename: "tenh-workspace-storage-bundle.js" },
  resolve: { extensions: [".ts", ".tsx", ".js"], alias: {
    "@/lib/supabase/client$": stub,
    "@/components/inbox/customer-tag-selector$": stub,
    "@/components/inbox/location-picker-dialog$": stub,
    "@/components/inbox/saved-reply-selector$": stub,
    "@/lib/inbox/use-online-status$": stub,
    "@/components/display/workspace-language-text$": stub,
    "./tenh-sticker-picker$": stub,
    "@": root,
  }, modules: [path.join(root, "node_modules"), "node_modules"] },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
}, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  function cssFiles(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? cssFiles(path.join(dir, item.name)) : item.name.endsWith(".css") ? [fs.readFileSync(path.join(dir, item.name), "utf8")] : []); }
  const css = cssFiles(path.join(root, ".next/static")).join("\n");
  fs.writeFileSync(path.join(temp, "tenh-workspace-storage-browser.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>html,body{margin:0}#result{display:none}</style><div id="root"></div><pre id="result"></pre><script src="tenh-workspace-storage-bundle.js"></script>`);
  console.log("Built actual ReplyBox and WorkspaceStorageModal browser fixture in Temp");
});
