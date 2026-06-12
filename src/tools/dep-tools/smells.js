const path = require('path');

function checkSmells(args, container) {
  const graph = container.snapshot?.graph || container.depGraph;
  const workspaceRoot = container.workspaceRoot;

  if (!graph) {
    return { ok: false, error: 'Dependency graph not available' };
  }

  const files = graph.getAllFilePaths() || [];
  const findings = [];

  for (const file of files) {
    const info = graph.getFileInfo(file);
    if (!info || !info.functionRecords) continue;

    const relPath = path.relative(workspaceRoot, file).replace(/\\/g, '/');

    for (const func of info.functionRecords) {
      const fp = func.fingerprint;
      if (!fp) continue;

      const arms = fp.maxArms || 0;
      const cc = (fp.branchCount !== undefined ? fp.branchCount : 0) + 1;

      let matched = false;
      let reason = '';

      // Path 1 (Flat switch/if-else-if): arms >= 6 and cc <= arms + 5
      if (arms >= 6 && cc <= arms + 5) {
        matched = true;
        reason = `Flat dispatcher detected: arms = ${arms}, complexity = ${cc} (arms >= 6 and cc <= arms + 5)`;
      }
      // Path 2 (Dominant branch): arms >= 12 and arms >= cc * 0.4
      else if (arms >= 12 && arms >= cc * 0.4) {
        matched = true;
        reason = `Dominant branch dispatcher detected: arms = ${arms}, complexity = ${cc} (arms >= 12 and arms >= cc * 0.4)`;
      }

      if (matched) {
        findings.push({
          file: relPath,
          functionName: func.name,
          lineStart: func.lineStart,
          lineEnd: func.lineEnd,
          arms,
          complexity: cc,
          reason,
          category: 'smells',
        });
      }
    }
  }

  // Sort findings for stable output
  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.lineStart !== b.lineStart) return (a.lineStart || 0) - (b.lineStart || 0);
    return (a.functionName || '').localeCompare(b.functionName || '');
  });

  return {
    ok: true,
    smellsCount: findings.length,
    smells: findings
  };
}

module.exports = { checkSmells };
