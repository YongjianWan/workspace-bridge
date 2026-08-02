#!/usr/bin/env node
// @contract — Python parser functionRecords field parity

const assert = require('assert');
const { parsePython } = require('../src/services/dep-graph/parsers/python');

async function testPublicFunctionFields() {
  const source = `
from typing import Optional

@deprecated
def compute(x: int) -> Optional[str]:
    if x > 0:
        return "positive"
    return None
`;
  const parsed = await parsePython(source, 'test.py');
  if (!parsed) {
    console.log('Python parser skipped (not available)');
    return;
  }
  assertTopLevelSchema(parsed);
  const compute = parsed.functionRecords.find((f) => f.name === 'compute');
  assert(compute, 'should find compute function');
  assert.strictEqual(compute.isExported, true, 'compute should be exported');
  assert.strictEqual(compute.returnType, 'Optional[str]', `returnType should be Optional[str], got ${compute.returnType}`);
  assert.deepStrictEqual(compute.decorators, ['deprecated'], `decorators should be [deprecated], got ${JSON.stringify(compute.decorators)}`);
  assert(compute.fingerprint, 'should preserve fingerprint');
  assert.strictEqual(compute.fingerprint.maxArms, 1, 'single if should produce 1 arm');
  assert.strictEqual(compute.branchCount, compute.fingerprint.branchCount, 'branchCount should be lifted to functionRecord top level');
  assert.strictEqual(compute.maxArms, compute.fingerprint.maxArms, 'maxArms should be lifted to functionRecord top level');
  assert.strictEqual(compute.branchCount, 1, 'single if should produce branchCount 1');
  assert.strictEqual(compute.maxArms, 1, 'single if should produce maxArms 1');
}

async function testAllOverrideMarksUnlistedAsNotExported() {
  const source = `
__all__ = ['listed']

def listed():
    pass

def unlisted():
    pass
`;
  const parsed = await parsePython(source, 'test.py');
  if (!parsed) {
    console.log('Python parser skipped (not available)');
    return;
  }
  const listed = parsed.functionRecords.find((f) => f.name === 'listed');
  const unlisted = parsed.functionRecords.find((f) => f.name === 'unlisted');
  assert(listed, 'should find listed function');
  assert(unlisted, 'should find unlisted function');
  assert.strictEqual(listed.isExported, true, 'listed should be exported');
  assert.strictEqual(unlisted.isExported, false, 'unlisted should not be exported when omitted from __all__');
}

async function testDecoratedFunctionDottedDecorator() {
  const source = `
@app.route('/')
def handler():
    pass
`;
  const parsed = await parsePython(source, 'test.py');
  if (!parsed) {
    console.log('Python parser skipped (not available)');
    return;
  }
  const handler = parsed.functionRecords.find((f) => f.name === 'handler');
  assert(handler, 'should find handler function');
  assert.deepStrictEqual(handler.decorators, ['app.route'], `decorators should preserve dotted path, got ${JSON.stringify(handler.decorators)}`);
  assert.strictEqual(handler.returnType, null, 'handler should have no return type');
}

// L3-9 parity guards — behaviors the reference-corpus parity harness
// (scripts/parser-parity-python.js) caught diverging during the tree-sitter
// migration. Each one passed every pre-existing test when mutated; they are
// locked here so the harness is not the only guard.
async function testParityGuards() {
  const source = `from __future__ import annotations

def typed_default(x: int = 5, y: str = "a"):
    if x > 1:
        return
    else:
        if y:
            pass
        elif x == 1:
            pass
`;
  const parsed = await parsePython(source, 'test.py');
  if (!parsed) {
    console.log('Python parser skipped (not available)');
    return;
  }

  // future_import_statement is its own node type, not import_from_statement.
  assert(parsed.imports.includes('__future__'), `__future__ import must be collected, got ${JSON.stringify(parsed.imports)}`);
  const futureRec = parsed.importRecords.find((r) => r.source === '__future__');
  assert(futureRec, 'should have __future__ importRecord');
  assert.deepStrictEqual(futureRec.imported, ['annotations'], '__future__ imported names');

  // typed_default_parameter (`x: int = 5`) counts in paramCount (CPython parity).
  const fn = parsed.functionRecords.find((f) => f.name === 'typed_default');
  assert(fn, 'should find typed_default');
  assert.strictEqual(fn.fingerprint.paramCount, 2, `typed-default params count, got ${fn.fingerprint.paramCount}`);
  assert.strictEqual(fn.hasParameterTypeHints, true, 'typed-default params set hasParameterTypeHints');

  // CPython cannot tell elif from `else:` holding a single if — both extend
  // the chain. Shape matters: arms only diverge when the nested if brings
  // its own elif (merged chain = 3 arms; unchained counting splits it 2+2).
  assert.strictEqual(fn.fingerprint.maxArms, 3, `else-single-if chain arms, got ${fn.fingerprint.maxArms}`);
  assert.strictEqual(fn.fingerprint.branchCount, 3, `chain branchCount, got ${fn.fingerprint.branchCount}`);
}

