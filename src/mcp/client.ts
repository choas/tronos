/**
 * @fileoverview MCP (Model Context Protocol) client for TronOS.
 *
 * Provides a client that connects to MCP servers and exposes their
 * tools through the VFS at /proc/mcp/{server}/{tool}.
 *
 * Transports supported: SSE, WebSocket (stdio is future/CLI-only).
 *
 * @module mcp/client
 */

import { emitFileChanged } from "../events/bus";

/** Characters / patterns forbidden in MCP server and tool names. */
const UNSAFE_NAME_RE = /[\/:.]/;
const RESERVED_NAMES = ["tools"];

/**
 * Validate that an MCP name (server or tool) is safe for use in VFS
 * paths and cache keys.  Throws if the name is empty, contains unsafe
 * characters ('/', ':', '.'), includes '..', or equals a reserved word.
 */
export function validateMCPName(name: string, kind: string): void {
  if (!name) {
    throw new Error(`Invalid MCP ${kind} name: name must not be empty`);
  }
  if (name === ".." || name === ".") {
    throw new Error(
      `Invalid MCP ${kind} name "${name}": path traversal is not allowed`,
    );
  }
  if (UNSAFE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid MCP ${kind} name "${name}": must not contain '/', ':', or '.'`,
    );
  }
  if (RESERVED_NAMES.includes(name)) {
    throw new Error(
      `Invalid MCP ${kind} name "${name}": "${name}" is a reserved name`,
    );
  }
}

/**
 * An MCP tool definition.
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP server connection status.
 */
export type MCPServerStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "connecting";

/**
 * An MCP server registration.
 */
export interface MCPServer {
  name: string;
  url: string;
  transport: "sse" | "websocket" | "stdio";
  status: MCPServerStatus;
  tools: MCPTool[];
  autoconnect: boolean;
  error?: string;
}

/**
 * MCP server config for /etc/mcp.json persistence.
 */
export interface MCPServerConfig {
  name: string;
  url: string;
  transport?: "sse" | "websocket" | "stdio";
  autoconnect?: boolean;
}

/**
 * MCP configuration file format.
 */
export interface MCPConfig {
  servers: MCPServerConfig[];
}

/**
 * The MCPClient manages connections to MCP servers and exposes
 * their tools via the VFS.
 */
export class MCPClient {
  private servers: Map<string, MCPServer> = new Map();
  private lastResults: Map<string, string> = new Map(); // key: "server:tool"

  /**
   * Connect to an MCP server.
   */
  async connect(
    name: string,
    url: string,
    transport?: "sse" | "websocket" | "stdio",
  ): Promise<void> {
    validateMCPName(name, "server");
    const resolvedTransport = transport || this.detectTransport(url);

    const server: MCPServer = {
      name,
      url,
      transport: resolvedTransport,
      status: "connecting",
      tools: [],
      autoconnect: false,
    };

    this.servers.set(name, server);

    try {
      // Discover tools from the server
      const tools = await this.discoverTools(server);
      server.tools = tools;
      server.status = "connected";
    } catch (err) {
      server.status = "error";
      server.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server not found: ${name}`);
    }
    server.status = "disconnected";
    this.servers.delete(name);
  }

  /**
   * List all registered servers.
   */
  listServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get a specific server by name.
   */
  getServer(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  /**
   * List tools for a server.
   */
  listTools(serverName: string): MCPTool[] {
    const server = this.servers.get(serverName);
    if (!server) return [];
    return server.tools;
  }

  /**
   * Invoke a tool on a server.
   */
  async invokeTool(
    serverName: string,
    toolName: string,
    input: unknown,
  ): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }
    if (server.status !== "connected") {
      throw new Error(
        `MCP server ${serverName} is not connected (status: ${server.status})`,
      );
    }

    const tool = server.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName} on server ${serverName}`);
    }

    try {
      const result = await this.callTool(server, toolName, input);
      const resultStr = JSON.stringify(result, null, 2);
      this.lastResults.set(`${serverName}:${toolName}`, resultStr);

      // Emit event
      emitFileChanged(`/proc/mcp/${serverName}/${toolName}`, "write");

      return result;
    } catch (err) {
      const errorResult = {
        error: err instanceof Error ? err.message : String(err),
      };
      this.lastResults.set(
        `${serverName}:${toolName}`,
        JSON.stringify(errorResult),
      );
      emitFileChanged(`/proc/mcp/${serverName}/${toolName}`, "write");
      throw err;
    }
  }

  /**
   * Get the last result for a tool invocation.
   */
  getLastResult(serverName: string, toolName: string): string {
    return this.lastResults.get(`${serverName}:${toolName}`) || "{}";
  }

  /**
   * Get the status of all servers as JSON.
   */
  getStatusJSON(): string {
    const servers = this.listServers().map((s) => ({
      name: s.name,
      hasUrl: !!s.url,
      transport: s.transport,
      status: s.status,
      tools: s.tools.length,
      error: s.error,
    }));
    return JSON.stringify(servers, null, 2);
  }

  /**
   * Detect transport from URL.
   */
  private detectTransport(url: string): "sse" | "websocket" | "stdio" {
    if (url.startsWith("ws://") || url.startsWith("wss://")) return "websocket";
    if (url.startsWith("stdio://")) return "stdio";
    return "sse"; // default for HTTP/HTTPS
  }

  /**
   * Discover tools from an MCP server.
   * Uses the MCP protocol's tools/list method.
   */
  private async discoverTools(server: MCPServer): Promise<MCPTool[]> {
    if (server.transport === "sse") {
      return this.discoverToolsSSE(server);
    } else if (server.transport === "websocket") {
      return this.discoverToolsWebSocket(server);
    }
    throw new Error(`Transport ${server.transport} not supported in browser`);
  }

  /**
   * Discover tools via SSE transport.
   */
  private async discoverToolsSSE(server: MCPServer): Promise<MCPTool[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || "Server returned JSON-RPC error");
      }
      if (!data.result || !Array.isArray(data.result.tools)) {
        throw new Error(
          "Malformed tools/list response: missing result.tools array",
        );
      }
      return data.result.tools.map((t: any) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || {},
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          `Failed to discover tools from ${server.name}: request timed out`,
        );
      }
      throw new Error(
        `Failed to discover tools from ${server.name}: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Discover tools via WebSocket transport.
   */
  private async discoverToolsWebSocket(server: MCPServer): Promise<MCPTool[]> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(server.url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("WebSocket connection timed out"));
        }, 10000);

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "tools/list",
              id: 1,
            }),
          );
        };

        ws.onmessage = (event) => {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(event.data);
            if (data.error) {
              reject(
                new Error(
                  data.error.message || "Server returned JSON-RPC error",
                ),
              );
              ws.close();
              return;
            }
            if (!data.result || !Array.isArray(data.result.tools)) {
              reject(
                new Error(
                  "Malformed tools/list response: missing result.tools array",
                ),
              );
              ws.close();
              return;
            }
            resolve(
              data.result.tools.map((t: any) => ({
                name: t.name,
                description: t.description || "",
                inputSchema: t.inputSchema || {},
              })),
            );
          } catch {
            reject(new Error("Invalid JSON response from MCP server"));
          }
          ws.close();
        };

        ws.onerror = (err) => {
          clearTimeout(timeout);
          reject(new Error(`WebSocket error: ${err}`));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Call a tool on an MCP server.
   */
  private async callTool(
    server: MCPServer,
    toolName: string,
    input: unknown,
  ): Promise<unknown> {
    if (server.transport === "sse") {
      return this.callToolSSE(server, toolName, input);
    } else if (server.transport === "websocket") {
      return this.callToolWebSocket(server, toolName, input);
    }
    throw new Error(`Transport ${server.transport} not supported in browser`);
  }

  /**
   * Call a tool via SSE/HTTP transport.
   */
  private async callToolSSE(
    server: MCPServer,
    toolName: string,
    input: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: toolName, arguments: input },
          id: Date.now(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || "Tool invocation failed");
      }
      if (!Object.prototype.hasOwnProperty.call(data, "result")) {
        throw new Error(
          "Malformed tools/call response: missing 'result' property",
        );
      }
      return data.result;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Tool call to ${toolName} on ${server.name} timed out`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Call a tool via WebSocket transport.
   */
  private async callToolWebSocket(
    server: MCPServer,
    toolName: string,
    input: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(server.url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket call timed out"));
      }, 30000);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: toolName, arguments: input },
            id: Date.now(),
          }),
        );
      };

      ws.onmessage = (event) => {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            reject(new Error(data.error.message || "Tool call failed"));
          } else if (!Object.prototype.hasOwnProperty.call(data, "result")) {
            reject(
              new Error(
                "Malformed tools/call response: missing 'result' property",
              ),
            );
          } else {
            resolve(data.result);
          }
        } catch {
          reject(new Error("Invalid response from MCP server"));
        }
        ws.close();
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${err}`));
      };
    });
  }
}

/** Singleton MCP client instance */
let mcpClientInstance: MCPClient | null = null;

/**
 * Get the global MCP client singleton.
 */
export function getMCPClient(): MCPClient {
  if (!mcpClientInstance) {
    mcpClientInstance = new MCPClient();
  }
  return mcpClientInstance;
}
