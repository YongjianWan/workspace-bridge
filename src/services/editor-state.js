/**
 * EditorState - Read VS Code state from state.vscdb (SQLite)
 * 
 * VS Code stores editor state in:
 * %APPDATA%/Code/User/workspaceStorage/<hash>/state.vscdb
 * 
 * The hash is derived from workspace folder URL.
 * We match by comparing folder paths in workspace.json
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// VS Code storage paths
const WORKSPACE_STORAGE_DIR = path.join(os.homedir(), 'AppData/Roaming/Code/User/workspaceStorage');

class EditorState {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.statePath = this.findStatePath();
    this.lastMtime = 0;
    this.cache = null;
  }

  /**
   * Find state.vscdb for current workspace
   */
  findStatePath() {
    try {
      if (!fs.existsSync(WORKSPACE_STORAGE_DIR)) {
        return null;
      }

      const entries = fs.readdirSync(WORKSPACE_STORAGE_DIR, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const workspaceJsonPath = path.join(WORKSPACE_STORAGE_DIR, entry.name, 'workspace.json');
        const stateDbPath = path.join(WORKSPACE_STORAGE_DIR, entry.name, 'state.vscdb');
        
        if (!fs.existsSync(workspaceJsonPath) || !fs.existsSync(stateDbPath)) {
          continue;
        }

        // Check if this workspace matches our root
        try {
          const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
          const folderUri = workspaceJson.folder?.replace('file:///', '').replace(/\//g, '\\');
          
          if (folderUri && this.pathsMatch(folderUri, this.workspaceRoot)) {
            console.error(`[EditorState] Found state DB: ${entry.name}`);
            return stateDbPath;
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      }
      
      console.error('[EditorState] No matching state DB found');
      return null;
    } catch (e) {
      console.error('[EditorState] Error finding state:', e.message);
      return null;
    }
  }

  pathsMatch(a, b) {
    // Normalize paths for comparison
    const normA = path.resolve(a).toLowerCase();
    const normB = path.resolve(b).toLowerCase();
    return normA === normB;
  }

  /**
   * Read current state
   */
  async read() {
    if (!this.statePath) {
      return null;
    }

    try {
      const stat = fs.statSync(this.statePath);
      
      // Use cache if not modified
      if (stat.mtimeMs === this.lastMtime && this.cache) {
        return this.cache;
      }

      // Try to read SQLite database
      // For now, we'll use a simplified approach since SQLite requires native deps
      // In production, you'd use better-sqlite3
      const state = await this.readSQLite();
      
      this.lastMtime = stat.mtimeMs;
      this.cache = state;
      
      return state;
    } catch (e) {
      console.error('[EditorState] Read failed:', e.message);
      return null;
    }
  }

  /**
   * Read SQLite DB (simplified JSON parsing approach)
   * state.vscdb is actually a JSON file with SQLite wrapper in newer VS Code versions
   */
  async readSQLite() {
    try {
      const content = fs.readFileSync(this.statePath, 'utf8');
      
      // Try direct JSON parse (VS Code sometimes stores as plain JSON)
      try {
        const json = JSON.parse(content);
        return this.extractEditorState(json);
      } catch (e) {
        // Not valid JSON, might be binary SQLite
      }

      // Fallback: return minimal state
      return {
        activeEditor: null,
        openEditors: [],
        recentFiles: [],
      };
    } catch (e) {
      console.error('[EditorState] SQLite read failed:', e.message);
      return null;
    }
  }

  extractEditorState(json) {
    // Extract relevant editor state from VS Code state
    const state = {
      activeEditor: null,
      openEditors: [],
      recentFiles: [],
    };

    // Try to extract from various VS Code state keys
    if (json['workbench.editor']) {
      const editor = json['workbench.editor'];
      if (editor.active) {
        state.activeEditor = {
          file: editor.active.resource,
          viewColumn: editor.active.viewColumn,
        };
      }
      if (editor.editors) {
        state.openEditors = editor.editors.map(e => ({
          file: e.resource,
          viewColumn: e.viewColumn,
        }));
      }
    }

    // Extract recent files from history
    if (json['workbench.history']) {
      state.recentFiles = json['workbench.history'].files || [];
    }

    return state;
  }

  /**
   * Get active file (best effort)
   */
  async getActiveFile() {
    const state = await this.read();
    return state?.activeEditor?.file || null;
  }

  /**
   * Get all open files
   */
  async getOpenFiles() {
    const state = await this.read();
    return state?.openEditors?.map(e => e.file) || [];
  }
}

module.exports = {
  EditorState,
  WORKSPACE_STORAGE_DIR,
};
