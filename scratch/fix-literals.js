const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../src/tools/overview-tools.js');
let content = fs.readFileSync(targetPath, 'utf8');

content = content.replace(/slice\(0, 100\)/g, 'slice(0, SCORING.TOP_N_LIST)');
content = content.replace(/length < 200/g, 'length < DEFAULTS.SMALL_PROJECT_MAX_MAINLINE');
content = content.replace(/length > 100/g, 'length > SCORING.TOP_N_LIST');
content = content.replace(/limit: 100/g, 'limit: SCORING.TOP_N_LIST');

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Fixed literals in overview-tools.js');
