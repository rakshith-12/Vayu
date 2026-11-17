/**
 * @file server.ts
 * @description Embedded MCP HTTP / SSE server running inside the extension host.
 *              Listens on an ephemeral port, writes port configuration, and serves
 *              workspace tools to TrueForge sessions.
 */

import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerMcpTools, type ToolContext } from './tools';

export class McpServerManager {
  private httpServer: http.Server | null = null;
  private mcpServer: McpServer | null = null;
  private port: number = 0;
  private streamableTransport: StreamableHTTPServerTransport | null = null;

  constructor(
    private extensionContext: vscode.ExtensionContext,
    private toolContext: ToolContext,
  ) {}

  /**
   * Start the MCP server on an ephemeral port (127.0.0.1:0).
   * Writes the allocated port to `.vscode/trueforge-mcp.json`.
   */
  async start(): Promise<number> {
    this.mcpServer = new McpServer(
      {
        name: 'vscode-editor-mcp',
        version: '1.0.0',
      },
      {
        maxToolInputElements: 50000,
      },
    );

    // Register all workspace tools
    registerMcpTools(this.mcpServer, this.toolContext);

    // Stateless Streamable HTTP transport
    this.streamableTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await this.mcpServer.connect(this.streamableTransport);

    const sseTransports = new Map<string, SSEServerTransport>();

    this.httpServer = http.createServer(async (req, res) => {
      // Set 10-minute timeout for parked tool approvals
      req.setTimeout(600000);
      res.setTimeout(600000);

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const urlObj = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = urlObj.pathname;

      // 1. Streamable HTTP endpoint (/mcp)
      if (pathname === '/mcp' || pathname === '/') {
        if (this.streamableTransport) {
          try {
            await this.streamableTransport.handleRequest(req, res);
          } catch (err) {
            console.error('Error handling StreamableHTTP request:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: String(err) }));
            }
          }
        }
        return;
      }

      // 2. Legacy SSE transport fallback (/sse and /message)
      if (pathname === '/sse' && req.method === 'GET') {
        const sseTransport = new SSEServerTransport('/message', res);
        sseTransports.set(sseTransport.sessionId, sseTransport);
        await this.mcpServer?.connect(sseTransport);
        await sseTransport.start();
        return;
      }

      if (pathname === '/message' && req.method === 'POST') {
        const sessionId = urlObj.searchParams.get('sessionId') || '';
        const transport = sseTransports.get(sessionId);
        if (transport) {
          await transport.handlePostMessage(req, res);
        } else {
          res.writeHead(404);
          res.end('SSE Session not found');
        }
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    return new Promise<number>((resolve, reject) => {
      this.httpServer!.listen(0, '127.0.0.1', () => {
        const addr = this.httpServer!.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
          this.writePortFile(this.port);
          resolve(this.port);
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });

      this.httpServer!.on('error', (err) => {
        reject(err);
      });
    });
  }

  private writePortFile(port: number): void {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const vscodeDir = path.join(folders[0].uri.fsPath, '.vscode');
      try {
        if (!fs.existsSync(vscodeDir)) {
          fs.mkdirSync(vscodeDir, { recursive: true });
        }
        const portFile = path.join(vscodeDir, 'trueforge-mcp.json');
        fs.writeFileSync(portFile, JSON.stringify({ port, updatedAt: Date.now() }, null, 2));
      } catch {
        // ignore workspace write errors
      }
    }
  }

  getPort(): number {
    return this.port;
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      return new Promise<void>((resolve) => {
        this.httpServer!.close(() => {
          resolve();
        });
      });
    }
  }
}