// Review-round parity guards — six more divergences caught by adversarial
// probes AFTER the first 437-file zero-diff. Same lesson as above: every one
// of them passed the whole suite before being locked here.
async function testReviewProbes() {
  // 1. Non-literal __all__ OVERRIDES exports with empty (CPython returns []
  //    for non-list values, not None).
  const p1 = await parsePython(`__all__ = ['visible'] + other.__all__\n\ndef visible(): pass\ndef hidden(): pass\n`, 't.py');
  assert.deepStrictEqual(p1.exports, [], `non-literal __all__ empties exports, got ${JSON.stringify(p1.exports)}`);
  assert(p1.functionRecords.every((r) => r.isExported === false), 'isExported all false under non-literal __all__');

  // 2. Multiple __all__ assignments: the LAST one wins.
  const p2 = await parsePython(`__all__ = ['first']\n__all__ = ['second']\n\ndef first(): pass\ndef second(): pass\n`, 't.py');
  assert.deepStrictEqual(p2.exports, ['second'], `last __all__ wins, got ${JSON.stringify(p2.exports)}`);

  // 3. paramCount excludes positional-only params (BEFORE the `/`).
  const p3 = await parsePython(`def slash_only(a, /, b, c):\n    pass\n`, 't.py');
  assert.strictEqual(p3.functionRecords[0].fingerprint.paramCount, 2, `posonly excluded, got ${p3.functionRecords[0].fingerprint.paramCount}`);

  // 4. ast.AsyncFor is not ast.For — async-for does not count as a branch.
  const p4 = await parsePython(`async def f(ait):\n    async for x in ait:\n        pass\n`, 't.py');
  assert.strictEqual(p4.functionRecords[0].fingerprint.branchCount, 0, `async-for uncounted, got ${p4.functionRecords[0].fingerprint.branchCount}`);

  // 5. Decorator expressions of NESTED defs are not walked.
  const p5 = await parsePython(`import functools\ndef outer():\n    @functools.lru_cache(maxsize=1 if True else 2)\n    def inner():\n        pass\n    return inner\n`, 't.py');
  assert.strictEqual(p5.functionRecords[0].fingerprint.branchCount, 0, `nested decorator IfExp uncounted, got ${p5.functionRecords[0].fingerprint.branchCount}`);

  // 6. returnType follows ast.unparse normalization, not source text.
  const p6 = await parsePython(`from typing import Dict, List\ndef a() -> Dict[str,int]: pass\ndef b() -> List[ int ]: pass\ndef c() -> (int): pass\ndef d() -> int|str: pass\n`, 't.py');
  const rt = Object.fromEntries(p6.functionRecords.map((r) => [r.name, r.returnType]));
  assert.strictEqual(rt.a, 'Dict[str, int]', `comma spacing, got ${rt.a}`);
  assert.strictEqual(rt.b, 'List[int]', `bracket spacing, got ${rt.b}`);
  assert.strictEqual(rt.c, 'int', `redundant parens stripped, got ${rt.c}`);
  assert.strictEqual(rt.d, 'int | str', `union spacing, got ${rt.d}`);

  // 7. PEP 654 `except*` handlers are ast.ExceptHandler in CPython (TryStar
  //    reuses the node type), so they count as branches like plain `except`.
  //    tree-sitter gives them a distinct node type, except_group_clause.
  const p7 = await parsePython(`def f(payload):\n    try:\n        body(payload)\n    except* ValueError as eg:\n        handle(eg)\n`, 't.py');
  const g = p7.functionRecords[0].fingerprint;
  assert.strictEqual(g.branchCount, 1, `except* counts as a branch, got ${g.branchCount}`);
  assert.strictEqual(g.hasTryCatch, true, 'except* sets hasTryCatch');
}

function assertTopLevelSchema(result) {
  const expected = ['exportRecords', 'exports', 'functionRecords', 'importRecords', 'imports', 'parseMode'];
  for (const key of expected) {
    assert(key in result, `missing top-level key ${key}`);
  }
}

async function main() {
  const tests = [
    testPublicFunctionFields,
    testAllOverrideMarksUnlistedAsNotExported,
    testDecoratedFunctionDottedDecorator,
    testParityGuards,
    testReviewProbes,
  ];

  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
