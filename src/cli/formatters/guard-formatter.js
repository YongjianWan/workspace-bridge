function formatGuardHuman(r) {
  if (!r.ok) {
    return `Guard Check Failed: ${r.error || 'Unknown error'}`;
  }
  const lines = [
    `Guard Status: ${r.passed ? 'PASSED' : 'BLOCKED'}`,
    `Files Checked: ${r.files.join(', ') || 'none'}`,
    `Direct Dependents: ${r.stats.directDependentsCount} (limit: ${r.limits.maxDependents})`,
    `Transitive Dependents: ${r.stats.transitiveDependentsCount} (limit: ${r.limits.maxTransitive})`,
  ];
  if (!r.passed) {
    lines.push(`Exceeded Limits: ${r.exceeded.join(', ')}`);
  }
  return lines.join('\n');
}

function formatGuardSummary(r) {
  return formatGuardHuman(r);
}

function formatGuardMarkdown(r) {
  if (!r.ok) {
    return `## Guard Check Failed\n\n${r.error || 'Unknown error'}`;
  }

  const lines = [
    `# Modification Guard: ${r.passed ? 'PASSED' : 'BLOCKED'}`,
    ``,
    `- **Files Checked**: ${r.files.map((f) => `\`${f}\``).join(', ') || 'none'}`,
    `- **Direct Dependents**: ${r.stats.directDependentsCount} / ${r.limits.maxDependents} ${r.exceeded.includes('direct') ? '**[EXCEEDED]**' : ''}`,
    `- **Transitive Dependents**: ${r.stats.transitiveDependentsCount} / ${r.limits.maxTransitive} ${r.exceeded.includes('transitive') ? '**[EXCEEDED]**' : ''}`,
    ``,
  ];

  if (!r.passed) {
    lines.push(
      `> [!WARNING]`,
      `> **Guard Blocked**: Blast radius exceeds safe limits. Review the dependents list before modifying.`,
      ``
    );
  } else {
    lines.push(
      `> [!NOTE]`,
      `> **Guard Passed**: Change blast radius is within configured safety limits.`,
      ``
    );
  }

  if (r.directDependents.length > 0) {
    lines.push(`### Direct Dependents`, ...r.directDependents.map((d) => `- \`${d}\``), '');
  }

  if (r.transitiveDependents.length > 0) {
    lines.push(`### Transitive Dependents`, ...r.transitiveDependents.map((t) => `- \`${t}\``), '');
  }

  return lines.join('\n').trim();
}

function formatGuardJsonl(r) {
  const recs = [
    JSON.stringify({
      _type: 'summary',
      ok: r.ok,
      command: 'guard',
      passed: r.passed,
      files: r.files,
      directDependentsCount: r.stats.directDependentsCount,
      transitiveDependentsCount: r.stats.transitiveDependentsCount,
      exceeded: r.exceeded,
    }),
  ];
  for (const d of r.directDependents) {
    recs.push(JSON.stringify({ _type: 'direct-dependent', file: d }));
  }
  for (const t of r.transitiveDependents) {
    recs.push(JSON.stringify({ _type: 'transitive-dependent', file: t }));
  }
  return recs.join('\n');
}

function formatGuardAi(r) {
  if (!r.ok) {
    return JSON.stringify({ ok: false, error: r.error || 'Guard check failed' });
  }

  if (!r.passed) {
    const exceededMsg = r.exceeded.includes('transitive')
      ? `has a transitive impact of ${r.stats.transitiveDependentsCount} files (limit: ${r.limits.maxTransitive})`
      : `has ${r.stats.directDependentsCount} direct dependents (limit: ${r.limits.maxDependents})`;

    return `[Guard Blocked] Modifying ${r.files.join(', ')} ${exceededMsg}. Review dependents before proceeding.`;
  }

  return `[Guard Passed] Modifying ${r.files.join(', ')} has ${r.stats.directDependentsCount} direct and ${r.stats.transitiveDependentsCount} transitive dependents, within limits.`;
}

module.exports = {
  formatGuardHuman,
  formatGuardSummary,
  formatGuardMarkdown,
  formatGuardJsonl,
  formatGuardAi,
};
