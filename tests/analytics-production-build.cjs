// Isolated final-tree build. Never reads .env files or uses the project browser/profile.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=process.cwd(),task=fs.mkdtempSync(path.join(process.env.TEMP,'tenh-analytics-final-build-20261007-')),source=path.join(task,'source');fs.mkdirSync(source);
const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(f=>!/(^|\/)\.env|credential|secret|(^|\/)\.vercel\//i.test(f)&&!f.startsWith('docs/')&&!f.startsWith('db/proposals/')&&!f.startsWith('tests/')&&!f.endsWith('.sql'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),manifest={};
for(const file of files){const from=path.join(root,file);if(!fs.statSync(from).isFile())continue;const to=path.join(source,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);manifest[file]=hash(from);}
fs.symlinkSync(path.join(root,'node_modules'),path.join(source,'node_modules'),'junction');
fs.writeFileSync(path.join(task,'source-manifest.json'),JSON.stringify(manifest,null,2));
const env={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'https://analytics-fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon-key',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable-key',SUPABASE_SECRET_KEY:'synthetic-secret-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',TIKTOK_ADVERTISER_OAUTH_ENABLED:'false',TIKTOK_ACCOUNT_HOLDER_OAUTH_ENABLED:'false'});
const output=fs.openSync(path.join(task,'production-build.log'),'w');console.log('Isolated build: '+task);
const build=cp.spawnSync('C:/Users/TUF/AppData/Local/Headroom/headroom/bin/rtk.exe',['proxy',process.execPath,path.join(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:source,env,stdio:['ignore',output,output],windowsHide:true});fs.closeSync(output);
const drift=Object.keys(manifest).filter(f=>hash(path.join(root,f))!==manifest[f]);
const result={exit:build.status,error:build.error?.message,sourceDrift:drift,source,log:path.join(task,'production-build.log'),syntheticConfigOnly:true,advertiserEnabled:false,accountHolderEnabled:false,proposalInstalled:false};
fs.writeFileSync(path.join(task,'result.json'),JSON.stringify(result,null,2));fs.copyFileSync(path.join(task,'production-build.log'),'docs/evidence/analytics-redesign-20261007/production-build.log');fs.writeFileSync('docs/evidence/analytics-redesign-20261007/build-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=build.status??1;
