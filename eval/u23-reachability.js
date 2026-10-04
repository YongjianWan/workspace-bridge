// @semantic
'use strict';
const fs=require('fs');const path=require('path');const os=require('os');const cp=require('child_process');
const base=path.join(os.tmpdir(),'wb-u23-agent-trials/reachability');
const out=path.join(__dirname,'truth/u23-agent-trials/reachability');
fs.mkdirSync(base,{recursive:true});fs.mkdirSync(out,{recursive:true});
const files={'package.json':JSON.stringify({name:'u23-reachability',version:'1.0.0',main:'src/index.js'}),'.workspace-bridge.json':JSON.stringify({directories:{generated:['generated']}}),'src/index.js':'module.exports=1;','src/a.js':'const b=require("./b"); module.exports={b};','src/b.js':'const a=require("./a"); module.exports={a};','generated/out.js':'module.exports=2;','README.md':'# Example'};
for(const[n,s]of Object.entries(files)){const p=path.join(base,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
for(const args of [['init'],['add','.'],['-c','user.name=U23','-c','user.email=u23@example.invalid','commit','--allow-empty','-m','baseline']])cp.execFileSync('git',args,{cwd:base,encoding:'utf8'});
for(const n of ['generated/out.js','README.md'])fs.appendFileSync(path.join(base,n),'\n');
const cases=[['guard-cycle-human',['guard','--files','src/a.js,src/b.js','--format','human']],['guard-cycle-markdown',['guard','--files','src/a.js,src/b.js','--format','markdown']],['guard-cycle-json',['guard','--files','src/a.js,src/b.js','--json']],['guard-missing',['guard','--file','missing.js','--format','jsonl']],['generated-docs',['audit-diff','--files','generated/out.js,README.md','--json']],['generated-only',['audit-diff','--files','generated/out.js','--json']],['empty-diff',['audit-diff','--files','unknown.js','--json']],['empty-staged',['audit-diff','--staged','--json']]];
for(const[id,args]of cases){const actual=['cli.js',...args,'--cwd',base,'--quiet'];const r=cp.spawnSync(process.execPath,actual,{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:90000});const record={id,args:actual,status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr};fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({id,exit:r.status,stdoutChars:r.stdout?.length,stderr:r.stderr?.slice(0,200)}));}
const nongit=path.join(os.tmpdir(),'wb-u23-agent-trials/injection');
const args=['cli.js','guard','--staged','--format','jsonl','--cwd',nongit,'--quiet'];
const r=cp.spawnSync(process.execPath,args,{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:90000});
fs.writeFileSync(path.join(out,'guard-nongit.json'),JSON.stringify({args,status:r.status,stdout:r.stdout,stderr:r.stderr},null,2));
console.log(JSON.stringify({id:'guard-nongit',exit:r.status,stdout:r.stdout}));
