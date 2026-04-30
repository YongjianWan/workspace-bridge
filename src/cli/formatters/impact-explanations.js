function buildImpactExplanations(entry) {
  const explanations = [];
  if (!entry?.impact?.length) return explanations;

  const changedFile = entry.file;

  for (const imp of entry.impact) {
    if (imp.level === 1 && imp.importedSymbols?.length > 0) {
      const symbols = imp.importedSymbols.join(', ');
      explanations.push(`因 \`${changedFile}\` 被 \`${imp.file}\` import（${symbols}），故波及该文件`);
    } else if (imp.level > 1 && imp.via?.length >= 2) {
      const directImporter = imp.via[imp.via.length - 1];
      if (directImporter === changedFile) continue;
      const chain = imp.via.slice(1).concat(imp.file).join(' -> ');
      explanations.push(`因 \`${changedFile}\` 被 \`${directImporter}\` import，经 \`${chain}\` 传递，故波及测试`);
    }
  }

  return explanations;
}

module.exports = { buildImpactExplanations };
