/**
 * @fileoverview MCP VFS handler for /proc/mcp/.
 *
 * Maps MCP servers and tools to VFS paths:
 *   /proc/mcp/status           — JSON list of connected servers
 *   /proc/mcp/{server}/tools   — newline-separated tool names
 *   /proc/mcp/{server}/{tool}  — write JSON to invoke, read result
 *
 * @module vfs/mcp
 */

import { getMCPClient } from '../mcp/client';

/**
 * Check if a path is under /proc/mcp.
 */
export function isMCPPath(path: string): boolean {
  return path === '/proc/mcp' || path.startsWith('/proc/mcp/');
}

/**
 * Check if an MCP path is a directory.
 */
export function isMCPDirectory(path: string): boolean {
  if (path === '/proc/mcp') return true;

  const parts = parseMCPPath(path);
  if (!parts) return false;

  // /proc/mcp/{server} is a directory
  if (parts.serverName && !parts.toolName) {
    const client = getMCPClient();
    return client.getServer(parts.serverName) !== undefined;
  }

  return false;
}

/**
 * Check if an MCP path is a file.
 */
export function isMCPFile(path: string): boolean {
  if (path === '/proc/mcp/status') return true;

  const parts = parseMCPPath(path);
  if (!parts) return false;

  if (parts.serverName && parts.toolName) {
    return true; // tools and tool names are files
  }

  return false;
}

/**
 * List contents of an MCP directory.
 */
export function listMCPDirectory(path: string): string[] | undefined {
  if (path === '/proc/mcp') {
    const client = getMCPClient();
    const servers = client.listServers();
    const names = servers.map(s => s.name);
    if (!names.includes('status')) {
      names.unshift('status');
    }
    return names.length > 0 ? names : ['status'];
  }

  const parts = parseMCPPath(path);
  if (!parts || !parts.serverName || parts.toolName) return undefined;

  const client = getMCPClient();
  const server = client.getServer(parts.serverName);
  if (!server) return undefined;

  return ['tools', ...server.tools.map(t => t.name)];
}

/**
 * Read an MCP VFS path.
 */
export function readMCP(path: string): string {
  if (path === '/proc/mcp/status') {
    return getMCPClient().getStatusJSON();
  }

  const parts = parseMCPPath(path);
  if (!parts || !parts.serverName) {
    throw new Error(`read: no such file: ${path}`);
  }

  const client = getMCPClient();

  // /proc/mcp/{server}/tools
  if (parts.toolName === 'tools') {
    const tools = client.listTools(parts.serverName);
    return tools.map(t => t.name).join('\n');
  }

  // /proc/mcp/{server}/{tool} — return last result
  if (parts.toolName) {
    return client.getLastResult(parts.serverName, parts.toolName);
  }

  throw new Error(`read: not a file: ${path}`);
}

/**
 * Write to an MCP VFS path (invoke a tool).
 */
export async function writeMCP(path: string, data: string): Promise<void> {
  const parts = parseMCPPath(path);
  if (!parts || !parts.serverName || !parts.toolName) {
    throw new Error(`write: cannot write to ${path}`);
  }

  if (parts.toolName === 'tools') {
    throw new Error(`write: /proc/mcp/${parts.serverName}/tools is read-only`);
  }

  const client = getMCPClient();
  let input: unknown;
  try {
    input = JSON.parse(data);
  } catch {
    input = { input: data };
  }

  await client.invokeTool(parts.serverName, parts.toolName, input);
}

/**
 * Parse an MCP path into components.
 */
function parseMCPPath(path: string): { serverName?: string; toolName?: string } | null {
  // Remove /proc/mcp prefix
  const suffix = path.replace(/^\/proc\/mcp\/?/, '');
  if (!suffix) return {};

  const segments = suffix.split('/').filter(Boolean);
  if (segments.length === 0) return {};
  if (segments.length === 1) {
    // Could be "status" or a server name
    if (segments[0] === 'status') return { serverName: undefined, toolName: undefined };
    return { serverName: segments[0] };
  }
  if (segments.length === 2) {
    return { serverName: segments[0], toolName: segments[1] };
  }

  return null;
}
