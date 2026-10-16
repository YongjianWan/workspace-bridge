// @slow
// @semantic
// Diff-context ranking: when the input file has uncommitted changes, impact
// surfaces files referencing the changed identifiers ahead of the graph+history
// list (source: 'diff-context'), interleaved first. One git-backed fixture per
// main language (AGENTS 开发原则第 8 条): the input exports a symbol, a single
// consumer references it alongside 16 noise dependents that push it out of the
// default 15 slots; after an uncommitted edit of the symbol's definition line,
// the consumer must re-enter the top 15 as a diff-context row.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ServiceContainer } = require('../src/services/container');
const impact = require('../src/tools/dep-tools/impact');
const { extractDiffSymbols } = require('../src/tools/dep-tools/diff-context');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const SYMBOL = 'computeTotal';

// Noise files sort before 'b' so the consumer drops out of the top 15 without
// diff context regardless of discovery order. The consumer also references a
// symbol that only exists after the uncommitted edit, so it alone becomes the
// top diff-context candidate (noise files share only the committed symbol).
const noise = (i) => `a${String(i).padStart(2, '0')}`;

const fixtures = [
  {
    language: 'JS/TS',
    input: 'src/a.ts', consumer: 'src/b.ts',
    files: (n) => ({
      'src/a.ts': `export function ${SYMBOL}(x: number): number { return x; }`,
      'src/b.ts': `import { ${SYMBOL}, newHook } from './a'; export const vb = newHook(2);`,
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/${noise(i)}.ts`,
        `import { ${SYMBOL} } from './a'; export const v${i} = ${SYMBOL}(${i});`])),
    }),
    edit: (content) => content + '\nexport function newHook(v: number): number { return v; }\n',
  },
  {
    language: 'Python',
    input: 'a.py', consumer: 'b.py',
    files: (n) => ({
      'a.py': `def ${SYMBOL}(x):\n    return x\n`,
      'b.py': `from a import ${SYMBOL}, new_hook\nvb = new_hook(2)\n`,
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`${noise(i)}.py`,
        `from a import ${SYMBOL} as c${i}\nv${i} = c${i}(${i})\n`])),
    }),
    edit: (content) => content + '\ndef new_hook(v):\n    return v\n',
  },
  {
    language: 'Java',
    input: 'src/p/A.java', consumer: 'src/q/B.java',
    files: (n) => ({
      'src/p/A.java': `package p; public class A { public int ${SYMBOL}(int x) { return x; } }`,
      'src/q/B.java': `package q; import p.A; public class B { int t = A.newHook(2); }`,
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/${noise(i)}/N.java`,
        `package ${noise(i)}; import p.A; public class N { int t = new A().${SYMBOL}(${i}); }`])),
    }),
    edit: (content) => content.replace(' }', ' public static int newHook(int v) { return v; } }'),
  },
  {
    language: 'Go',
    input: 'a/a.go', consumer: 'b/b.go',
    files: (n) => ({
      'go.mod': 'module example.com/diffctx\n\ngo 1.22\n',
      'a/a.go': `package a\n\nfunc ${SYMBOL}(x int) int { return x }\n`,
      'b/b.go': `package b\n\nimport "example.com/diffctx/a"\n\nvar Vb = a.NewHook(2)\n`,
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`${noise(i)}/${noise(i)}.go`,
        `package ${noise(i)}\n\nimport "example.com/diffctx/a"\n\nvar V${i} = a.${SYMBOL}(${i})\n`])),
    }),
    edit: (content) => content + '\nfunc NewHook(v int) int { return v }\n',
  },
  {
    language: 'Rust',
    input: 'src/a.rs', consumer: 'src/b.rs',
    files: (n) => ({
      'src/main.rs': `mod a;\nmod b;\n${Array.from({ length: n }, (_, i) => `mod ${noise(i)};`).join('\n')}\nfn main() {}\n`,
      'src/a.rs': `pub fn ${SYMBOL}(x: i32) -> i32 { x }\n`,
      'src/b.rs': `use crate::a::new_hook;\npub static VB: i32 = new_hook(2);\n`,
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/${noise(i)}.rs`,
        `use crate::a::${SYMBOL};\npub static V${i}: i32 = ${SYMBOL}(${i});\n`])),
    }),
    edit: (content) => content + '\npub fn new_hook(v: i32) -> i32 { v }\n',
  },
  {
    language: 'Vue',
    input: 'src/a.vue', consumer: 'src/b.vue',
    files: (n) => ({
      'package.json': JSON.stringify({ name: 'diffctx', version: '1.0.0' }),
      'src/a.vue': `<script lang="ts">\nexport function ${SYMBOL}(x: number): number { return x; }\n</script>\n`,
      'src/b.vue': `<script lang="ts">\nimport { ${SYMBOL}, newHook } from './a.vue';\nexport const vb = newHook(2);\n</script>\n`,
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/${noise(i)}.vue`,
        `<script lang="ts">\nimport { ${SYMBOL} } from './a.vue';\nexport const v${i} = ${SYMBOL}(${i});\n</script>\n`])),
    }),
    edit: (content) => content.replace('</script>', 'export function newHook(v: number): number { return v; }\n</script>'),
  },
];

