// Read-only, bounded staging test. Credentials come from a private local file,
// never command-line arguments or logs. This does not send customer messages.
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const i = arg.indexOf('='); return i < 0 ? [arg.replace(/^--/,''),true] : [arg.slice(2,i),arg.slice(i+1)];
}));
const base = new URL(String(args.base ?? 'http://localhost:3000'));
const local = ['localhost','127.0.0.1','[::1]'].includes(base.hostname);
if ((!local && !args['allow-staging']) || base.hostname === 'app.tenhchat.com' || base.username || base.password) throw Error('Use localhost or an explicitly approved staging URL, never production.');
if (!local && base.protocol !== 'https:') throw Error('Staging must use HTTPS.');
if (!args.actors) throw Error('Provide --actors=path-to-private-test-actors.json');
const actors = JSON.parse(await readFile(String(args.actors),'utf8'));
if (!Array.isArray(actors) || !actors.length || actors.length > 1000 || actors.some(a => !a.cookie || !/^[0-9a-f-]{36}$/i.test(a.businessId))) throw Error('Provide 1–1000 test actors with a session cookie and workspace ID.');
function bounded(value, fallback, max) { const n=Number(value ?? fallback); if(!Number.isInteger(n)||n<1||n>max) throw Error('Invalid test limit.'); return n; }
const concurrency=bounded(args.concurrency,5,100);
const maximum=bounded(args.requests,100,10000);
const duration=bounded(args.seconds,30,300)*1000;
const pause=bounded(args['pause-ms'],250,30000);
const started=performance.now(), times=[], statuses={};
let issued=0, bytes=0, invalid=0;
async function worker() {
  while(issued<maximum && performance.now()-started<duration) {
    const index=issued++, actor=actors[index%actors.length];
    const ids=Array.isArray(actor.conversationIds)?actor.conversationIds.slice(0,50):[];
    const targeted=ids.length>0 && index%5!==0;
    const url=new URL('/api/mobile/bootstrap',base);
    url.searchParams.set('workspaceIds',actor.businessId);
    if(targeted)url.searchParams.set('conversationIds',ids.join(','));
    const before=performance.now();
    try {
      const response=await fetch(url,{headers:{Cookie:actor.cookie,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
      statuses[response.status]=(statuses[response.status]??0)+1;
      const body=await response.text(); bytes+=Buffer.byteLength(body);
      if(response.ok) {
        const parsed=JSON.parse(body);
        if(!parsed.success || !Array.isArray(parsed.conversations) || parsed.conversations.some(row=>row.business_id!==actor.businessId)) invalid++;
        if(targeted && parsed.conversations.length>50)invalid++;
      }
    } catch {statuses.transport=(statuses.transport??0)+1;}
    times.push(performance.now()-before);
    await new Promise(resolve=>setTimeout(resolve,pause));
  }
}
await Promise.all(Array.from({length:concurrency},worker));
times.sort((a,b)=>a-b);
const percentile=p=>Math.round(times[Math.max(0,Math.ceil(times.length*p)-1)]??0);
const errors=Object.entries(statuses).reduce((n,[code,count])=>n+(Number(code)>=400||code==='transport'?count:0),0)+invalid;
const report={kind:'staging-read-load-test',actors:actors.length,concurrency,requests:times.length,elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(1)),responseBytes:bytes,statuses,invalidResponses:invalid,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),passed:errors===0&&percentile(.95)<2000};
console.log(JSON.stringify(report,null,2));
if(args.out)await writeFile(String(args.out),JSON.stringify(report,null,2)+'\n');
if(!report.passed)process.exitCode=1;
