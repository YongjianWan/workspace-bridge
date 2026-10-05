/**
 * api-contracts command handler.
 *
 * Cross-workspace endpoint alignment: scan a frontend and a backend,
 * report matched/unmatched HTTP contracts.
 */

const { runApiContracts } = require('../../tools/api-contract-tools');
const { failure } = require('../../utils/failure');

async function apiContracts(parsed, _container) {
  // This command owns its container lifecycle because it needs two workspaces.
  // The parent CLI-provided container (if any) is ignored.
  if (!parsed.frontend) {
    return failure('validation_error', 'Missing required --frontend <dir>', { hasFindings: false });
  }
  if (!parsed.backend) {
    return failure('validation_error', 'Missing required --backend <dir>', { hasFindings: false });
  }

  return runApiContracts({
    cwd: parsed.cwd,
    frontend: parsed.frontend,
    backend: parsed.backend,
    maxFiles: parsed.maxFiles,
    compact: parsed.compact,
    // Do not reuse the parent CLI's cacheDir (which is keyed to parsed.cwd).
    // Each side gets its own default cache under its workspaceRoot.
  });
}

module.exports = apiContracts;
