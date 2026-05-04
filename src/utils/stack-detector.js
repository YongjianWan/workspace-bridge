/**
 * Stack Detector — Detect project tech stack and generate concrete commands.
 *
 * This file is a thin barrel: detection logic lives in ./stack-detectors/detect.js
 * and command generation lives in ./stack-detectors/commands.js.
 */
const detect = require('./stack-detectors/detect');
const commands = require('./stack-detectors/commands');

module.exports = {
  ...detect,
  ...commands,
};
