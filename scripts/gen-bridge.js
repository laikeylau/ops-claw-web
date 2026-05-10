const fs = require('fs');
const content = fs.readFileSync('src/server/web-bridge.js', 'utf-8');
const output = 'export const WEB_BRIDGE_SCRIPT = `' + content + '`;\n';
fs.writeFileSync('src/server/bridge-content.ts', output, 'utf-8');
console.log('Generated bridge-content.ts, size:', output.length);
