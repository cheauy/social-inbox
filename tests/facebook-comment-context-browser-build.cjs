const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = process.cwd(), output = process.env.FACEBOOK_CONTEXT_ARTIFACT_DIR || path.join(process.env.TEMP, 'tenh-facebook-comment-context');
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'components/inbox/message-panel.tsx'), 'utf8');
const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['getSafeFacebookCommentGroupInfo', 'collectFacebookCommentDescendants'];
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
const extracted = path.join(output, 'grouping.ts');
fs.writeFileSync(extracted, `import {facebookCommentIdentity, facebookCommentRenderRoot} from '${path.join(root, 'lib/facebook/comment-context-data').replaceAll('\\', '/')}';\n${functions}\nexport {collectFacebookCommentDescendants};`);
const loader = path.join(output, 'ts-loader.cjs');
fs.writeFileSync(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
const webpack = require(path.join(root, 'node_modules/next/dist/compiled/webpack/webpack')).webpack;
const styles = require('postcss')([require('@tailwindcss/postcss')({ base: root })]).process(
  `@import "tailwindcss" source(none);\n@source "${path.join(root, 'components/inbox/facebook-post-card.tsx').replaceAll('\\', '/')}";`,
  { from: path.join(root, 'facebook-fixture.css') },
);
webpack({ mode: 'production', entry: path.join(root, 'tests/fixtures/facebook-comment-context-browser.entry.cjs'), output: { path: output, filename: 'browser.js' },
  plugins: [new webpack.DefinePlugin({ 'process.env.FACEBOOK_GROUPING_FIXTURE': JSON.stringify(extracted) })],
  resolve: { extensions: ['.ts', '.tsx', '.js'], alias: { '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
  module: { rules: [{ test: /\.tsx?$/, use: loader }] }, optimization: { minimize: false },
}, async (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  try { fs.writeFileSync(path.join(output, 'styles.css'), (await styles).css); } catch (error) { console.error(error); process.exitCode = 1; return; }
  fs.writeFileSync(path.join(output, 'browser.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><style>body{margin:0;padding:12px;font-family:Arial}section{margin:0 0 16px}h2{font-size:16px;margin:8px 0}</style></head><body><div id="app"></div><script src="browser.js"></script></body></html>');
  console.log('Facebook Comment browser fixture ready.');
});
