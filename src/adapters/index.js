/**
 * Adapter registry — discover and run available external security/analysis tools.
 */
const { SemgrepAdapter } = require('./semgrep');

const ADAPTERS = [
  new SemgrepAdapter(),
];

async function getAvailableAdapters(cwd) {
  const results = await Promise.all(
    ADAPTERS.map(async (adapter) => ({ adapter, available: await adapter.isAvailable(cwd) }))
  );
  return results.filter((r) => r.available).map((r) => r.adapter);
}

function getAllAdapters() {
  return ADAPTERS.slice();
}

module.exports = { getAvailableAdapters, getAllAdapters, ADAPTERS };
