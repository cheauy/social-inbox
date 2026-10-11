/* Read-only HEAD snapshot for separating existing failures from this change. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.cwd(),out=fs.mkdtempSync(path.join(process.env.TEMP,'tenh-inbox-baseline-'));
const archive=path.join(out,'source.tar'),source=path.join(out,'source');fs.mkdirSync(source);
cp.execFileSync('git',['archive','--format=tar','--output='+archive,'HEAD']);
cp.execFileSync('tar',['-xf',archive,'-C',source]);
fs.symlinkSync(path.join(root,'node_modules'),path.join(source,'node_modules'),'junction');
fs.writeFileSync(path.join(source,'.git'),'gitdir: '+path.join(root,'.git').replaceAll('\\','/')+'\n');
const files=cp.execFileSync('rg',['--files','tests'],{cwd:source,encoding:'utf8'}).split(/\r?\n/).filter(file=>/tests[\\/]inbox-.*\.test\.cjs$|tests[\\/]messenger-(reactions|replies|sources)[\\/].*\.test\.cjs$|tests[\\/](comment-reply-confirmation|facebook-comment-context|website-header-read-lifecycle|web-comment-badge|telegram-album-reconciliation|telegram-optimistic-media)\.test\.cjs$/.test(file));
const log=path.join(root,'docs/evidence/inbox-compact-web/baseline-regression-tests.log');
const result=cp.spawnSync(process.execPath,['--test','--test-concurrency=2',...files],{cwd:source,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});fs.writeFileSync(log,result.stdout+result.stderr);
fs.writeFileSync(path.join(root,'docs/evidence/inbox-compact-web/baseline-path.txt'),source);console.log(JSON.stringify({source,log,exit:result.status}));process.exitCode=result.status;
