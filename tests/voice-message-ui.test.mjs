import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('components/inbox/message-panel.tsx', 'utf8');
const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && ['PlayIcon', 'formatAudioTime', 'stopAndResetCompactAudio', 'CompactAudioPlayer'].includes(node.name?.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'activeCompactAudioOwner'))
).map(node => node.getText(ast)).join('\n');
const code = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function players() {
  let current;
  const jsx = (type, props) => { const node = { type, props }; current.nodes.push(node); return node; };
  const context = vm.createContext({
    exports: {}, require: () => ({ jsx, jsxs: jsx }),
    useRef: initial => {
      const slot = current.refIndex++;
      return current.refs[slot] ??= { current: slot === 0 ? current.audio : initial };
    },
    useEffect: effect => {
      const slot = current.effectIndex++;
      if (!(slot in current.effects)) current.effects[slot] = effect();
    },
    useState: initial => {
      const instance = current, slot = instance.index++;
      if (!(slot in instance.state)) instance.state[slot] = initial;
      return [instance.state[slot], value => { instance.state[slot] = value; }];
    },
  });
  vm.runInContext(code, context);
  return isOutgoing => {
    const instance = { state: [], refs: [], effects: [], nodes: [], index: 0, refIndex: 0, effectIndex: 0 };
    let rejectPlay = false, playCalls = 0;
    const pending = [];
    const media = () => instance.nodes.find(node => node.type === 'audio');
    const audio = { paused: true, currentTime: 0,
      async play() {
        playCalls++;
        if (rejectPlay) throw new Error('Blocked');
        if (pending.length) await pending.shift();
        this.paused = false;
        media().props.onPlay();
      },
      pause() { this.paused = true; media().props.onPause(); },
    };
    instance.audio = audio;
    const render = () => {
      current = instance;
      instance.index = instance.refIndex = instance.effectIndex = 0;
      instance.nodes = [];
      context.CompactAudioPlayer({ src: '/voice.mp3', label: '', isVoice: true, isOutgoing });
    };
    const button = () => instance.nodes.find(node => node.type === 'button');
    const range = () => instance.nodes.find(node => node.type === 'input');
    const bars = () => instance.nodes.filter(node => node.type === 'span' && node.props.style?.maxWidth === 2.55);
    render();
    return { render, media, button, range, bars, audio, nodes: () => instance.nodes,
      reject: (value = true) => { rejectPlay = value; },
      calls: () => playCalls,
      defer: () => { let resolve, reject; pending.push(new Promise((yes, no) => { resolve = yes; reject = no; })); return { resolve, reject }; },
      unmount: () => { instance.effects.forEach(cleanup => cleanup?.()); instance.refs[0].current = null; },
    };
  };
}

const player = isOutgoing => players()(isOutgoing);
const settle = () => new Promise(resolve => setImmediate(resolve));

function ready(ui) {
  ui.media().props.onLoadedMetadata({ currentTarget: { duration: 18 } });
  ui.render();
}

function seek(ui, value) {
  ui.range().props.onChange({ target: { value: String(value) } });
  ui.render();
}

for (const outgoing of [false, true]) test(`switching from ${outgoing ? 'own' : 'customer'} voice pauses and resets it while same-player resume preserves position`, async () => {
  const create = players(), first = create(outgoing), second = create(!outgoing);
  ready(first); ready(second);
  first.button().props.onClick(); await settle(); first.render();
  seek(first, 9);
  first.button().props.onClick(); first.render();
  assert.equal(first.audio.paused, true);
  assert.equal(first.range().props.value, 9);
  first.button().props.onClick(); await settle(); first.render();
  assert.equal(first.audio.paused, false);
  assert.equal(first.range().props.value, 9);
  second.button().props.onClick(); await settle(); first.render(); second.render();
  assert.equal(first.audio.paused, true);
  assert.equal(first.audio.currentTime, 0);
  assert.equal(first.range().props.value, 0);
  assert.equal(first.range().props['aria-valuetext'], '0:00 of 0:18');
  assert.equal(first.button().props['aria-label'], 'Play audio');
  assert.ok(first.bars().every(bar => !bar.props.className.includes('tenh-recording-bar')));
  assert.equal(second.audio.paused, false);
  assert.equal(second.button().props['aria-label'], 'Pause audio');
});

