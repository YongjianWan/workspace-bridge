const { parseJavaScript } = require('./js');

function parseVue(content, filePath = '') {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
  const scripts = [];
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    scripts.push(match[1]);
  }
  if (scripts.length === 0) {
    return {
      imports: [],
      exports: [],
      importRecords: [],
      exportRecords: [],
      functionRecords: [],
      parseMode: 'regex',
    };
  }
  return parseJavaScript(scripts.join('\n'), filePath);
}

module.exports = { parseVue };
