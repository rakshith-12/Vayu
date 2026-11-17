/**
 * @file mock-vscode.js
 * @description Lightweight mock for the `vscode` module to support running tests in standalone Node.js.
 */

const fs = require('fs');

class EventEmitter {
  constructor() {
    this.listeners = [];
  }
  get event() {
    return (listener) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const idx = this.listeners.indexOf(listener);
          if (idx !== -1) this.listeners.splice(idx, 1);
        },
      };
    };
  }
  fire(data) {
    for (const listener of [...this.listeners]) {
      try {
        listener(data);
      } catch (err) {
        console.error('EventEmitter listener error:', err);
      }
    }
  }
  dispose() {
    this.listeners = [];
  }
}

const Uri = {
  file: (filePath) => ({
    fsPath: filePath,
    path: filePath,
    scheme: 'file',
    toString: () => `file://${filePath}`,
  }),
  parse: (uriString) => {
    const parts = uriString.split(':');
    return {
      scheme: parts[0],
      path: parts[1] || '',
      fsPath: parts[1] || '',
      toString: () => uriString,
    };
  },
};

const workspace = {
  workspaceFolders: [],
  textDocuments: [],
  fs: {
    readFile: async (uri) => fs.promises.readFile(uri.fsPath),
    writeFile: async (uri, data) => fs.promises.writeFile(uri.fsPath, data),
    delete: async (uri) => fs.promises.rm(uri.fsPath, { force: true, recursive: true }),
  },
  openTextDocument: async (uri) => {
    const text = fs.readFileSync(uri.fsPath, 'utf8');
    const lines = text.split(/\r?\n/);
    return {
      uri,
      lineCount: lines.length,
      getText: () => text,
      lineAt: (line) => ({
        range: {
          end: { character: (lines[line] || '').length },
        },
      }),
      offsetAt: (position) => {
        let offset = 0;
        for (let i = 0; i < position.line && i < lines.length; i++) {
          offset += lines[i].length + 1;
        }
        return offset + (position.character || 0);
      },
      positionAt: (offset) => {
        let cur = 0;
        for (let i = 0; i < lines.length; i++) {
          const next = cur + lines[i].length + 1;
          if (offset < next) {
            return new Position(i, offset - cur);
          }
          cur = next;
        }
        return new Position(lines.length - 1, (lines[lines.length - 1] || '').length);
      },
      save: async () => {},
    };
  },
  applyEdit: async () => true,
  asRelativePath: (uri) => (typeof uri === 'string' ? uri : uri.fsPath),
};

const languages = {
  getDiagnostics: () => [],
};

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

const window = {
  activeTextEditor: undefined,
  showTextDocument: async () => {},
  showErrorMessage: () => {},
  showInformationMessage: () => {},
  showWarningMessage: () => {},
};

const commands = {
  executeCommand: async () => undefined,
  registerCommand: () => ({ dispose: () => {} }),
};

class WorkspaceEdit {
  constructor() {
    this.edits = [];
  }
  replace(uri, range, text) {
    this.edits.push({ uri, range, text });
  }
  createFile(uri) {
    this.edits.push({ type: 'create', uri });
  }
  deleteFile(uri) {
    this.edits.push({ type: 'delete', uri });
  }
  insert(uri, pos, text) {
    this.edits.push({ type: 'insert', uri, pos, text });
  }
}

class Range {
  constructor(startLine, startChar, endLine, endChar) {
    this.start = { line: startLine, character: startChar };
    this.end = { line: endLine, character: endChar };
  }
}

class Position {
  constructor(line, char) {
    this.line = line;
    this.character = char;
  }
}

module.exports = {
  EventEmitter,
  Uri,
  workspace,
  languages,
  DiagnosticSeverity,
  window,
  commands,
  WorkspaceEdit,
  Range,
  Position,
};
