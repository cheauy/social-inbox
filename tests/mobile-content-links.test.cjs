const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
function setup() {
  const opened = [], alerts = [];
  const load = loader({ react: {}, './post-webview': {}, 'react-native': {
    DeviceEventEmitter: { emit: (event, url) => opened.push(url) },
    Alert: { alert: (...args) => alerts.push(args) },
  } });
  return { ...load('mobile/components/in-app-browser.tsx'), opened, alerts };
}
test('web links are sent to the embedded viewer', async () => {
  const h = setup();
  for (const url of ['https://facebook.com/post/1', 'https://t.me/shop', 'https://example.com/file.pdf', 'http://example.com']) await h.openInAppLink(url);
  assert.equal(h.opened.length, 4); assert.equal(h.alerts.length, 0);
});
test('content cannot launch scripts, local files, or another app', async () => {
  const h = setup();
  for (const url of ['javascript:alert(1)', 'file:///private', 'intent://facebook', 'fb://profile/1', 'https://user:secret@example.com', 'invalid']) await h.openInAppLink(url);
  assert.equal(h.opened.length, 0); assert.equal(h.alerts.length, 6);
});
