const fs = require('node:fs'), path = require('node:path');
const root = process.cwd(), output = path.join(process.env.TEMP, 'tenh-website-performance-browser'); fs.mkdirSync(output, { recursive: true });
const webpack = require(path.join(root, 'node_modules/next/dist/compiled/webpack/webpack')).webpack;
const loader = path.join(output, 'loader.cjs');
fs.writeFileSync(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=function(s){return ts.transpileModule(s,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
webpack({ mode: 'production', plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'production' }) })], optimization: { minimize: false }, entry: path.join(root, 'tests/fixtures/analytics-performance-browser.entry.cjs'), output: { path: output, filename: 'bundle.js' },
  resolve: { extensions: ['.ts', '.tsx', '.js'], alias: { '@/lib/supabase/client': path.join(root, 'tests/fixtures/analytics-performance-supabase.cjs'), 'next/link': path.join(root, 'tests/fixtures/context-link-stub.cjs'), 'next/navigation': path.join(root, 'tests/fixtures/analytics-performance-navigation.cjs'), '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } }, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Isolated Analytics lifecycle proof</title><div id="root"></div><pre id="result"></pre><script src="bundle.js"></script>');
  console.log(output);
});
