#!/usr/bin/env node
/**
 * Unit tests for watch output formatter (compact curation logic).
 */
const assert = require('assert');
const path = require('path');
const { formatWatchOutput } = require('../src/cli/watch');

const root = '/project';

function makeDepGraph({ entryFiles = [], testFiles = [] } = {}) {
  const entrySet = new Set(entryFiles);
  return {
    entryFiles: entrySet,
    isTestLikeFile(file) {
      return testFiles.includes(file);
    },
  };
}

function makeImpact(files) {
  return files.map((f) => ({ file: path.join(root, f) }));
}

function rel(base, filePath) {
  return path.relative(base, path.join(base, filePath));
}

function main() {

  // Non-compact: shows full list
  {
    const impact = makeImpact(['a.js', 'b.js', 'c.js']);
    const depGraph = makeDepGraph();
    const out = formatWatchOutput(root, path.join(root, 'src/x.js'), impact, depGraph, false);
    assert(out.includes('3 dependents affected:'), `Expected full format, got: ${out}`);
    assert(out.includes('a.js, b.js, c.js'), `Expected full list, got: ${out}`);
  }

  // Compact with <= 10 dependents still shows full list (curation only kicks in above threshold)
  {
    const impact = makeImpact(['a.js', 'b.js']);
    const depGraph = makeDepGraph();
    const out = formatWatchOutput(root, path.join(root, 'src/x.js'), impact, depGraph, true);
    assert(out.includes('2 dependents affected:'), `Expected full format below threshold, got: ${out}`);
  }

  // Compact with >10 dependents: categorizes into entries / tests / +more
  {
    const files = [
      'src/a.js',
      'src/b.js',
      'test/a-test.js',
      'test/b-test.js',
      'cli.js',
      'src/c.js',
      'src/d.js',
      'src/e.js',
      'src/f.js',
      'src/g.js',
      'src/h.js',
      'src/i.js',
    ];
    const impact = makeImpact(files);
    const depGraph = makeDepGraph({
      entryFiles: [path.join(root, 'cli.js')],
      testFiles: [path.join(root, 'test/a-test.js'), path.join(root, 'test/b-test.js')],
    });
    const out = formatWatchOutput(root, path.join(root, 'src/x.js'), impact, depGraph, true);
    assert(out.includes('12 dependents'), `Expected count summary, got: ${out}`);
    assert(out.includes('entries: [cli.js]'), `Expected entries section, got: ${out}`);
    assert(out.includes(`tests: [${rel(root, 'test/a-test.js')}, ${rel(root, 'test/b-test.js')}]`), `Expected tests section, got: ${out}`);
    assert(out.includes('+9 more') || out.includes('+ 9 more'), `Expected +more, got: ${out}`);
    assert(!out.includes('src/a.js'), `Should not list individual non-entry files in compact mode, got: ${out}`);
  }

  // Compact with >10 but no entries/tests
  {
    const files = Array.from({ length: 15 }, (_, i) => `src/f${i}.js`);
    const impact = makeImpact(files);
    const depGraph = makeDepGraph();
    const out = formatWatchOutput(root, path.join(root, 'src/x.js'), impact, depGraph, true);
    assert(out.includes('15 dependents'), `Expected count, got: ${out}`);
    assert(out.includes('+15 more'), `Expected +more, got: ${out}`);
    assert(!out.includes('entries:'), `Should not have entries section, got: ${out}`);
    assert(!out.includes('tests:'), `Should not have tests section, got: ${out}`);
  }

  // Compact with Windows paths (backslash normalization)
  {
    const winRoot = 'C:\\project';
    const files = ['cli.js', ...Array.from({ length: 11 }, (_, i) => `src\\f${i}.js`)];
    const impact = files.map((f) => ({ file: path.join(winRoot, f) }));
    const depGraph = makeDepGraph({
      entryFiles: [path.join(winRoot, 'cli.js')],
      testFiles: [],
    });
    const out = formatWatchOutput(winRoot, path.join(winRoot, 'src\\x.js'), impact, depGraph, true);
    assert(out.includes('12 dependents'), `Windows path count, got: ${out}`);
    assert(out.includes(`entries: [${rel(winRoot, 'cli.js')}]`), `Windows path entry, got: ${out}`);
  }

}

try {
  main();
} catch (err) {
  console.error('Test failed:', err.message);
  process.exit(1);
}
