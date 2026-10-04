// @semantic — Whole-process resource sampling for the disposable worker spike.
'use strict';
const fs = require('node:fs');
let peakRss = process.memoryUsage().rss;
const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 200);
timer.unref();
process.on('exit', () => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const usage = process.resourceUsage();
  fs.writeFileSync(process.env.WB_SPIKE_RESOURCE_FILE, JSON.stringify({ peakRssBytes: peakRss, userMs: usage.userCPUTime / 1000, systemMs: usage.systemCPUTime / 1000, samplingIntervalMs: 200 }));
});