// A4 workspace conditioning: a *different* dirty file's new identifier must
// surface its consumer when querying the (clean) input file. Mechanism is
// git-diff level and language-agnostic; the six fixtures exercise it per
// language anyway (AGENTS 开发原则第 8 条).
const WS = 'workspaceHook';
const workspaceFixtures = [
  {
    language: 'JS/TS', dirty: 'src/w.ts', consumer: 'src/c2.ts',
    dirtyBase: 'export const wBase = 1;\n',
    dirtyEdit: (c) => c + `export function ${WS}(v: number): number { return v; }\n`,
    consumerContent: `export const vc2 = ${WS}(3);\n`,
  },
  {
    language: 'Python', dirty: 'w.py', consumer: 'c2.py',
    dirtyBase: 'W_BASE = 1\n',
    dirtyEdit: (c) => c + `def ${WS}(v):\n    return v\n`,
    consumerContent: `vc2 = ${WS}(3)\n`,
  },
  {
    language: 'Java', dirty: 'src/r/W.java', consumer: 'src/s/C2.java',
    dirtyBase: 'package r; public class W { public int wBase() { return 1; } }',
    dirtyEdit: (c) => c.replace(' }', ` public static int ${WS}(int v) { return v; } }`),
    consumerContent: `package s; public class C2 { int t = W.${WS}(3); }`,
  },
  {
    language: 'Go', dirty: 'c/c.go', consumer: 'd/d.go',
    dirtyBase: 'package c\n\nfunc WBase() int { return 1 }\n',
    dirtyEdit: (c) => c + `func ${WS}(v int) int { return v }\n`,
    consumerContent: `package d\n\nvar Vc2 = ${WS}(3)\n`,
  },
  {
    language: 'Rust', dirty: 'src/w.rs', consumer: 'src/c2.rs', mainFile: 'src/main.rs',
    dirtyBase: 'pub fn w_base() -> i32 { 1 }\n',
    dirtyEdit: (c) => c + `pub fn ${WS}(v: i32) -> i32 { v }\n`,
    consumerContent: `pub static VC2: i32 = ${WS}(3);\n`,
  },
  {
    language: 'Vue', dirty: 'src/w.vue', consumer: 'src/c2.vue',
    dirtyBase: `<script lang="ts">\nexport const wBase = 1;\n</script>\n`,
    dirtyEdit: (c) => c.replace('</script>', `export function ${WS}(v: number): number { return v; }\n</script>`),
    consumerContent: `<script lang="ts">\nexport const vc2 = ${WS}(3);\n</script>\n`,
  },
];

function git(root, args) {
  execSync(`git -C "${root}" ${args}`, { stdio: 'pipe' });
}

async function verifyFixture(fixture) {
  const root = makeTempDir('wb-diff-context-');
  const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
  try {
    const files = fixture.files(16);
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    git(root, 'init -q');
    git(root, 'add -A');
    git(root, '-c user.email=t@t -c user.name=t commit -qm init');

    await container.initialize(root, 30000, { watch: false, quiet: true });
    const graph = container.snapshot.graph;
    const inputAbs = graph.normalizeFilePath(path.join(root, fixture.input));
    const consumerRel = fixture.consumer.replace(/\\/g, '/');
    const run = () => impact({ file: fixture.input, maxDepth: 5 }, container, inputAbs);
    const posOf = (res, rel) => res.impact.findIndex((r) => r.file.replace(/\\/g, '/').endsWith(rel));

    // Sanity: without diff context the consumer is pushed out of the top 15
    // by the 16 noise dependents (or at least not ahead of them as diff rows).
    const before = await run();
    const posBefore = posOf(before, consumerRel);
    assert(!before.impact.some((r) => r.source === 'diff-context'), `${fixture.language}: clean tree must not emit diff-context rows`);

    // Uncommitted edit of the definition line → diff contains the symbol.
    const inputPath = path.join(root, fixture.input);
    fs.writeFileSync(inputPath, fixture.edit(fs.readFileSync(inputPath, 'utf8')));

    const after = await run();
    const posAfter = posOf(after, consumerRel);
    assert(posAfter >= 0, `${fixture.language}: consumer must be reported after the edit`);
    assert(posAfter < 15, `${fixture.language}: consumer must re-enter the top 15, got position ${posAfter + 1}`);
    assert(after.impact[posAfter].source === 'diff-context',
      `${fixture.language}: consumer row must carry source diff-context, got ${after.impact[posAfter].source}`);
    assert(posBefore < 0 || posAfter < posBefore,
      `${fixture.language}: diff context must promote the consumer (${posBefore} → ${posAfter})`);
    console.log(`PASS ${fixture.language}: diff context promotes the consumer (pos ${posBefore} → ${posAfter})`);
  } finally {
    try { await container.shutdown(); } finally { cleanupTempDir(root); }
  }
}

