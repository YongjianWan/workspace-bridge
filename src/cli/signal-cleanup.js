/**
 * SIGINT/SIGTERM during a one-shot CLI run: shut the container down (cache save, DB close)
 * before exiting, so an interrupted run leaves no half-written state behind.
 */
const os = require('os');

const SIGNALS = ['SIGINT', 'SIGTERM'];
const EXIT_CODE_SIGNAL_BASE = 128; // shell convention: 128 + signal number

/**
 * @param {{ getContainer: () => ({ shutdown: () => Promise<void> } | null), exit?: (code: number) => void }} deps
 * @returns {() => void} removes the handlers
 */
function installSignalCleanup({ getContainer, exit = process.exit }) {
  let handling = false;
  const handlers = SIGNALS.map((signal) => {
    const handler = async () => {
      if (handling) return;
      handling = true;
      try {
        await getContainer()?.shutdown();
      } catch (err) {
        console.error('Shutdown error:', err.message);
      }
      exit(EXIT_CODE_SIGNAL_BASE + os.constants.signals[signal]);
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

module.exports = { installSignalCleanup };
