import { runFullAnalysis } from 'file:///C:/Users/Len/AppData/Roaming/npm/node_modules/gitnexus/dist/core/run-analyze.js';
import fs from 'fs';
import path from 'path';

// Monkey-patch the lbug-adapter to log before the crash
const lbugAdapterPath = 'file:///C:/Users/Len/AppData/Roaming/npm/node_modules/gitnexus/dist/core/lbug/lbug-adapter.js';
const lbugAdapter = await import(lbugAdapterPath);
const origLoadGraph = lbugAdapter.loadGraphToLbug;

console.log('Starting analysis...');
const result = await runFullAnalysis(process.cwd(), {
  force: true,
  skipAgentsMd: true,
  noStats: true,
}, {
  onProgress: (phase, pct, msg) => {
    console.log(`[${pct}%] ${msg}`);
  },
  onLog: (...args) => console.log('  LOG:', ...args),
});
console.log('Done!', JSON.stringify(result.stats));
process.exit(0);
