// @semantic — H-7 evidence: precision/recall of typer's affected-tests under candidate cut rules.
//
//   node eval/verify-h7-tradeoff.js
//
// Truth is the coverage map (eval/truth/out/python/typer/gt.json). Each rule keeps a subset of the
// rows `findAffectedTests` returns; the first line (`all`) is what the CLI returns today.
// Needs `node eval/run.js typer` to have produced gt.json and the cache.
const path = require('path');
const R = path.resolve(__dirname, '..') + '/';
const {ServiceContainer}=require(R+'src/services/container');
const lib=require(R+'eval/lib.js');
(async()=>{
 const corpus=lib.loadCorpus?lib.loadCorpus():null;
 const entry=(corpus.repos||corpus).find(e=>e.name==='typer');
 const repoDir=lib.repoDir(entry);const gt=require(path.join(lib.outDir(entry),'gt.json'));
 const c=new ServiceContainer({quiet:true,cacheDir:path.join(lib.outDir(entry),'cache')});await c.initialize(repoDir);
 const g=c.snapshot.graph;const toRel=f=>path.relative(repoDir,f).split(String.fromCharCode(92)).join('/');
 const testsDir=entry.affectedTests.tests+'/';const isT=p=>p.startsWith(testsDir)&&p.split('/').pop().startsWith('test_');
 const rowsBySrc={};for(const src of Object.keys(gt.map)){rowsBySrc[src]=g.findAffectedTests(path.resolve(repoDir,src)).filter(r=>isT(toRel(r.file))).map(r=>({file:toRel(r.file),d:r.distance,hub:Math.max(0,...(r.via||[]).slice(1).map(v=>g.getDependents(v).length))}))}
 const score=(keep)=>{let tp=0,fp=0,fn=0;for(const [src,real] of Object.entries(gt.map)){const R=new Set(real);const P=new Set(rowsBySrc[src].filter(keep).map(r=>r.file));for(const p of P)R.has(p)?tp++:fp++;for(const r of R)if(!P.has(r))fn++}return {p:(tp/(tp+fp)).toFixed(3),r:(tp/(tp+fn)).toFixed(3),n:tp+fp}};
 console.log('all',score(()=>true));
 for(const H of [5,10,20,30,50,80]) console.log('drop d>=2 && hub>=',H,score(r=>!(r.d>=2&&r.hub>=H)));
 for(const D of [1,2]) console.log('maxdist',D,score(r=>r.d<=D));
 await c.shutdown();
})().catch(e=>{console.error(e);process.exit(1)});
