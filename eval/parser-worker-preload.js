// @semantic — Disposable cold-build worker experiment; never loaded by production.
'use strict';
const fs = require('node:fs');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { GraphBuilder } = require('../src/services/dep-graph/builder');
const { normalizePathKey } = require('../src/utils/path');
const { hashFileContent } = require('../src/services/cache');
if (!isMainThread) {
  const builder = new GraphBuilder({ root: workerData.root, cache: null, normalizeFilePath: normalizePathKey });
  parentPort.on('message', async ({ id, file, content }) => {
    try { parentPort.postMessage({ id, result: await builder.parseFileOnly(file, content) }); }
    catch (error) { parentPort.postMessage({ id, error: error.stack }); }
  });
} else {
  let nextId = 0;
  let nextWorker = 0;
  let pool;
  GraphBuilder.prototype.parseFileOnly = async function (file, contentOverride = null) {
    if (!pool) pool = Array.from({ length: 2 }, () => {
      const worker = new Worker(__filename, { workerData: { root: this.dg.root }, execArgv: [] });
      const pending = new Map();
      worker.on('message', ({ id, result, error }) => {
        const task = pending.get(id);
        pending.delete(id);
        if (error) task.reject(new Error(error)); else task.resolve(result);
        if (pending.size === 0) worker.unref();
      });
      worker.on('error', (error) => { for (const task of pending.values()) task.reject(error); pending.clear(); });
      worker.unref();
      return { worker, pending };
    });
    const bytes = contentOverride === null ? await fs.promises.readFile(file) : Buffer.from(contentOverride);
    const hash = hashFileContent(bytes);
    const item = pool[nextWorker++ % pool.length];
    const id = nextId++;
    const result = await new Promise((resolve, reject) => {
      item.pending.set(id, { resolve, reject });
      item.worker.ref();
      item.worker.postMessage({ id, file, content: bytes.toString('utf8') });
    });
    this._parseCache.set(result.graphKey, { hash, result });
    if (this.dg.cache) this.dg.cache.setParseResult(file, structuredClone(this._toParseRecord(result, hash)));
    return result;
  };
}
