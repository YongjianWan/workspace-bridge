/**
 * JSON output streaming thresholds to avoid blocking the event loop on huge strings.
 */
const STREAMING = {
  LARGE_JSON_THRESHOLD_BYTES: 1024 * 1024,
  JSON_WRITE_CHUNK_SIZE_BYTES: 64 * 1024,
};

module.exports = STREAMING;