async function verifyWorkspaceDiff(wf) {
  const root = makeTempDir('wb-diff-context-ws-');
  const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
  try {
    const files = fixtures.find((f) => f.language === wf.language).files(4);
    files[wf.dirty] = wf.dirtyBase;
    files[wf.consumer] = wf.consumerContent;
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    if (wf.mainFile) {
      const mainPath = path.join(root, wf.mainFile);
      fs.writeFileSync(mainPath, fs.readFileSync(mainPath, 'utf8')
        + `\nmod ${path.basename(wf.dirty).replace(/\.rs$/, '')};\nmod ${path.basename(wf.consumer).replace(/\.rs$/, '')};\n`);
    }
    git(root, 'init -q');
    git(root, 'add -A');
    git(root, '-c user.email=t@t -c user.name=t commit -qm init');

    await container.initialize(root, 30000, { watch: false, quiet: true });
    const graph = container.snapshot.graph;
    const inputAbs = graph.normalizeFilePath(path.join(root, fixtures.find((f) => f.language === wf.language).input));
    const consumerRel = wf.consumer.replace(/\\/g, '/');
    const run = () => impact({ file: fixtures.find((f) => f.language === wf.language).input, maxDepth: 5 }, container, inputAbs);
    const posOf = (res, rel) => res.impact.findIndex((r) => r.file.replace(/\\/g, '/').endsWith(rel));

    const before = await run();
    assert(posOf(before, consumerRel) < 0 || before.impact[posOf(before, consumerRel)].source !== 'diff-context',
      `${wf.language}: clean workspace must not promote the cross-file consumer`);

    // Dirty a *different* file; the queried input itself stays clean.
    const dirtyPath = path.join(root, wf.dirty);
    fs.writeFileSync(dirtyPath, wf.dirtyEdit(fs.readFileSync(dirtyPath, 'utf8')));

    const after = await run();
    const posAfter = posOf(after, consumerRel);
    assert(posAfter >= 0, `${wf.language}: cross-file consumer must be reported after the sibling edit`);
    assert(posAfter < 15, `${wf.language}: cross-file consumer must enter the top 15, got position ${posAfter + 1}`);
    assert(after.impact[posAfter].source === 'diff-context',
      `${wf.language}: cross-file consumer row must carry source diff-context, got ${after.impact[posAfter].source}`);
    console.log(`PASS ${wf.language}: workspace diff promotes the cross-file consumer (pos ${posOf(before, consumerRel)} → ${posAfter})`);
  } finally {
    try { await container.shutdown(); } finally { cleanupTempDir(root); }
  }
}

function verifyExtraction() {  const javaDiff = [
    '--- a/src/p/A.java',
    '+++ b/src/p/A.java',
    '@@ -1,1 +1,1 @@',
    '-  public int computeTotal(int x) { return x; }',
    '+  public int computeTotal(final int x) { return x; }',
  ].join('\n');
  assert(extractDiffSymbols(javaDiff).includes('computeTotal'), 'java def-line ident extracted');

  const xmlDiff = [
    '--- a/m/UserMapper.xml',
    '+++ b/m/UserMapper.xml',
    '@@ -1,1 +1,1 @@',
    '-  <select id="findByUser" resultType="User">',
    '+  <select id="findByUser" resultType="UserVO">',
  ].join('\n');
  const xmlGot = extractDiffSymbols(xmlDiff);
  assert(xmlGot.includes('findByUser'), `xml statement id extracted, got ${JSON.stringify(xmlGot)}`);

  const noisy = '+  public int status = getName();\n';
  const got = extractDiffSymbols(noisy);
  assert(!got.includes('public') && !got.includes('int'), `keywords filtered, got ${JSON.stringify(got)}`);
  // status/getName stay in: generic names are down-weighted at ranking time
  // by IDF (1/filesContaining), not dropped at extraction.

  assert.deepStrictEqual(extractDiffSymbols('x'.repeat(300000)), [], 'oversize diff treated as unavailable');
  assert.deepStrictEqual(extractDiffSymbols(''), [], 'empty diff yields no symbols');
}

(async () => {
  verifyExtraction();
  console.log('PASS extraction: java def line, xml statement id, stopwords, caps');
  for (const fixture of fixtures) await verifyFixture(fixture);
  for (const wf of workspaceFixtures) await verifyWorkspaceDiff(wf);
})().catch((err) => { console.error(err); process.exitCode = 1; });
