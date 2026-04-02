#!/usr/bin/env node

const { runCliWithFallback } = require('../src/utils/cli-fallback');

function main() {
  const args = process.argv.slice(2);
  const run = runCliWithFallback(args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  const status = Number.isInteger(run?.result?.status) ? run.result.status : 1;
  process.exit(status);
}

main();

