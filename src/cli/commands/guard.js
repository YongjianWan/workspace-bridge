const fs = require('fs');
const path = require('path');
const { requireFile } = require('./_utils');
const { resolveWorkspaceFilePath, normalizePathKey } = require('../../utils/path');

async function guardCmd(parsed, container) {
  await container.ensureReady();

  const depGraph = container.snapshot?.graph || container.depGraph;
  if (!depGraph) {
    return { ok: false, error: 'Dependency graph not available', hasFindings: false };
  }

  let files = [];
  if (parsed.file) {
    files.push(parsed.file);
  } else if (parsed.files) {
    files.push(...parsed.files.split(',').map((f) => f.trim()).filter(Boolean));
  } else if (parsed.staged) {
    const gitTools = require('../../tools/git-tools');
    const changed = await gitTools.getChangedFiles(container.workspaceRoot, { staged: true });
    if (changed.ok === false) {
      return { ok: false, error: changed.error || 'Failed to get staged files', hasFindings: false };
    }
    files.push(...changed.changedFiles);
  } else {
    return { ok: false, error: 'Target file(s) must be specified via --file, --files, or --staged', hasFindings: false };
  }

  const maxDependentsLimit = parsed.maxDependents ?? 50;
  const maxTransitiveLimit = parsed.maxTransitive ?? 50;

  const resolvedFiles = [];
  const displayFiles = [];
  for (const file of files) {
    const resolved = resolveWorkspaceFilePath(file, container.workspaceRoot);
    if (resolved && fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
      resolvedFiles.push(resolved);
      displayFiles.push(depGraph._displayPath(resolved));
    }
  }

  if (resolvedFiles.length === 0) {
    return {
      ok: true,
      passed: true,
      files: [],
      limits: {
        maxDependents: maxDependentsLimit,
        maxTransitive: maxTransitiveLimit,
      },
      stats: {
        directDependentsCount: 0,
        transitiveDependentsCount: 0,
      },
      directDependents: [],
      transitiveDependents: [],
      exceeded: [],
      hasFindings: false,
    };
  }

  // Union of direct dependents
  const directSet = new Set();
  for (const resolvedFile of resolvedFiles) {
    const direct = depGraph.getDependents(resolvedFile);
    for (const d of direct) {
      directSet.add(depGraph._displayPath(d));
    }
  }
  const directDependents = [...directSet].sort();

  // Union of transitive dependents
  const transitiveSet = new Set();
  for (const resolvedFile of resolvedFiles) {
    const impact = depGraph.getImpactRadius(resolvedFile, parsed.maxDepth);
    for (const item of impact) {
      transitiveSet.add(item.file);
    }
  }
  const transitiveDependents = [...transitiveSet].sort();

  const exceeded = [];
  if (directDependents.length > maxDependentsLimit) {
    exceeded.push('direct');
  }
  if (transitiveDependents.length > maxTransitiveLimit) {
    exceeded.push('transitive');
  }

  const passed = exceeded.length === 0;

  return {
    ok: true,
    passed,
    files: displayFiles,
    limits: {
      maxDependents: maxDependentsLimit,
      maxTransitive: maxTransitiveLimit,
    },
    stats: {
      directDependentsCount: directDependents.length,
      transitiveDependentsCount: transitiveDependents.length,
    },
    directDependents,
    transitiveDependents,
    exceeded,
    hasFindings: !passed,
  };
}

module.exports = guardCmd;
