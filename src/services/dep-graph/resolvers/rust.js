const path = require('path');
const { cachedExistsSync, findCargoCrateRoot, readCargoCrateName } = require('./base');

function resolveRustModulePath(modulePath, root, baseDir) {
  const segments = modulePath.split('::').filter(Boolean);
  if (segments.length === 0) return null;

  const searchBase = baseDir || path.join(root, 'src');

  for (let i = segments.length; i > 0; i--) {
    const subPath = segments.slice(0, i).join('/');
    const candidates = [
      path.join(searchBase, `${subPath}.rs`),
      path.join(searchBase, `${subPath}/mod.rs`),
    ];
    for (const candidate of candidates) {
      if (cachedExistsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * The file of the module whose submodule directory is `baseDir`: baseDir/mod.rs
 * or baseDir.rs (lib.rs/main.rs when baseDir is a crate root). Used when the
 * single trailing segment of a super::/crate:: path names an *item* of that
 * module rather than a submodule — `super::QartezServer` from
 * src/server/prompts.rs means "QartezServer in the server module", which lives
 * in src/server/mod.rs.
 */
function _baseModuleFile(baseDir) {
  const candidates = [
    path.join(baseDir, 'mod.rs'),
    `${baseDir}.rs`,
    path.join(baseDir, 'lib.rs'),
    path.join(baseDir, 'main.rs'),
  ];
  for (const candidate of candidates) {
    if (cachedExistsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function tryRustCrate(importPath, fromFile, ctx) {
  const crateRoot = findCargoCrateRoot(fromFile, ctx.root);
  let modulePath;
  if (importPath.startsWith('crate::')) {
    modulePath = importPath.slice('crate::'.length);
  } else {
    // L2-16: own-crate-name paths are crate::-rooted with the Cargo-normalized
    // crate name (`qartez-mcp` → `qartez_mcp`, [lib] name wins when explicit).
    // Integration tests address their crate this way; guessing them against
    // the symbol table was the false "Rust symbol-table 正产出" (TECH_DEBT
    // L2-16: 152 drops + 167 symbol-table edges, one gap's two sides).
    const crateName = readCargoCrateName(crateRoot);
    if (!crateName || !importPath.startsWith(crateName + '::')) return null;
    modulePath = importPath.slice(crateName.length + 2);
  }
  // crate:: is rooted at the *nearest* Cargo.toml's src — a workspace can hold
  // several crates, each with its own crate root (qartez-mcp/qartez-dashboard).
  const searchBase = path.join(crateRoot, 'src');
  const resolved = resolveRustModulePath(modulePath, crateRoot, searchBase)
    // Single segment that is not a submodule names an item of the crate root
    // (crate::QartezServer → src/lib.rs). Multi-segment failures must not fall
    // back: super::foo::Bar requires foo to be a module, not an item.
    || (modulePath.split('::').filter(Boolean).length === 1 ? _baseModuleFile(searchBase) : null);
  if (resolved && ctx.outMeta) {
    ctx.outMeta.method = 'rust-crate';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
  return resolved;
}

function tryRustSuper(importPath, fromFile, ctx) {
  if (!importPath.startsWith('super::')) return null;
  let climbs = 0;
  let remaining = importPath;
  while (remaining.startsWith('super::')) {
    remaining = remaining.slice('super::'.length);
    climbs += 1;
  }
  if (!remaining) return null;

  // Module arithmetic, not directory arithmetic: a non-mod file (blame.rs)
  // belongs to the module whose submodule directory is the file's own
  // directory, so its first `super` refers to that module and costs no climb.
  // A mod.rs file IS the module named by its parent directory, so every
  // `super` climbs. The old code always climbed once per super, which is why
  // every super:: path from a non-mod file fell through to the symbol table
  // (TECH_DEBT L2-12: 127 such edges on qartez-mcp).
  const fromDir = path.dirname(fromFile);
  const isModFile = path.basename(fromFile) === 'mod.rs';
  const effectiveClimbs = isModFile ? climbs : climbs - 1;

  const crateRoot = findCargoCrateRoot(fromFile, ctx.root);
  const srcRoot = path.join(crateRoot, 'src');

  let baseDir = fromDir;
  for (let i = 0; i < effectiveClimbs; i += 1) {
    const parent = path.dirname(baseDir);
    if (parent === baseDir || !parent.startsWith(srcRoot)) {
      return null;
    }
    baseDir = parent;
  }

  const resolved = resolveRustModulePath(remaining, ctx.root, baseDir)
    // Single segment that is not a submodule names an item of the base module
    // (super::QartezServer from src/server/prompts.rs → src/server/mod.rs).
    || (remaining.split('::').filter(Boolean).length === 1 ? _baseModuleFile(baseDir) : null);
  if (resolved && ctx.outMeta) {
    ctx.outMeta.method = 'rust-super';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
  return resolved;
}

/**
 * Rust 2018+ bare first segment (`use grounding::FileFacts`) names a
 * submodule of the CURRENT module — verified against rustc on edition 2024
 * (TECH_DEBT L2-19: 12 measured drops on qartez-mcp, all of this shape).
 *
 * Scope rules (2018 path rules): mod.rs/lib.rs/main.rs ARE the module named by
 * their parent (or the crate root), so their submodules live beside them; any
 * other file (server.rs) is a module whose submodules live in <stem>/. An
 * unknown segment returns null and falls through to the external gate / symbol
 * table — extern crate names and std/core/alloc exist as no file here.
 *
 * Deliberately NOT implemented: ancestor-module lookup. Ancestor module items
 * are not in scope in Rust 2018+ without super::/crate:: — walking up would
 * fabricate edges for code that does not compile. If rustc-visible ancestor
 * shapes ever appear, the dropped-imports alarm will name them.
 */
function tryRustScoped(importPath, fromFile, ctx) {
  if (
    importPath.startsWith('crate::') ||
    importPath.startsWith('super::') ||
    importPath.startsWith('self::')
  ) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const base = path.basename(fromFile);
  const isModuleFile = base === 'mod.rs' || base === 'lib.rs' || base === 'main.rs';
  const baseDir = isModuleFile ? fromDir : path.join(fromDir, base.replace(/\.rs$/, ''));

  // A bare segment never names a module outside the current crate's src.
  const crateRoot = findCargoCrateRoot(fromFile, ctx.root);
  const srcRoot = path.join(crateRoot, 'src');
  if (baseDir !== srcRoot && !baseDir.startsWith(srcRoot + path.sep)) return null;

  const resolved = resolveRustModulePath(importPath, ctx.root, baseDir);
  if (resolved && ctx.outMeta) {
    ctx.outMeta.method = 'rust-scoped';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
  return resolved;
}

module.exports = {
  tryRustCrate,
  tryRustSuper,
  tryRustScoped,
  resolveRustModulePath,
};
