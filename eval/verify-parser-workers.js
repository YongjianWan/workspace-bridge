// @semantic — Isolated parser spike; this does not benchmark the complete CLI.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const v8 = require('node:v8');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const { GraphBuilder } = require('../src/services/dep-graph/builder');
const { normalizePathKey } = require('../src/utils/path');

const root = path.join(__dirname, 'truth', 'parser-inputs');
function content(index) {
  return Array.from({ length: 40 }, (_, i) => `export function function_${i}(x) { return x + ${index + i}; }`).join('\n');
}
function builder() {
  return new GraphBuilder({ root, cache: null, normalizeFilePath: normalizePathKey });
}
function hash(records) {
  return crypto.createHash('sha256').update(JSON.stringify(records.sort((a, b) =>
    a.filePath.localeCompare(b.filePath)))).digest('hex');
}
async function parseIndices(indices) {
  const instance = builder();
  const records = [];
  let maxHeap = 0;
  for (const index of indices) {
    records.push(await instance.parseFileOnly(path.join(root, `file-${index}.js`), content(index)));
    if (index % 100 === 0) maxHeap = Math.max(maxHeap, process.memoryUsage().heapUsed);
  }
  return { records, maxHeap: Math.max(maxHeap, process.memoryUsage().heapUsed) };
}

if (!isMainThread) {
  parseIndices(workerData).then((result) => parentPort.postMessage(result))
    .catch((error) => { throw error; });
} else {
  (async () => {
    const phaseStart = performance.now();
    const phase = await parseIndices(Array.from({ length: 10001 }, (_, i) => i));
    const phaseReport = { files: phase.records.length,
      functionRecords: phase.records.reduce((sum, item) => sum + item.functionRecords.length, 0),
      ms: Math.round(performance.now() - phaseStart), heapLimitMiB: Math.round(v8.getHeapStatistics().heap_size_limit / 1048576),
      maxHeapMiB: Math.round(phase.maxHeap / 1048576), rssMiB: Math.round(process.memoryUsage().rss / 1048576),
      modes: [...new Set(phase.records.map((item) => item.parseMode))] };
    phase.records.length = 0;
    if (global.gc) global.gc();
    const indices = Array.from({ length: 1500 }, (_, i) => i);
    const serialStart = performance.now();
    const serial = await parseIndices(indices);
    const serialMs = Math.round(performance.now() - serialStart);
    const expectedHash = hash(serial.records);
    serial.records.length = 0;
    if (global.gc) global.gc();
    const workerStart = performance.now();
    const chunks = [indices.filter((i) => i % 2 === 0), indices.filter((i) => i % 2 === 1)];
    const results = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { workerData: chunk });
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', (code) => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
    })));
    const parallelMs = Math.round(performance.now() - workerStart);
    const actualHash = hash(results.flatMap((item) => item.records));
    const report = { phase1: phaseReport, workers: { files: indices.length, workers: 2, serialMs,
      parallelMs, speedup: serialMs / parallelMs, recordsEqual: expectedHash === actualHash },
      scope: 'JS parser only, content supplied in memory, no resolve/analysis/index/SQLite; wall times are a single sample.' };
    fs.writeFileSync(path.join(__dirname, 'truth', 'parser-workers.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
