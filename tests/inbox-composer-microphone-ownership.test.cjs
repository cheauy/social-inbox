// Source-extracted recorder handler and effects in real keyed React commits.
// getUserMedia, MediaRecorder and interval scheduling are fully mocked.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('components/inbox/reply-box.tsx','utf8'),ast=ts.createSourceFile('reply.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const wanted=new Set(['composerMountedRef','recordingStartPendingRef','voicePreviewAudioRef','recordingVoice','recordingPaused','recordingSeconds','recordingError','voiceReview','voiceReviewPlaying','voicePlaybackSeconds','recordingSecondsRef','mediaRecorderRef','mediaStreamRef','recordedChunksRef','recordingTimerRef','discardRecordingRef','sendRecordingRef']);
const declarations=[],functions=[],effects=[],seen=new Set();
function visit(n){
 if(ts.isVariableDeclaration(n)){
  const bound=ts.isArrayBindingPattern(n.name)?n.name.elements.map(e=>e.name?.getText(ast)):[n.name.getText(ast)];
  if(bound.some(name=>wanted.has(name))&&!seen.has(n.parent.parent.pos)){seen.add(n.parent.parent.pos);declarations.push(n.parent.parent.getText(ast));}
 }
 if(ts.isFunctionDeclaration(n)&&['startVoiceRecording','clearRecordingTimer','stopRecordingTracks','supportedRecordingMimeType'].includes(n.name?.text))functions.push(n.getText(ast));
 if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&['composerMountedRef.current = true','discardRecordingRef.current ='].some(x=>n.arguments[0]?.getText(ast).includes(x)))effects.push(n.parent.getText(ast));
 ts.forEachChild(n,visit);
}visit(ast);assert.equal(functions.length,4);assert.equal(effects.length,2);
const panel=ts.createSourceFile('panel.tsx',fs.readFileSync('components/inbox/message-panel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let key;
function findKey(n){if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText(panel)==='ReplyBox')key=n.attributes.properties.find(p=>p.name?.getText(panel)==='key')?.initializer?.expression?.getText(panel);ts.forEachChild(n,findKey)}findKey(panel);assert.ok(key);

async function fixture({constructorFailure=false}={}){
 const dom=new JSDOM('<div id="root"></div>'),originals={};for(const[k,v]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){originals[k]=global[k];global[k]=v;}
 const requests=[],recorders=[],intervals=new Map(),streams=[],starts=[];let api,nextTimer=0;
 class Recorder{
  static isTypeSupported(){return true}
  constructor(stream){if(constructorFailure)throw Error('mock constructor failure');this.stream=stream;this.state='inactive';this.mimeType='audio/webm';this.startCount=0;this.stopCount=0;recorders.push(this)}
  start(){this.state='recording';this.startCount++}
  stop(){this.state='inactive';this.stopCount++;this.onstop?.()}
 }
 const makeStream=()=>{const tracks=[{stops:0,stop(){this.stops++}},{stops:0,stop(){this.stops++}}];const stream={tracks,getTracks:()=>tracks};streams.push(stream);return stream};
 const c={React,...React,console,DOMException,Blob,File,MediaRecorder:Recorder,allowAttachments:true,isComposerDisabled:false,
  navigator:{mediaDevices:{getUserMedia:()=>new Promise((resolve,reject)=>requests.push({resolve,reject,settled:false}))}},
  setInterval:fn=>{const id=++nextTimer;intervals.set(id,fn);return id},clearInterval:id=>intervals.delete(id),setMoreOpen(){},clearToolbarPanel(){},
  URL:{revokeObjectURL(){},createObjectURL:()=> 'blob:mock'},expose:value=>{api=value;},TENH_ATTACHMENT_LIMITS:{audio:25*1024*1024}};
 vm.createContext(c);vm.runInContext(ts.transpileModule(`function Microphone(){const attachmentsRef=useRef([]);${declarations.join('\n')}${effects.join('\n')}${functions.join('\n')}
 useLayoutEffect(()=>expose({start:startVoiceRecording,error:recordingError,recording:recordingVoice}));return null;}globalThis.Microphone=Microphone;globalThis.keyFor=activeConversation=>${key};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
 const root=createRoot(dom.window.document.getElementById('root'));
 const render=async id=>act(async()=>root.render(React.createElement(c.Microphone,{key:c.keyFor({business_id:'b1',id})})));
 await render('A');
 const start=()=>{const promise=api.start();starts.push(promise);return promise};
 const resolve=(n=0)=>{requests[n].settled=true;const stream=makeStream();requests[n].resolve(stream);return stream};
 const deny=(n=0)=>{requests[n].settled=true;requests[n].reject(new DOMException('mock denied','NotAllowedError'))};
 return{requests,recorders,intervals,streams,render,start,resolve,deny,get api(){return api},
  async cleanup(){await act(async()=>root.unmount());for(const r of requests)if(!r.settled){r.settled=true;r.reject(new DOMException('fixture cleanup','NotAllowedError'))}await act(async()=>Promise.allSettled(starts));
   // Baseline failures may create orphan mock resources. Never leave actual
   // timers/media running: none exist, and dispose the mock bookkeeping too.
   intervals.clear();for(const recorder of recorders)if(recorder.state!=='inactive')recorder.stop();dom.window.close();for(const[k,v]of Object.entries(originals)){if(v===undefined)delete global[k];else global[k]=v;}
  }
 };
}
test('late microphone acquisition after keyed A -> B stops every acquired track without creating recorder/interval',async()=>{
 const f=await fixture();try{const old=f.api;const pending=f.start();await f.render('B');const stream=f.resolve();await act(async()=>pending);
  assert.equal(f.recorders.length,0);assert.equal(f.intervals.size,0);assert.ok(stream.tracks.every(t=>t.stops===1));assert.equal(f.api.recording,false);assert.equal(f.api.error,null);
  await old.start();assert.equal(f.requests.length,1,'retired entry does not reacquire microphone');
 }finally{await f.cleanup()}
});
test('repeated starts before acquisition and from an old render while recording use one microphone and timer',async()=>{
 const f=await fixture();try{const old=f.api;const first=f.start(),second=f.start();assert.equal(f.requests.length,1);const stream=f.resolve();await act(async()=>Promise.all([first,second]));
  await old.start();assert.equal(f.requests.length,1);assert.equal(f.recorders.length,1);assert.equal(f.recorders[0].startCount,1);assert.equal(f.intervals.size,1);
  await f.render('B');assert.ok(stream.tracks.every(t=>t.stops>=1));assert.equal(f.intervals.size,0);assert.equal(f.recorders[0].stopCount,1);
 }finally{await f.cleanup()}
});
test('current microphone denial keeps its error and permits a subsequent start',async()=>{
 const f=await fixture();try{const first=f.start();f.deny();await act(async()=>first);assert.match(f.api.error,/permission was denied/);assert.equal(f.recorders.length,0);assert.equal(f.intervals.size,0);
  const second=f.start();assert.equal(f.requests.length,2);f.resolve(1);await act(async()=>second);assert.equal(f.recorders.length,1);assert.equal(f.api.error,null);
 }finally{await f.cleanup()}
});
test('late denied acquisition after unmount does not change the new composer error or create resources',async()=>{
 const f=await fixture();try{const pending=f.start();await f.render('B');f.deny();await act(async()=>pending);assert.equal(f.api.error,null);assert.equal(f.recorders.length,0);assert.equal(f.intervals.size,0);
 }finally{await f.cleanup()}
});
test('constructor failure releases all acquired tracks and leaves no interval',async()=>{
 const f=await fixture({constructorFailure:true});try{const pending=f.start(),stream=f.resolve();await act(async()=>pending);assert.ok(stream.tracks.every(t=>t.stops===1));assert.equal(f.intervals.size,0);assert.match(f.api.error,/Unable to start/);
 }finally{await f.cleanup()}
});
