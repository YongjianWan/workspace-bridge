/**
 * C/C++ include resolution (L1-4).
 *
 * Quote form `#include "b.h"` is relative to the including file *by language
 * definition* — C/C++ source never writes './', so the JS chain this used to
 * borrow (tryAlias / tryRelativeWithExtensions) classified every include as a
 * package name, found nothing, and the record was silently dropped. Angle form
 * `#include <stdio.h>` names a toolchain header and is never resolved against
 * repo files here; the symbol-guess block lives with the gate in resolvers.js
 * (_isExternalCppHeader).
 *
 * The quote/angle distinction comes from the parser: cpp-ast.js writes
 * `isLocal: true` for quote form into the import record, builder.js threads it
 * through resolveImport as `importHints`. When hints are absent (regex
 * fallback, legacy entry points) the bare specifier is all we know, and trying
 * resolution is the safer side: a miss costs nothing, and the stateless gate
 * still blocks known system headers from symbol guessing.
 */

const path = require('path');
const { cachedExistsSync } = require('./base');

const CPP_EXTENSIONS = new Set(['.c', '.cpp', '.cc', '.h', '.hpp']);

// C++ standard library headers, extensionless as written in source.
// Single home: registry.js's isBuiltIn declaration imports this set.
const CPP_BUILTINS = new Set([
  'iostream', 'vector', 'string', 'map', 'set', 'algorithm', 'memory', 'cmath',
  'cstdio', 'cstdlib', 'cstring', 'fstream', 'sstream', 'thread', 'mutex', 'future'
]);

// C standard + common POSIX system headers, as written (`#include <stdio.h>`).
const C_SYSTEM_HEADERS = new Set([
  'assert.h', 'ctype.h', 'errno.h', 'float.h', 'inttypes.h', 'limits.h',
  'locale.h', 'math.h', 'setjmp.h', 'signal.h', 'stdarg.h', 'stdbool.h',
  'stddef.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'string.h', 'time.h',
  'wchar.h', 'wctype.h',
  'unistd.h', 'fcntl.h', 'pthread.h', 'dirent.h', 'termios.h', 'sys/stat.h'
]);

// Conventional project include roots for quote-form specifiers that name a
// path from the project root (#include "foo/bar.h" compiled with -Iinclude).
const CPP_INCLUDE_ROOTS = ['include', 'src'];

function _setMeta(ctx) {
  if (ctx.outMeta) {
    ctx.outMeta.method = 'cpp-include';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
}

function tryCppInclude(importPath, fromFile, ctx) {
  if (!importPath || !fromFile) return null;

  // Angle-bracket form names a toolchain/system header: it never resolves to
  // a repo file, even when a same-named file happens to exist locally.
  if (ctx.importHints && ctx.importHints.isLocal === false) return null;

  // Quote form: relative to the includer first (the language-defined rule).
  const direct = path.resolve(path.dirname(fromFile), importPath);
  if (cachedExistsSync(direct)) {
    _setMeta(ctx);
    return direct;
  }

  // Then conventional include roots.
  for (const incRoot of CPP_INCLUDE_ROOTS) {
    const candidate = path.join(ctx.root, incRoot, importPath);
    if (cachedExistsSync(candidate)) {
      _setMeta(ctx);
      return candidate;
    }
  }

  return null;
}

module.exports = {
  tryCppInclude,
  CPP_EXTENSIONS,
  CPP_BUILTINS,
  C_SYSTEM_HEADERS,
};
