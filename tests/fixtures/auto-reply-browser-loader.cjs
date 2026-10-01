/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const ts = require("typescript");
module.exports = function(source) {
  const output = ts.transpileModule(source, {
    fileName: this.resourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  if (path.basename(this.resourcePath) !== "auto-reply-settings.tsx") return output;
  return output + '\nrequire("react-dom/client").createRoot(document.getElementById("auto-reply-root")).render(require("react").createElement(exports.AutoReplySettings));';
};
