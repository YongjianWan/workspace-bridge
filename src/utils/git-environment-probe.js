/**
 * Git workspace environment probe.
 *
 * Detects environmental conditions that degrade the reliability of
 * git-derived signals (co-change, blame, history risk, etc.).
 *
 * All detections are defensive: if a git command fails or is unavailable,
 * the condition is treated as absent rather than throwing.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { DATA_QUALITY, REMEDIATION } = require('../config/data-quality');

const PROJECT_MARKERS = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'tsconfig.json',
];

function runGit(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function isGitRepo(root) {
  const r = runGit(root, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && r.stdout.trim() === 'true';
}

function isShallowClone(root) {
  const r = runGit(root, ['rev-parse', '--is-shallow-repository']);
  return r.status === 0 && r.stdout.trim() === 'true';
}

function isSparseCheckout(root) {
  // Modern git: sparse-checkout list returns included paths when enabled.
  const list = runGit(root, ['sparse-checkout', 'list']);
  if (list.status === 0) {
    const lines = list.stdout.split(/\r?\n/).filter(Boolean);
    // Disabled sparse-checkout prints nothing on newer git.
    if (lines.length > 0) return true;
  }
  // Fallback for older git or when the list command is inconclusive.
  const cfg = runGit(root, ['config', '--get', 'core.sparseCheckout']);
  return cfg.status === 0 && cfg.stdout.trim() === 'true';
}

function isInsideSubmodule(root) {
  const r = runGit(root, ['rev-parse', '--show-superproject-working-tree']);
  return r.status === 0 && r.stdout.trim().length > 0;
}

function hasSubmodules(root) {
  if (isInsideSubmodule(root)) return true;
  try {
    return fs.existsSync(path.join(root, '.gitmodules'));
  } catch {
    return false;
  }
}

const LFS_POINTER_HEADER = 'version https://git-lfs.github.com/spec/v1';

function hasLfsPointers(root) {
  // Preferred: ask git-lfs which files it manages.
  const lfs = runGit(root, ['lfs', 'ls-files']);
  if (lfs.status === 0) {
    return lfs.stdout.trim().length > 0;
  }
  // Fallback: detect .gitattributes filter=lfs declarations.
  try {
    const attrsPath = path.join(root, '.gitattributes');
    if (!fs.existsSync(attrsPath)) return false;
    const attrs = fs.readFileSync(attrsPath, 'utf8');
    return /\bfilter\s*=\s*lfs\b/.test(attrs);
  } catch {
    return false;
  }
}

/**
 * Check whether a file on disk is a Git LFS pointer file.
 *
 * LFS pointers start with `version https://git-lfs.github.com/spec/v1`.
 * This is a fast header check; it does not read the whole file.
 */
function isLfsPointerFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(128);
    const bytesRead = fs.readSync(fd, buf, 0, 128, 0);
    if (bytesRead === 0) return false;
    const header = buf.toString('utf8', 0, bytesRead);
    return header.startsWith(LFS_POINTER_HEADER);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function getGitToplevel(root) {
  const r = runGit(root, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0) return null;
  return path.normalize(r.stdout.trim());
}

function hasProjectMarker(dir) {
  return PROJECT_MARKERS.some((m) => {
    try {
      return fs.existsSync(path.join(dir, m));
    } catch {
      return false;
    }
  });
}

function findPackageDirs(dir, depth, found = []) {
  if (depth <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    if (hasProjectMarker(sub)) {
      found.push(sub);
    }
    findPackageDirs(sub, depth - 1, found);
  }
}

function hasMonorepoMarkers(root) {
  try {
    const pjPath = path.join(root, 'package.json');
    if (fs.existsSync(pjPath)) {
      const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
      if (pj.workspaces && Array.isArray(pj.workspaces) && pj.workspaces.length > 0) {
        return true;
      }
    }
  } catch {
    // ignore
  }

  // Look for project markers up to two directory levels deep (e.g. packages/*).
  // Two distinct sub-packages under the same repository root is a strong
  // monorepo signal; we conservatively degrade co-change quality in that case.
  const markerDirs = [];
  findPackageDirs(root, 2, markerDirs);
  return markerDirs.length >= 2;
}

function isMonorepoSubpackage(root) {
  const toplevel = getGitToplevel(root);
  if (!toplevel || path.normalize(root) === toplevel) return false;
  return hasMonorepoMarkers(toplevel);
}

/**
 * Analyze git-derived environmental degradations.
 *
 * @param {string} workspaceRoot
 * @returns {{
 *   isGitRepo: boolean,
 *   isShallow: boolean,
 *   isSparseCheckout: boolean,
 *   isInsideSubmodule: boolean,
 *   hasSubmodules: boolean,
 *   hasLfsPointers: boolean,
 *   isMonorepoSubpackage: boolean,
 *   causes: string[],
 *   dataQuality: string,
 *   remediation: string | null,
 * }}
 */
function analyzeGitEnvironment(workspaceRoot) {
  const env = {
    isGitRepo: isGitRepo(workspaceRoot),
    isShallow: false,
    isSparseCheckout: false,
    isInsideSubmodule: false,
    hasSubmodules: false,
    hasLfsPointers: false,
    isMonorepoSubpackage: false,
    causes: [],
    dataQuality: DATA_QUALITY.CERTAIN,
    remediation: null,
  };

  if (!env.isGitRepo) {
    env.dataQuality = DATA_QUALITY.UNAVAILABLE;
    return env;
  }

  env.isShallow = isShallowClone(workspaceRoot);
  env.isSparseCheckout = isSparseCheckout(workspaceRoot);
  env.isInsideSubmodule = isInsideSubmodule(workspaceRoot);
  env.hasSubmodules = hasSubmodules(workspaceRoot);
  env.hasLfsPointers = hasLfsPointers(workspaceRoot);
  env.isMonorepoSubpackage = isMonorepoSubpackage(workspaceRoot);

  if (env.isShallow) env.causes.push(REMEDIATION.SHALLOW_CLONE);
  if (env.isSparseCheckout) env.causes.push(REMEDIATION.SPARSE_CHECKOUT);
  if (env.isInsideSubmodule || env.hasSubmodules) env.causes.push(REMEDIATION.SUBMODULE_BOUNDARY);
  if (env.hasLfsPointers) env.causes.push(REMEDIATION.LFS_POINTER);
  if (env.isMonorepoSubpackage) env.causes.push(REMEDIATION.MONOREPO_ROOT);

  if (env.causes.length > 0) {
    env.dataQuality = DATA_QUALITY.DEGRADED;
    env.remediation = env.causes.join(' ');
  }

  return env;
}

module.exports = {
  analyzeGitEnvironment,
  isGitRepo,
  isShallowClone,
  isSparseCheckout,
  isInsideSubmodule,
  hasSubmodules,
  hasLfsPointers,
  isLfsPointerFile,
  isMonorepoSubpackage,
};
