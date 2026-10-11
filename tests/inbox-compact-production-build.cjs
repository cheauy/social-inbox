/* Final working-tree build in a new copy; existing build/evidence stays intact. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.cwd(),out=fs.mkdtempSync(path.join(process.env.TEMP,'tenh-inbox-production-'));
for(const name of ['app','components','lib','public','types','scripts'])if(fs.existsSync(name))fs.cpSync(name,path.join(out,name),{recursive:true});
for(const name of fs.readdirSync(root))if(/^(package(-lock)?\.json|tsconfig\.json|next-env\.d\.ts|next\.config\..+|postcss\.config\..+|eslint\.config\..+|\.env(?:\..+)?)$/.test(name)&&fs.statSync(name).isFile())fs.copyFileSync(name,path.join(out,name));
fs.symlinkSync(path.join(root,'node_modules'),path.join(out,'node_modules'),'junction');
const evidence=path.join(root,'docs/evidence/inbox-compact-web');fs.writeFileSync(path.join(evidence,'production-build-path.txt'),out);
const log=fs.openSync(path.join(evidence,'production-build.log'),'w');
const child=cp.spawn(process.execPath,[path.join(out,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:out,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore',log,log]});
child.on('exit',code=>{fs.closeSync(log);console.log(JSON.stringify({source:out,exit:code,log:'docs/evidence/inbox-compact-web/production-build.log'}));process.exitCode=code??1});
