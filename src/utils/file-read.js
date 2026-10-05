const fs = require('fs');

/**
 * Read a text file through one open handle. A separate stat before the read costs a second path
 * lookup, which is the slow part of a small read on Windows.
 * @param {string} filePath
 * @param {number} [maxBytes] larger files are not read
 * @returns {string|null} null when the file is larger than maxBytes; read errors throw
 */
function readTextWithin(filePath, maxBytes = Infinity) {
  const fd = fs.openSync(filePath, 'r');
  try {
    if (fs.fstatSync(fd).size > maxBytes) return null;
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readTextWithin };
