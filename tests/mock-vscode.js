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
        text: lines[line] || '',
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
  applyEdit: async (edit) => {
    if (edit && edit.edits) {
      for (const e of edit.edits) {
        if (e.range && e.uri && fs.existsSync(e.uri.fsPath)) {
          const content = fs.readFileSync(e.uri.fsPath, 'utf8');
          const isCRLF = content.includes('\r\n');
          const eol = isCRLF ? '\r\n' : '\n';
          const lines = content.split(/\r?\n/);

          const startLine = e.range.start.line;
          const startChar = e.range.start.character;
          const endLine = e.range.end.line;
          const endChar = e.range.end.character;

          const before = (lines[startLine] || '').substring(0, startChar);
          const after = (lines[endLine] || '').substring(endChar);
          const replacementLines = e.text.split(/\r?\n/);

          if (replacementLines.length === 1) {
            lines.splice(startLine, endLine - startLine + 1, before + replacementLines[0] + after);
          } else {
            const first = before + replacementLines[0];
            const middle = replacementLines.slice(1, -1);
            const last = replacementLines[replacementLines.length - 1] + after;
            lines.splice(startLine, endLine - startLine + 1, first, ...middle, last);
          }
          fs.writeFileSync(e.uri.fsPath, lines.join(eol), 'utf8');
        }
      }
    }
    return true;
  },
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
  constructor(startLineOrPos, startCharOrPos, endLine, endChar) {
    if (typeof startLineOrPos === 'object' && startLineOrPos !== null) {
      this.start = startLineOrPos;
      this.end = startCharOrPos;
    } else {
      this.start = new Position(startLineOrPos, startCharOrPos);
      this.end = new Position(endLine, endChar);
    }
  }
}

class Position {
  constructor(line, char) {
    this.line = line;
    this.character = char;
  }
}

const EndOfLine = {
  LF: 1,
  CRLF: 2,
};

module.exports = {
  EventEmitter,
  Uri,
  workspace,
  languages,
  DiagnosticSeverity,
  EndOfLine,
  window,
  commands,
  WorkspaceEdit,
  Range,
  Position,
};
