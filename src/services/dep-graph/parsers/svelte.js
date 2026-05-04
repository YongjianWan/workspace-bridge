const { parseJavaScript } = require('./js');

const SCRIPT_REGEX = /<script[^>]*>([\s\S]*?)<\/script>/gi;

function parseSvelte(content, filePath = '') {
  const scripts = [];
  let match;
  while ((match = SCRIPT_REGEX.exec(content)) !== null) {
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

  const mergedScript = scripts.join('\n');
  return parseJavaScript(mergedScript, filePath);
}

module.exports = { parseSvelte };
