/**
 * WalCadence
 * Coordinates SQLite WAL checkpoints (PASSIVE vs TRUNCATE) to throttle disk writes
 * during rapid incremental watch/repl updates.
 */
class WalCadence {
  constructor() {
    this.lastTruncate = null;
    this.batchesSinceTruncate = 0;
  }

  /**
   * Evaluates the next checkpoint strategy based on timing and update frequency.
   * @returns {'TRUNCATE'|'PASSIVE'}
   */
  tick() {
    this.batchesSinceTruncate++;
    const now = Date.now();
    
    // First run or threshold exceeded
    if (this.lastTruncate === null) {
      this.lastTruncate = now;
      this.batchesSinceTruncate = 0;
      return 'TRUNCATE';
    }

    const elapsed = now - this.lastTruncate;
    if (elapsed >= 60000 || this.batchesSinceTruncate >= 32) {
      this.lastTruncate = now;
      this.batchesSinceTruncate = 0;
      return 'TRUNCATE';
    }

    return 'PASSIVE';
  }
}

module.exports = { WalCadence };
