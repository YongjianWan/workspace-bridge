/**
 * Async utilities — shared concurrency helpers.
 */

async function mapWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(1, Number.isFinite(limit) ? limit : 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (err) {
        results[currentIndex] = {
          __error: err?.message || String(err),
          __item: items[currentIndex],
        };
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(safeLimit, items.length);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

module.exports = {
  mapWithConcurrency,
};
