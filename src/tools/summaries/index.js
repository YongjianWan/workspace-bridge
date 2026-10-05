/**
 * Builders that turn analysis results into the summaries, risk ratings and validation advice
 * the audit tools return. They are tool-layer logic; the CLI formatters render what they build.
 */
const { buildCompositeRisk } = require('./composite-risk');
const { buildRepoSummary } = require('./repo-summary');
const { buildFileSummary } = require('./file-summary');
const { buildAuditDiffSummary, classifyChangeType, getValidationTemplate, compactChangedFile } = require('./audit-diff-summary');
const { buildValidationAdvice, buildFileValidationAdvice } = require('./validation-advice');
const { buildImpactExplanations } = require('./impact-explanations');

module.exports = {
  buildCompositeRisk,
  buildRepoSummary,
  buildFileSummary,
  buildAuditDiffSummary,
  classifyChangeType,
  getValidationTemplate,
  compactChangedFile,
  buildValidationAdvice,
  buildFileValidationAdvice,
  buildImpactExplanations,
};
