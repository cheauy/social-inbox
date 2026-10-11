const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.cwd(),baseline=fs.readFileSync('docs/evidence/inbox-compact-web/baseline-path.txt','utf8').trim();
const files=['app/layout.tsx','app/manifest.ts','app/dashboard/layout.tsx','app/dashboard/inbox/page.tsx','components/dashboard/dashboard-header.tsx','components/dashboard/dashboard-mobile-menu.tsx','components/inbox/inbox-view.tsx','components/inbox/inbox-web-shell.tsx','components/inbox/conversation-header.tsx','components/inbox/conversation-list-header.tsx','components/inbox/conversation-list.tsx','components/inbox/inbox-channel-selector.tsx','components/inbox/customer-tag-selector.tsx','components/inbox/message-panel.tsx','components/inbox/message-action-toolbar.tsx','components/inbox/reply-box.tsx','lib/inbox/use-compact-web.ts','lib/inbox/use-url-conversation-selection.ts'];
const results={};
for(const [name,cwd] of [['baseline',baseline],['final',root]]){
  const args=files.filter(file=>fs.existsSync(path.join(cwd,file)));
  const r=process.argv.includes('--compare-only')?{stdout:fs.readFileSync('docs/evidence/inbox-compact-web/'+name+'-lint.json','utf8')}:cp.spawnSync(process.execPath,[path.join(cwd,'node_modules/eslint/bin/eslint.js'),'-f','json',...args],{cwd,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  fs.writeFileSync('docs/evidence/inbox-compact-web/'+name+'-lint.json',r.stdout);
  if(!r.stdout.trim().startsWith('['))throw Error(r.stderr||r.stdout);
  results[name]=JSON.parse(r.stdout).flatMap(file=>file.messages.filter(m=>m.severity===2).map(m=>({file:path.relative(cwd,file.filePath).replaceAll('\\','/'),rule:m.ruleId,message:m.message,line:m.line})));
}
const key=entry=>JSON.stringify([entry.file,entry.rule,entry.message.split('\n\n')[0],/>\s*\d+\s*\|\s*([^\n]+)/.exec(entry.message)?.[1]]),known=results.baseline.map(key);
const introduced=results.final.filter(entry=>{const index=known.indexOf(key(entry));if(index<0)return true;known.splice(index,1);return false;});
const summary={baselineErrors:results.baseline.length,finalErrors:results.final.length,introduced,final:results.final};fs.writeFileSync('docs/evidence/inbox-compact-web/lint-comparison.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({baselineErrors:summary.baselineErrors,finalErrors:summary.finalErrors,introduced}));process.exitCode=introduced.length?1:0;
