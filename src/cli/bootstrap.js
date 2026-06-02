/**
 * Process-level bootstrap for the workspace-bridge CLI.
 * Sets UV thread-pool size and installs fatal-error handlers.
 * Must be required before any async fs operation is initiated.
 */

// Increase libuv thread pool for concurrent file I/O (default 4 is a bottleneck
// on Windows+Defender where stat() can take 50-100ms per file). Must be set
// before any async fs operation is initiated.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

function installFatalHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('Fatal: Unhandled promise rejection');
    if (reason instanceof Error) {
      console.error(reason.message || String(reason));
      if (reason.stack) console.error(reason.stack);
    } else {
      console.error(String(reason));
    }
    process.exit(2);
  });

  process.on('uncaughtException', (err) => {
    console.error('Fatal: Uncaught exception');
    console.error(err.message || String(err));
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
}

module.exports = {
  installFatalHandlers,
};
