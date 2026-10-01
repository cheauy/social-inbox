import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('components/inbox/message-panel.tsx', 'utf8');
const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['PlayIcon', 'formatAudioTime', 'CompactAudioPlayer'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
const code = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function player(isOutgoing) {
  const state = [];
  let index = 0, nodes = [], rejectPlay = false;
  const jsx = (type, props) => { const node = { type, props }; nodes.push(node); return node; };
  const audio = { paused: true, currentTime: 0,
    async play() { if (rejectPlay) throw new Error('Blocked'); this.paused = false; media().props.onPlay(); },
    pause() { this.paused = true; media().props.onPause(); },
  };
  const context = vm.createContext({
    exports: {}, require: () => ({ jsx, jsxs: jsx }),
    useRef: () => ({ current: audio }),
    useState: initial => {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => { state[slot] = value; }];
    },
  });
  vm.runInContext(code, context);
  const render = () => { index = 0; nodes = []; context.CompactAudioPlayer({ src: '/voice.mp3', label: '', isVoice: true, isOutgoing }); };
  const media = () => nodes.find(node => node.type === 'audio');
  const button = () => nodes.find(node => node.type === 'button');
  const range = () => nodes.find(node => node.type === 'input');
  const bars = () => nodes.filter(node => node.type === 'span' && node.props.style?.maxWidth === 3);
  render();
  return { render, media, button, range, bars, audio, nodes: () => nodes, reject: () => { rejectPlay = true; } };
}

for (const isOutgoing of [false, true]) test(`${isOutgoing ? 'own' : 'customer'} voice note plays, animates, seeks and stops`, async () => {
  const ui = player(isOutgoing);
  assert.equal(ui.bars().length, 32);
  assert.ok(ui.bars().every(bar => !bar.props.className.includes('tenh-recording-bar')));
  assert.equal(ui.range().props.disabled, true);
  ui.media().props.onLoadedMetadata({ currentTarget: { duration: 18 } });
  ui.render();
  assert.equal(ui.range().props.disabled, false);
  assert.equal(ui.range().props.max, 18);
  ui.button().props.onClick();
  await Promise.resolve();
  ui.render();
  assert.equal(ui.button().props['aria-label'], 'Pause audio');
  assert.ok(ui.bars().every(bar => bar.props.className.includes('tenh-recording-bar')));
  ui.range().props.onChange({ target: { value: '9' } });
  ui.render();
  assert.equal(ui.audio.currentTime, 9);
  assert.equal(ui.range().props['aria-valuetext'], '0:09 of 0:18');
  const playedColor = isOutgoing ? 'bg-white' : 'bg-sky-600';
  assert.equal(ui.bars().filter(bar => bar.props.className.split(' ').includes(playedColor)).length, 16);
  ui.range().props.onChange({ target: { value: '999' } });
  assert.equal(ui.audio.currentTime, 18);
  ui.range().props.onChange({ target: { value: '-3' } });
  assert.equal(ui.audio.currentTime, 0);
  ui.button().props.onClick();
  ui.render();
  assert.equal(ui.button().props['aria-label'], 'Play audio');
  assert.ok(ui.bars().every(bar => !bar.props.className.includes('tenh-recording-bar')));
  ui.media().props.onPlay();
  ui.media().props.onEnded();
  ui.render();
  assert.ok(ui.bars().every(bar => !bar.props.className.includes('tenh-recording-bar')));
});

test('unavailable or rejected audio stays stopped and reports an accessible error', async () => {
  const ui = player(true);
  ui.reject();
  ui.button().props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  ui.render();
  assert.equal(ui.button().props['aria-label'], 'Play audio');
  assert.ok(ui.nodes().some(node => node.props.role === 'alert'));
  ui.media().props.onDurationChange({ currentTarget: { duration: Infinity } });
  ui.render();
  assert.equal(ui.range().props.disabled, true);
  ui.range().props.onChange({ target: { value: '10' } });
  assert.equal(ui.audio.currentTime, 0);
  ui.media().props.onError();
  ui.render();
  assert.equal(ui.nodes().find(node => node.props.role === 'alert').props.children, 'Audio is unavailable.');
});

test('voice animation respects reduced motion and both message directions use the same player', () => {
  const css = fs.readFileSync('app/globals.css', 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*{\s*\.tenh-recording-bar\s*{\s*animation: none/);
  assert.match(source, /<CompactAudioPlayer[\s\S]*?key=\{attachmentUrl\}[\s\S]*?isOutgoing=\{isOutgoing\}/);
});
