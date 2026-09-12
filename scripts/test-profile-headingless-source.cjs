const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const s=fs.readFileSync('tenh-extension/src/facebook-profile-resolver.js','utf8');
test('heading-less Suite layouts can use one exact explicit profile link',()=>{
 assert.match(s,/function exactConversationProfileLinks\(options\)/);
 assert.match(s,/if \(!urls\.size && fallback\.urls\.size === 1\) urls\.add/);
 assert.match(s,/if \(urls\.size > 1 \|\| fallback\.urls\.size > 1\).*ambiguous_profile/);
 assert.ok(!s.includes('normalize(anchor.textContent).includes(wanted)'));
});
