function buildAsciiTree(rootFiles, impactItems) {
  const childrenMap = new Map();

  for (const root of rootFiles) {
    childrenMap.set(root, []);
  }

  for (const item of impactItems) {
    const parent = item.via && item.via.length > 0 ? item.via[item.via.length - 1] : null;
    if (parent) {
      if (!childrenMap.has(parent)) {
        childrenMap.set(parent, []);
      }
      childrenMap.get(parent).push(item.file);
    }
  }

  for (const [parent, list] of childrenMap.entries()) {
    childrenMap.set(parent, [...new Set(list)].sort());
  }

  const lines = [];

  function walk(node, prefix = '') {
    const children = childrenMap.get(node) || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isLast = i === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${child}`);

      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      walk(child, nextPrefix);
    }
  }

  for (const root of rootFiles) {
    lines.push(`Target: ${root}`);
    walk(root);
  }

  return lines.join('\n');
}

function buildMermaidGraph(rootFiles, impactItems) {
  const allNodes = new Set([...rootFiles]);
  const edges = [];

  for (const item of impactItems) {
    allNodes.add(item.file);
    const parent = item.via && item.via.length > 0 ? item.via[item.via.length - 1] : null;
    if (parent) {
      allNodes.add(parent);
      edges.push({ from: parent, to: item.file });
    }
  }

  const nodesArr = [...allNodes].sort();
  const idMap = new Map();
  nodesArr.forEach((node, idx) => {
    idMap.set(node, `n${idx}`);
  });

  const lines = ['graph TD'];

  for (const node of nodesArr) {
    const isRoot = rootFiles.includes(node);
    const label = node.replace(/\\/g, '/');
    const id = idMap.get(node);
    if (isRoot) {
      lines.push(`  ${id}["📢 ${label}"]`);
    } else {
      lines.push(`  ${id}["${label}"]`);
    }
  }

  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (const edge of edges) {
    const fromId = idMap.get(edge.from);
    const toId = idMap.get(edge.to);
    lines.push(`  ${fromId} --> ${toId}`);
  }

  return '```mermaid\n' + lines.join('\n') + '\n```';
}

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

  if (r.impactItems && r.impactItems.length > 0) {
    lines.push('', 'Dependency Blast Radius Tree:', buildAsciiTree(r.files, r.impactItems));
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

  if (r.impactItems && r.impactItems.length > 0) {
    lines.push(
      `### Dependency Blast Radius Map`,
      ``,
      buildMermaidGraph(r.files, r.impactItems),
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
