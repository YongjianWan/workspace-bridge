// @semantic
// C/C++ include resolution + external gate (L1-4 / L2-11 C-C++ leg).
//
// Quote form `#include "b.h"` is relative to the including file *by language
// definition* — C/C++ never writes './'. Angle form `#include <stdio.h>` names
// a toolchain header and must produce neither an edge nor a symbol-table guess:
// with the '.'-only delimiter the guess would query a symbol named after the
// extension ('boost/algorithm/string.hpp' → 'hpp'), the same fabrication shape
// as require('path') → shared.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { resolveImport } = require('../src/services/dep-graph/resolvers');
const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cpp-resolver-'));
}

// ---------------------------------------------------------------------------
// Quote form — structural resolution
// ---------------------------------------------------------------------------

function testQuoteIncludeResolvesRelativeToFile() {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'b.h'), 'int helper(void);\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.c'), '#include "b.h"\n');

    const outMeta = {};
    const resolved = resolveImport(
      path.join(tmp, 'src', 'a.c'), 'b.h', '.c', tmp, null, outMeta, { isLocal: true }
    );
    assert.strictEqual(resolved, path.join(tmp, 'src', 'b.h'), 'quote include must resolve next to the includer');
    assert.strictEqual(outMeta.method, 'cpp-include', 'method should be cpp-include');
    assert.strictEqual(outMeta.tier, 'tier1');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testQuoteIncludeFallsBackToIncludeRoot() {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'include', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'include', 'foo', 'bar.h'), 'int bar(void);\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.c'), '#include "foo/bar.h"\n');

    const resolved = resolveImport(
      path.join(tmp, 'src', 'a.c'), 'foo/bar.h', '.c', tmp, null, {}, { isLocal: true }
    );
    assert.strictEqual(
      resolved,
      path.join(tmp, 'include', 'foo', 'bar.h'),
      'quote include should fall back to conventional include roots'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Angle form — never an edge, never a guess
// ---------------------------------------------------------------------------

function testAngleIncludeNeverResolvesLocally() {
  const tmp = makeTmp();
  try {
    // Even when a same-named file exists in the repo, angle form names the
    // toolchain, not the repo.
    fs.writeFileSync(path.join(tmp, 'stdio.h'), '/* local decoy */\n');
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.c'), '#include <stdio.h>\n');

    const resolved = resolveImport(
      path.join(tmp, 'src', 'a.c'), 'stdio.h', '.c', tmp, null, {}, { isLocal: false }
    );
    assert.strictEqual(resolved, null, 'angle include must never resolve to a repo file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testAngleIncludeNeverSymbolGuessed() {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.c'), '#include <boost/algorithm/string.hpp>\n');

    const registry = new SymbolRegistry();
    // The '.'-only delimiter reduces 'boost/algorithm/string.hpp' to 'hpp' —
    // if the guess ever fires, this registered symbol catches it.
    registry.register(path.join(tmp, 'src', 'decoy.cpp'), [{ name: 'hpp' }]);

    const resolved = resolveImport(
      path.join(tmp, 'src', 'a.c'), 'boost/algorithm/string.hpp', '.cpp', tmp, registry, {}, { isLocal: false }
    );
    assert.strictEqual(resolved, null, 'angle include must not fall through to symbol guessing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Gate without parser hints (regex fallback, legacy entry points)
// ---------------------------------------------------------------------------

function testSystemHeadersBlockedWithoutHints() {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.c'), '#include <stdio.h>\n');

    const registry = new SymbolRegistry();
    registry.register(path.join(tmp, 'src', 'decoy.c'), [{ name: 'stdio' }]);

    // No hints: the stateless gate (system header list) must do the blocking.
    const resolved = resolveImport(path.join(tmp, 'src', 'a.c'), 'stdio.h', '.c', tmp, registry);
    assert.strictEqual(resolved, null, 'system header must be gated even without isLocal hints');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testExtensionlessIncludeBlockedWithoutHints() {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.cpp'), '#include <vector>\n');

    const registry = new SymbolRegistry();
    registry.register(path.join(tmp, 'src', 'decoy.cpp'), [{ name: 'vector' }]);

    const resolved = resolveImport(path.join(tmp, 'src', 'a.cpp'), 'vector', '.cpp', tmp, registry);
    assert.strictEqual(resolved, null, 'extensionless C++ stdlib name must be gated even without hints');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Positive control: quote-form include of a real header still resolves
// end-to-end through the gate (gate must not eat local edges).
// ---------------------------------------------------------------------------

function testLocalHeaderSurvivesGate() {
  const tmp = makeTmp();
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'config.h'), '#define CFG 1\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.c'), '#include "config.h"\n');

    const registry = new SymbolRegistry();
    const resolved = resolveImport(path.join(tmp, 'src', 'a.c'), 'config.h', '.c', tmp, registry, {}, { isLocal: true });
    assert.strictEqual(resolved, path.join(tmp, 'src', 'config.h'), 'local quote include must survive the gate');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

testQuoteIncludeResolvesRelativeToFile();
testQuoteIncludeFallsBackToIncludeRoot();
testAngleIncludeNeverResolvesLocally();
testAngleIncludeNeverSymbolGuessed();
testSystemHeadersBlockedWithoutHints();
testExtensionlessIncludeBlockedWithoutHints();
testLocalHeaderSurvivesGate();

console.log('cpp-resolver-test: all passed');
