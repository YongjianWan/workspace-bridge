/**
 * EditorState - Read VS Code state from state.vscdb (SQLite)
 * 
 * VS Code stores editor state in:
 * - Windows: %APPDATA%/Code/User/workspaceStorage/<hash>/state.vscdb
 * - macOS: ~/Library/Application Support/Code/User/workspaceStorage/<hash>/state.vscdb
 * - Linux: ~/.config/Code/User/workspaceStorage/<hash>/state.vscdb
 * 
 * The hash is derived from workspace folder URL.
 * We match by comparing folder paths in workspace.json
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get VS Code workspace storage directory based on platform
 */
function getVSCodeStorageDir() {
  const platform = process.platform;
  const home = os.homedir();
  
  switch (platform) {
    case 'win32':
      return path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage');
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
    case 'linux':
    default:
      // Also try the Insiders edition path as fallback
      const standardPath = path.join(home, '.config', 'Code', 'User', 'workspaceStorage');
      const insidersPath = path.join(home, '.config', 'Code - Insiders', 'User', 'workspaceStorage');
      
      // Return the one that exists, or standard path as default
      try {
        if (fs.existsSync(insidersPath)) return insidersPath;
      } catch (e) {}
      return standardPath;
  }
}

/**
 * Get Cursor editor storage directory (fork of VS Code)
 */
function getCursorStorageDir() {
  const platform = process.platform;
  const home = os.homedir();
  
  switch (platform) {
    case 'win32':
      return path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage');
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
    case 'linux':
    default:
      return path.join(home, '.config', 'Cursor', 'User', 'workspaceStorage');
  }
}

