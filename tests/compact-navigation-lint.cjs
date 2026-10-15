const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.cwd(),evidence='docs/evidence/compact-navigation-20261012';
const baseline=fs.readFileSync(evidence+'/baseline-path.txt','utf8').trim();
const files=['app/dashboard/settings/layout.tsx','components/dashboard/dashboard-header.tsx','components/dashboard/dashboard-mobile-menu.tsx','components/dashboard/dashboard-navigation-label.tsx','components/dashboard/dashboard-utility-navigation.tsx','components/dashboard/team-notification-center.tsx','components/dashboard/workspace-switcher.tsx','components/inbox/conversation-list-header.tsx','components/inbox/conversation-list.tsx'];
const errors={};
for(const [name,cwd] of [['baseline',baseline],['final',root]]){
  const result=cp.spawnSync(process.execPath,[path.join(cwd,'node_modules/eslint/bin/eslint.js'),'-f','json',...files],{cwd,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  if(!result.stdout.trim().startsWith('['))throw Error(result.stderr||result.stdout);
  fs.writeFileSync(evidence+'/'+name+'-lint.json',result.stdout);
  errors[name]=JSON.parse(result.stdout).flatMap(file=>file.messages.filter(m=>m.severity===2).map(m=>({file:path.relative(cwd,file.filePath).replaceAll('\\','/'),rule:m.ruleId,message:m.message,line:m.line})));
}
const key=e=>JSON.stringify([e.file,e.rule,e.message.split('\n\n')[0],/>\s*\d+\s*\|\s*([^\n]+)/.exec(e.message)?.[1]]),known=errors.baseline.map(key);
const introduced=errors.final.filter(e=>{const at=known.indexOf(key(e));if(at<0)return true;known.splice(at,1);return false;});
const summary={baselineErrors:errors.baseline.length,finalErrors:errors.final.length,introduced};
fs.writeFileSync(evidence+'/lint-comparison.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));process.exitCode=introduced.length?1:0;
