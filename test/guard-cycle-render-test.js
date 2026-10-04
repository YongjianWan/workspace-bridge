// @semantic
const assert = require('assert');
const { formatGuardHuman } = require('../src/cli/formatters/guard-formatter');

function render(files, impactItems) {
  return formatGuardHuman({
    ok: true, passed: true, files, impactItems, exceeded: [],
    stats: { directDependentsCount: impactItems.length, transitiveDependentsCount: impactItems.length },
    limits: { maxDependents: Infinity, maxTransitive: Infinity },
  });
}

const edge = (file, parent) => ({ file, via: [parent] });
const cycle = render(['a.js', 'b.js'], [edge('b.js', 'a.js'), edge('a.js', 'b.js')]);
assert(cycle.includes('Target: a.js') && cycle.includes('Target: b.js'), 'each selected root must be rendered');
assert(cycle.includes('[already shown]'), 'cycle edge must stay visible without expanding again');
assert(cycle.split('\n').length < 20, 'cycle output must be finite and small');

const diamond = render(['a.js'], [edge('b.js', 'a.js'), edge('c.js', 'a.js'), edge('d.js', 'b.js'), edge('d.js', 'c.js'), edge('e.js', 'd.js')]);
assert.strictEqual(diamond.split('\n').filter((line) => line.endsWith('e.js')).length, 1, 'shared subtree expands once per root');
assert(diamond.includes('d.js [already shown]'), 'shared edge must not disappear');

const deep = Array.from({ length: 6000 }, (_, i) => edge(`f${i + 1}`, `f${i}`));
const text = render(['f0'], deep);
assert(text.includes('f6000'), 'deep acyclic graph must not overflow the JavaScript call stack');
assert.strictEqual(text.split('\n').filter((line) => line.startsWith('Target:')).length, 1);

const simple = render(['root'], [edge('c', 'root'), edge('b', 'root'), edge('leaf', 'b')]);
assert(simple.endsWith('Target: root\n├── b\n│   └── leaf\n└── c'), 'acyclic output order and connectors remain compatible');
console.log('guard-cycle-render-test: all passed');
