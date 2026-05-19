const { auditSecurity, groupBySeverity } = require('../../tools/security-tools');
const { severityMeetsFilter } = require('./_utils');

async function auditSecurityCmd(parsed, container) {
  const explicitSecFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;
  const secResult = await auditSecurity({
    cwd: parsed.cwd,
    targets: explicitSecFiles || parsed.targets,
    config: parsed.config,
    language: parsed.language,
    builtinOnly: parsed.builtinOnly,
  }, container);
  if (parsed.severity && secResult.findings) {
    secResult.findings = secResult.findings.filter((f) => severityMeetsFilter(f.severity, parsed.severity));
    secResult.summary.total = secResult.findings.length;
    secResult.summary.bySeverity = groupBySeverity(secResult.findings);
  }
  return secResult;
}

module.exports = auditSecurityCmd;
