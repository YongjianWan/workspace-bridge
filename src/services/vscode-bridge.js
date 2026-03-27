/**
 * VS Code Bridge - Sync editor state
 * Communicates with VS Code extension via file-based IPC
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

class VSCodeBridge {
  constructor() {
    this.stateFile = path.join(os.tmpdir(), 'workspace-bridge-vscode-state.json');
    this.lastState = null;
    this.lastMtime = 0;
    this.onStateChange = null;
    this.checkInterval = null;
  }

  start() {
    // Poll for state changes (VS Code extension writes to file)
    this.checkInterval = setInterval(() => this.checkState(), 500);
  }

  checkState() {
    try {
      const stat = fs.statSync(this.stateFile);
      if (stat.mtimeMs > this.lastMtime) {
        this.lastMtime = stat.mtimeMs;
        const content = fs.readFileSync(this.stateFile, 'utf8');
        const state = JSON.parse(content);
        
        if (JSON.stringify(state) !== JSON.stringify(this.lastState)) {
          this.lastState = state;
          if (this.onStateChange) {
            this.onStateChange(state);
          }
        }
      }
    } catch (e) {
      // File doesn't exist or is being written
    }
  }

  getCurrentState() {
    return this.lastState;
  }

  getActiveFile() {
    return this.lastState?.activeEditor?.fileName;
  }

  getCursorPosition() {
    return this.lastState?.activeEditor?.selection?.active;
  }

  getSelectedText() {
    return this.lastState?.activeEditor?.selectedText;
  }

  getVisibleRange() {
    return this.lastState?.activeEditor?.visibleRanges?.[0];
  }

  getOpenFiles() {
    return this.lastState?.visibleEditors?.map(e => e.fileName) || [];
  }

  getProblems() {
    // VS Code diagnostics
    return this.lastState?.diagnostics || [];
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// Static method to write state from VS Code extension
VSCodeBridge.writeState = (state) => {
  const stateFile = path.join(os.tmpdir(), 'workspace-bridge-vscode-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
};

module.exports = { VSCodeBridge };