test('a late successful play from the previous voice cannot resume or interrupt the current voice', async () => {
  const create = players(), first = create(false), second = create(true);
  ready(first); ready(second);
  seek(first, 6);
  const pending = first.defer();
  first.button().props.onClick();
  second.button().props.onClick(); await settle();
  pending.resolve(); await settle(); first.render(); second.render();
  assert.equal(first.audio.paused, true);
  assert.equal(first.audio.currentTime, 0);
  assert.equal(second.audio.paused, false);
  assert.equal(second.button().props['aria-label'], 'Pause audio');
  assert.ok(!first.nodes().some(node => node.props.role === 'alert'));
});

test('stale play rejection does not overwrite a newer request on the same voice', async () => {
  const ui = player(true); ready(ui);
  const old = ui.defer();
  ui.button().props.onClick();
  ui.button().props.onClick();
  const latest = ui.defer();
  ui.button().props.onClick();
  old.reject(new Error('Old request was cancelled')); await settle();
  latest.resolve(); await settle(); ui.render();
  assert.equal(ui.audio.paused, false);
  assert.equal(ui.button().props['aria-label'], 'Pause audio');
  assert.ok(!ui.nodes().some(node => node.props.role === 'alert'));
});

test('rapid same-player clicks cancel pending playback without resetting manual position', async () => {
  const ui = player(false); ready(ui); seek(ui, 7);
  const pending = ui.defer();
  ui.button().props.onClick();
  ui.button().props.onClick();
  assert.equal(ui.calls(), 1);
  pending.resolve(); await settle(); ui.render();
  assert.equal(ui.audio.paused, true);
  assert.equal(ui.audio.currentTime, 7);
  assert.equal(ui.range().props.value, 7);
  ui.button().props.onClick(); await settle(); ui.render();
  assert.equal(ui.audio.paused, false);
  assert.equal(ui.audio.currentTime, 7);
});

test('failed new playback resets the old voice and supports retry', async () => {
  const create = players(), first = create(true), second = create(false);
  ready(first); ready(second);
  first.button().props.onClick(); await settle(); seek(first, 5);
  second.reject(); second.button().props.onClick(); await settle(); first.render(); second.render();
  assert.equal(first.audio.paused, true);
  assert.equal(first.audio.currentTime, 0);
  assert.equal(second.audio.paused, true);
  assert.ok(second.nodes().some(node => node.props.role === 'alert'));
  second.reject(false); second.button().props.onClick(); await settle(); second.render();
  assert.equal(second.audio.paused, false);
  assert.ok(!second.nodes().some(node => node.props.role === 'alert'));
});

test('unmount and a late play completion cannot restart a removed voice or stop the next conversation', async () => {
  const create = players(), first = create(false), second = create(true);
  ready(first); ready(second); seek(first, 8);
  const pending = first.defer(); first.button().props.onClick(); first.unmount();
  assert.equal(first.audio.paused, true);
  assert.equal(first.audio.currentTime, 0);
  second.button().props.onClick(); await settle();
  pending.resolve(); await settle(); second.render();
  assert.equal(first.audio.paused, true);
  assert.equal(first.audio.currentTime, 0);
  assert.equal(second.audio.paused, false);
});

test('ended and native pause permit replay without capturing other voices', async () => {
  const create = players(), first = create(false), second = create(true);
  ready(first); ready(second);
  first.button().props.onClick(); await settle(); seek(first, 4);
  first.audio.pause(); first.render();
  first.button().props.onClick(); await settle(); first.render();
  assert.equal(first.audio.paused, false);
  assert.equal(first.audio.currentTime, 4);
  first.audio.paused = true; first.media().props.onEnded(); first.render();
  second.button().props.onClick(); await settle(); second.render();
  assert.equal(second.audio.paused, false);
  assert.equal(first.button().props['aria-label'], 'Play audio');
});

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
