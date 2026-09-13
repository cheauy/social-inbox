const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const req=require('node:module').createRequire(path.resolve(__dirname,'../../package.json'));
const {JSDOM}=require('jsdom'),{loader}=require('../tenh-seven/harness.cjs');
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://app.tenhchat.com'});
global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
const React=req('react'),{act}=React,{createRoot}=req('react-dom/client');
const load=loader({react:React,'react/jsx-runtime':req('react/jsx-runtime'),'lucide-react':req('lucide-react')});
const {MessengerSourceCard}=load('components/inbox/messenger-source-card.tsx');
const source={key:'source',kind:'ad',occurred_at:'2026-09-13T10:00:00.000Z',message_id:'m_source',ad_id:'120211222333444',post_id:'393342417206745_444555',title:'Autumn <script>alert(1)</script>',image_url:'https://example.com/source.jpg',post_url:'https://www.facebook.com/393342417206745/posts/444555'};

test('card shows exact full IDs, safely displays title and opens the source image',async()=>{
  const root=createRoot(document.getElementById('root'));let opened;
  await act(async()=>root.render(React.createElement(MessengerSourceCard,{source,onOpenImage:image=>opened=image})));
  assert.ok(document.querySelector('[aria-label="Message from an ad"]'));
  assert.ok(document.body.textContent.includes(source.ad_id));assert.ok(document.body.textContent.includes(source.post_id));assert.equal(document.querySelector('script'),null);
  assert.equal(document.querySelector('img').getAttribute('src'),source.image_url);
  assert.equal(document.querySelector('a').href,source.post_url);
  await act(async()=>document.querySelector('button').click());assert.equal(opened.src,source.image_url);
  await act(async()=>root.unmount());
});
test('an expired photo shows a fallback while preserving IDs; a new photo can load',async()=>{
  const root=createRoot(document.getElementById('root'));
  const render=async value=>act(async()=>root.render(React.createElement(MessengerSourceCard,{source:value,onOpenImage:()=>{}})));
  await render(source);await act(async()=>document.querySelector('img').dispatchEvent(new dom.window.Event('error')));
  assert.equal(document.querySelector('img'),null);assert.ok(document.body.textContent.includes('Photo unavailable'));assert.ok(document.body.textContent.includes(source.ad_id));
  await render({...source,image_url:'https://example.com/new-photo.jpg'});assert.equal(document.querySelector('img').getAttribute('src'),'https://example.com/new-photo.jpg');
  await act(async()=>root.unmount());
});
test('standalone opens render no card even when passed directly to the component',async()=>{
  const root=createRoot(document.getElementById('root'));
  for (const kind of ['ad', 'post']) {
    await act(async()=>root.render(React.createElement(MessengerSourceCard,{source:{...source,kind,message_id:null},onOpenImage:()=>{}})));
    assert.equal(document.querySelector('article'),null);
  }
  await act(async()=>root.unmount());
});