class EditorState {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = workspaceRoot;
    this.editor = options.editor || 'auto'; // 'vscode', 'cursor', 'auto'
    this.statePath = this.findStatePath();
    this.lastMtime = 0;
    this.cache = null;
  }

  /**
   * Find state.vscdb for current workspace
   */
  findStatePath() {
    const editors = this.editor === 'auto' 
      ? ['vscode', 'cursor']
      : [this.editor];
    
    for (const editor of editors) {
      const storageDir = editor === 'cursor' 
        ? getCursorStorageDir() 
        : getVSCodeStorageDir();
      
      const statePath = this.findStatePathInDir(storageDir);
      if (statePath) {
        console.error(`[EditorState] Found ${editor} state DB: ${statePath}`);
        return statePath;
      }
    }
    
    console.error('[EditorState] No matching state DB found for any editor');
    return null;
  }

  /**
   * Search for state DB in given directory
   */
  findStatePathInDir(storageDir) {
    try {
      if (!fs.existsSync(storageDir)) {
        return null;
      }

      const entries = fs.readdirSync(storageDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const workspaceJsonPath = path.join(storageDir, entry.name, 'workspace.json');
        const stateDbPath = path.join(storageDir, entry.name, 'state.vscdb');
        
        if (!fs.existsSync(workspaceJsonPath) || !fs.existsSync(stateDbPath)) {
          continue;
        }

        // Check if this workspace matches our root
        try {
          const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
          const folderUri = workspaceJson.folder;
          
          if (folderUri && this.pathsMatch(folderUri, this.workspaceRoot)) {
            return stateDbPath;
          }
        } catch (e) {
          // Invalid JSON, skip
          console.error(`[EditorState] Invalid workspace.json in ${entry.name}: ${e.message}`);
        }
      }
      
      return null;
    } catch (e) {
      console.error(`[EditorState] Error searching in ${storageDir}: ${e.message}`);
      return null;
    }
  }

  /**
   * Normalize file URI to path for comparison
   */
  uriToPath(uri) {
    if (!uri) return null;

    // Handle file:// protocol
    let normalized = uri;
    if (uri.startsWith('file://')) {
      normalized = decodeURIComponent(uri.slice(7)); // Remove file:// and decode %3A etc.

      // Windows: file:///C:/path -> C:/path
      if (process.platform === 'win32' && normalized.startsWith('/')) {
        normalized = normalized.slice(1);
      }
    }

    // Normalize path separators
    return normalized.replace(/\//g, path.sep);
  }

  pathsMatch(uriPath, workspaceRoot) {
    try {
      const normalizedUri = this.uriToPath(uriPath);
      if (!normalizedUri) return false;
      
      // Resolve both paths to absolute
      const resolvedUri = path.resolve(normalizedUri);
      const resolvedWorkspace = path.resolve(workspaceRoot);
      
      // Case-insensitive comparison on Windows/macOS
      const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
      
      if (isCaseInsensitive) {
        return resolvedUri.toLowerCase() === resolvedWorkspace.toLowerCase();
      }
      return resolvedUri === resolvedWorkspace;
    } catch (e) {
      console.error(`[EditorState] Path comparison error: ${e.message}`);
      return false;
    }
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
      const state = await this.readSQLite();
      
      this.lastMtime = stat.mtimeMs;
      this.cache = state;
      
      return state;
    } catch (e) {
      console.error(`[EditorState] Read failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Read SQLite DB using better-sqlite3
   */
  async readSQLite() {
    let Database;
    try {
      Database = require('better-sqlite3');
    } catch (e) {
      console.error('[EditorState] better-sqlite3 not available, cannot read state.vscdb');
      return null;
    }

    let db;
    try {
      db = new Database(this.statePath, { readonly: true });

      const rows = db.prepare(
        'SELECT key, value FROM ItemTable WHERE key IN (?, ?)'
      ).all('memento/workbench.parts.editor', 'history.entries');

      const data = {};
      for (const row of rows) {
        try { data[row.key] = JSON.parse(row.value); } catch (e) { /* skip */ }
      }

      return this.extractEditorState(data);
    } catch (e) {
      console.error(`[EditorState] SQLite read failed: ${e.message}`);
      return null;
    } finally {
      try { db?.close(); } catch (e) { /* ignore */ }
    }
  }

  extractEditorState(data) {
    const state = {
      activeEditor: null,
      openEditors: [],
      recentFiles: [],
    };

    // Extract open editors from serialized editor grid
    // Structure: editorpart.state.serializedGrid.root (tree of branch/leaf nodes)
    const editorPart = data['memento/workbench.parts.editor'];
    if (editorPart?.['editorpart.state']) {
      const grid = editorPart['editorpart.state'].serializedGrid?.root;

      // Walk tree, collect all file editors from leaf nodes
      const collectEditors = (node) => {
        if (!node) return [];
        if (node.type === 'leaf') return node.data?.editors || [];
        return (node.data || []).flatMap(child => collectEditors(child));
      };

      for (const editor of collectEditors(grid)) {
        if (editor.id !== 'workbench.editors.files.fileEditorInput') continue;
        try {
          const val = JSON.parse(editor.value); // value is a double-encoded JSON string
          // Prefer fsPath (plain Windows path) over URI-encoded external
          const filePath = val.resourceJSON?.fsPath
            ? path.normalize(val.resourceJSON.fsPath)
            : this.uriToPath(val.resourceJSON?.external);
          if (filePath) state.openEditors.push({ file: filePath });
        } catch (e) { /* skip malformed entry */ }
      }
    }

    // Extract recent files from history entries
    const historyEntries = data['history.entries'];
    if (Array.isArray(historyEntries)) {
      state.recentFiles = historyEntries
        .map(e => this.uriToPath(e?.editor?.resource))
        .filter(Boolean);
    }

    // Active editor: first in open list (VS Code doesn't store active separately in ItemTable)
    if (state.openEditors.length > 0) {
      state.activeEditor = state.openEditors[0];
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
    return state?.openEditors?.map(e => e.file).filter(Boolean) || [];
  }
  
  /**
   * Get editor info for status/debugging
   */
  getInfo() {
    return {
      workspaceRoot: this.workspaceRoot,
      editor: this.editor,
      statePath: this.statePath,
      platform: process.platform,
      storageDirs: {
        vscode: getVSCodeStorageDir(),
        cursor: getCursorStorageDir(),
      },
    };
  }
}

module.exports = {
  EditorState,
  getVSCodeStorageDir,
  getCursorStorageDir,
};
