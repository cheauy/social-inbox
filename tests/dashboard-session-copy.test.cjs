/* eslint-disable @typescript-eslint/no-require-imports -- Copy-only rendering coverage. */
const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{loader}=require('./tenh-seven/harness.cjs');
function render(state,language='en'){
 const load=loader({react:{...React,useEffect(){},useState:()=>[state,()=>{}],useRef:value=>({current:value})},
  '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=>language},'@/lib/auth/browser-session':{},'@/lib/supabase/client':{createClient(){throw Error('No auth action expected');}}});
 const View=load('components/dashboard/dashboard-session-boundary.tsx').DashboardSessionBoundary;
 return renderToStaticMarkup(View({children:'Private workspace content',initialSessionId:'saved',initialUserId:'user'}));
}
test('transient validation uses concise customer copy in English and Khmer while keeping private content hidden',()=>{
 const en=render('unavailable');assert.match(en,/We couldn’t connect/);assert.match(en,/Please try again in a moment\./);assert.match(en,/>Try again<\/button>/);assert.ok(!en.includes('Private workspace content')&&!en.includes('Unable to validate'));
 const km=render('unavailable','km');assert.match(km,/មិនអាចភ្ជាប់បាន/);assert.match(km,/សូមព្យាយាមម្ដងទៀតបន្តិចទៀត។/);assert.ok(!km.includes('Private workspace content'));
});
test('definite expiry retains sign-in guidance and valid state still renders private content',()=>{
 assert.match(render('expired'),/Your session expired\. Please sign in again\./);assert.match(render('expired'),/href="\/login\?expired=1"/);assert.ok(!render('expired').includes('We couldn’t connect'));assert.match(render('valid'),/Private workspace content/);
});
