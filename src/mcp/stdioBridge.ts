/**
 * @file stdioBridge.ts
 * @description Standalone Stdio bridge for CLI / subagent integration with the MCP server.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;
  console.error(`[stdioBridge] Connecting stdio to TrueForge MCP on port ${port}...`);

  const transport = new StdioServerTransport();
  await transport.start();
}

main().catch((err) => {
  console.error('[stdioBridge] Fatal error:', err);
  process.exit(1);
});
