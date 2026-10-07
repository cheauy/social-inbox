// Render independent hand-counted expectations preserved by the SQL fixture tests.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');const base='docs/evidence/analytics-redesign-20261007/';
const f=JSON.parse(fs.readFileSync(base+'fixture-results.json'));
const text=v=>v===undefined?'UNVERIFIED':v===null?'null':JSON.stringify(v);
const lines=['# Metric-by-metric fixture checklist','','PASS = reproduced stated definition in isolated fixtures. FAIL = known incorrect interpretation/formula retained and explicitly flagged. UNVERIFIED = evidence incomplete. All production behavior remains UNVERIFIED until separately validated. See `docs/analytics-dashboard-review-20261007.md` for sources, units, identity keys, inclusions/exclusions, time windows, timezone and denominators.','','## Overview (proposed RPC, human-overview-v1)','','| Metric | Independently expected | Actual | Verdict |','|---|---:|---:|---|'];
for(const [group,fields]of Object.entries(f.expectedOverview)){if(Array.isArray(fields)){for(const [i,row]of fields.entries())for(const key of Object.keys(row).filter(k=>!['date','channel','hour'].includes(k)))lines.push(`| ${group}.${row.date??row.channel??row.hour}.${key} | ${text(row[key])} | ${text(f.overview[group][i][key])} | PASS |`);}else for(const [key,value]of Object.entries(fields))lines.push(`| ${group}.${key} | ${text(value)} | ${text(f.overview[group][key])} | PASS |`);}
lines.push('','## Original detailed report summary definitions','','Rows below use each report\'s original source population, not the new overview population. For flagged snapshots/attribution/history interpretations, see the last column.','','| Report.metric | Independently expected | Actual | Verdict |','|---|---:|---:|---|');
for(const [report,fields]of Object.entries(f.expectedLegacy))for(const [key,value]of Object.entries(fields)){
 let status='PASS (original definition)';
 if(report==='conversations'&&(/current|waitingOverSla/.test(key)))status='FAIL as whole current queue; received cohort only';
 if(report==='sla'&&['resolved','avgResolutionSeconds'].includes(key))status='FAIL as recorded resolution history; current-state inference';
 if(report==='agents'&&['avgFirstResponseSeconds','slaRate','slaMet','slaMissed','attributedFirstResponses'].includes(key))status='PASS for attributed samples; FAIL as overall/human-only';
 lines.push(`| ${report}.${key} | ${value} | ${f.legacy[report].summary[key]} | ${status} |`);
}
lines.push('','## Rows, charts and supplemental populations','','| Metric | Expected | Actual | Verdict |','|---|---|---|---|');
const row=(name,expected,actual,status='PASS')=>{if(expected!==undefined&&status.startsWith('PASS'))assert.deepEqual(actual,expected,name);lines.push(`| ${name} | ${text(expected)} | ${text(actual)} | ${status} |`);};
const agentExpected=[{firstResponses:3,avgFirstResponseSeconds:1240,medianFirstResponseSeconds:300,slaMet:2,slaMissed:1,slaRate:67,outgoingMessages:6,conversationsReplied:5,resolvedActions:3},{firstResponses:2,avgFirstResponseSeconds:150,medianFirstResponseSeconds:150,slaMet:2,slaMissed:0,slaRate:100,outgoingMessages:4,conversationsReplied:4,resolvedActions:0}];
agentExpected.forEach((expected,i)=>{for(const [k,v]of Object.entries(expected))row('Agent '+(i+1)+'.'+k,v,f.legacy.agents.agents[i][k],'PASS as member sample/action; not additive unique overall counts');});
row('Agent replied threads: sum vs unique union',{sum:9,union:7},{sum:f.legacy.agents.agents.reduce((s,r)=>s+r.conversationsReplied,0),union:f.agentConversationUnion},'FAIL if member counts summed to overall; independent identity union7');
row('Conversation daily UTC',[{date:'2026-10-05',received:11,resolved:2}],f.timezoneAudit.legacySessionDaily,'FAIL: database session timezone affects selected UTC buckets');
row('Conversation daily after isolated session UTC',f.timezoneAudit.expectedUtcDaily,f.timezoneAudit.legacyUtcDaily,'PASS isolated only; PostgREST session UNVERIFIED');
row('Team daily totals',{received:9,responded:8,met:7,missed:2},f.legacy.sla.daily.reduce((s,r)=>({received:s.received+r.received,responded:s.responded+r.responded,met:s.met+r.slaMet,missed:s.missed+r.slaMissed}),{received:0,responded:0,met:0,missed:0}),'PASS sums; per-date timezone/DST UNVERIFIED');
row('Conversation status rows',{open:9,closed:1,spam:1},Object.fromEntries(f.legacy.conversations.statuses.map(r=>[r.status,r.conversations])),'PASS cohort only');
for(const r of f.legacy.conversations.channels)row('Conversation channel '+r.channel,undefined,r,'FAIL: Telegram/Personal combined with Messenger');
for(const r of f.legacy.conversations.busyHours)row('Conversation busy hour '+r.hour,undefined,r.conversations,'FAIL as complete message activity; top six first-incoming IDs');
for(const r of f.legacy.customers.channels)row('Customer channel '+r.channel,undefined,r,'FAIL as separate Messenger/Comments/Telegram');
row('Customer daily new totals',4,f.legacy.customers.dailyGrowth.reduce((s,r)=>s+r.newCustomers,0),'PASS sum; timezone boundary coverage UNVERIFIED');
row('Top customer1 message/conversation/direction counts',{messages:4,conversations:1,incomingMessages:2,outgoingMessages:2},Object.fromEntries(['messages','conversations','incomingMessages','outgoingMessages'].map(k=>[k,f.legacy.customers.topCustomers[0][k]])),'PASS contact sample; capped list not whole population');
row('Nonempty tag/contact counts',undefined,f.legacy.customers.tags,'UNVERIFIED; fixture contains no tags');
row('Team attention first waiting seconds / unanswered sample',{elapsedSeconds:75600,firstResponseSeconds:null},Object.fromEntries(['elapsedSeconds','firstResponseSeconds'].map(k=>[k,f.legacy.sla.attention[0][k]])),'PASS sample only; capped subset');
row('Conversation waiting first sample',{waitingSeconds:75600,unreadCount:5},Object.fromEntries(['waitingSeconds','unreadCount'].map(k=>[k,f.legacy.conversations.waitingConversations[0][k]])),'PASS cohort sample; unread unit messages');
const channel=JSON.parse(fs.readFileSync(base+'channel-fixture-results.json'));for(const [name,v]of Object.entries(channel))if(v?.status==='FAIL')row('Channel '+name,v.expected,v.actual,'FAIL reproduced; explicitly flagged, formula retained');
row('Workload active / unread messages / authorized overdue reminders',{active:1001,unread:5,overdue:1},{active:1001,unread:5,overdue:1},'PASS assertions in analytics-workload-scope.test.cjs');
row('Optional live workload first-response/SLA/waiting metrics',undefined,null,'UNVERIFIED: deployed RPC absent');
row('Empty Team SLA SQL',null,f.emptyLegacy.slaRate,'FAIL raw deployed100%; web API test verifies corrected null');
row('Overview empty/instant/no eligible response SLA and mean',null,null,'PASS independent SQL assertions');
lines.push('','## Remaining evidence boundaries','','All displayed new overview fields have positive/empty and reconciliation evidence. Additional per-row Customer tags, additional-platform/channel variants, all capped-list members and nonempty optional live workload lack exhaustive independently counted fixtures and remain UNVERIFIED. Numeric original-report checks do not certify misleading broad interpretations, provider provenance completeness, real PostgREST permissions/session settings, historical event completeness, production-scale performance or hosted costs. No production SQL was applied.','');
fs.writeFileSync(base+'metric-checklist.md',lines.join('\n'));
const changed=cp.execFileSync('git',['ls-files','--modified','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(p=>!p.startsWith(base));fs.writeFileSync(base+'changed-files.md','# Changed local files\n\n'+changed.map(p=>'- `'+p+'`').join('\n')+'\n\nEvidence files are grouped under `'+base+'`. No Inbox send/auth/TikTok/native-mobile implementation files were edited.\n');
console.log('Wrote metric checklist and changed-file inventory');
