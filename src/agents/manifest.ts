/**
 * @fileoverview .agent manifest file parser.
 *
 * .agent files are declarative agent definitions with metadata headers
 * and an async function body, similar to .trx files but with agent-specific
 * metadata like @trigger, @permissions.*, and @escalate.
 *
 * @module agents/manifest
 */

import type { AgentPermissions } from "./permissions";
import { emptyPermissions, parseGlobs } from "./permissions";
import { getAgentRuntime, parseTrigger, type AgentTrigger } from "./runtime";
import { getGuardQueue } from "./guard";
import type { InMemoryVFS } from "../vfs/memory";
import { getMCPClient } from "../mcp/client";
import { createAIBridge } from "../engine/ai/bridge";
import { getAIConfig } from "../stores/ai";
import { getEventBus } from "../events/bus";
import { getContextState, getActiveSession } from "../context/state";

/**
 * Globals that agent code must NOT access directly.
 * Passed as function parameters set to undefined, shadowing the real
 * globals so agent code can only interact through the agentAPI surface.
 */
const SANDBOXED_GLOBALS = [
  // Global object references
  "globalThis",
  "self",
  "window",
  "top",
  "parent",
  "frames",
  // DOM / browser APIs
  "document",
  "navigator",
  "location",
  // Network
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  // Workers
  "Worker",
  "SharedWorker",
  // Storage
  "indexedDB",
  "localStorage",
  "sessionStorage",
  "caches",
  // Escape hatches — block eval/Function to prevent trivial sandbox bypass
  "eval",
  "Function",
  // Other host resources
  "Notification",
  "BroadcastChannel",
  "open",
  "close",
  "alert",
  "confirm",
  "prompt",
  "importScripts",
  "postMessage",
] as const;

/**
 * Execute agent code in a sandboxed context.
 *
 * NOTE: This sandbox is NOT cryptographically secure. It shadows common
 * browser globals but cannot prevent all escape routes (e.g. via Object
 * prototype chain, Proxy, Reflect, or non-listed globals). Agent code
 * should be treated as semi-trusted. For a true sandbox, use a Web Worker
 * with a restricted MessageChannel API or an iframe with sandbox="".
 *
 * All globals listed in SANDBOXED_GLOBALS are shadowed by function parameters
 * set to `undefined`, so agent code cannot reach host resources except through
 * the provided agentAPI (`a`). Strict mode ensures `this` is `undefined`
 * rather than `globalThis`.
 */
async function executeSandboxedAgentCode(
  code: string,
  agentAPI: Record<string, unknown>,
): Promise<void> {
  // Freeze agentAPI to prevent prototype pollution from within agent code
  const frozenAPI = Object.freeze({ ...agentAPI });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  // Build parameter list: 'a' (the agentAPI) followed by every blocked global
  const params = ["a", ...SANDBOXED_GLOBALS];
  const wrappedCode = `"use strict";\n${code}`;
  const fn = new AsyncFunction(...params, wrappedCode);

  // Pass agentAPI as first arg, undefined for every blocked global.
  // .call(null) ensures `this` is null (undefined in strict mode).
  const args: unknown[] = [frozenAPI];
  for (let i = 0; i < SANDBOXED_GLOBALS.length; i++) {
    args.push(undefined);
  }
  await fn.call(null, ...args);
}

/**
 * Parsed agent manifest.
 */
export interface AgentManifest {
  success: boolean;
  name?: string;
  description?: string;
  version?: string;
  trigger?: AgentTrigger;
  permissions?: AgentPermissions;
  escalate?: "never" | "always" | "out-of-scope";
  body?: string;
  error?: string;
}

/**
 * Parse an .agent manifest file.
 */
export function parseAgentManifest(source: string): AgentManifest {
  const lines = source.split("\n");
  const metadata: Record<string, string> = {};
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === "") continue;
    if (line.startsWith("#!")) {
      bodyStartIndex = i + 1;
      continue;
    }

    if (line.startsWith("//")) {
      const commentContent = line.substring(2).trim();
      const match = commentContent.match(/^@?([\w.]+):\s*(.*)$/);
      if (match) {
        metadata[match[1].toLowerCase()] = match[2].trim();
        bodyStartIndex = i + 1;
        continue;
      }
      bodyStartIndex = i + 1;
      continue;
    }

    bodyStartIndex = i;
    break;
  }

  if (!metadata.name) {
    return { success: false, error: "Missing required @name field" };
  }

  // Parse permissions from metadata
  const permissions = emptyPermissions();
  if (metadata["permissions.read"]) {
    permissions.read = parseGlobs(metadata["permissions.read"]);
  }
  if (metadata["permissions.write"]) {
    permissions.write = parseGlobs(metadata["permissions.write"]);
  }
  if (metadata["permissions.mcp"]) {
    permissions.mcp =
      metadata["permissions.mcp"] === "(none)"
        ? []
        : metadata["permissions.mcp"].split(",").map((s) => s.trim());
  }
  if (metadata["permissions.network"]) {
    permissions.network = metadata["permissions.network"] === "true";
  }
  if (metadata["permissions.spawn"]) {
    permissions.spawn = metadata["permissions.spawn"] === "true";
  }

  // Always allow reading context
  if (!permissions.read.includes("/proc/context/*")) {
    permissions.read.push("/proc/context/*");
  }

  // Parse trigger
  let trigger: AgentTrigger = { type: "manual" };
  if (metadata.trigger) {
    trigger = parseTrigger(metadata.trigger);
  }

  // Parse escalate
  const escalate =
    (metadata.escalate as "never" | "always" | "out-of-scope") ||
    "out-of-scope";

  const body = lines.slice(bodyStartIndex).join("\n").trim();

  return {
    success: true,
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    trigger,
    permissions,
    escalate,
    body,
  };
}

/**
 * Extract the function body from an .agent file's async function wrapper.
 */
function extractAgentFunctionBody(body: string): {
  success: boolean;
  code?: string;
  error?: string;
} {
  // Match: (async function(a) { ... })
  const match = body.match(
    /^\s*\(\s*async\s+function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*\)\s*$/,
  );
  if (match) return { success: true, code: match[2] };

  // Match: async function(a) { ... }
  const altMatch = body.match(
    /^\s*async\s+function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*$/,
  );
  if (altMatch) return { success: true, code: altMatch[2] };

  // Match: async function name(a) { ... }
  const namedMatch = body.match(
    /^\s*async\s+function\s+(\w+)\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*$/,
  );
  if (namedMatch) return { success: true, code: namedMatch[3] };

  return {
    success: false,
    error: "Invalid .agent format: expected async function(a) { ... }",
  };
}

/**
 * Start an agent from a parsed manifest.
 */
export async function startFromManifest(
  manifest: AgentManifest,
  vfs?: InMemoryVFS,
): Promise<string> {
  if (!manifest.success || !manifest.name) {
    throw new Error(manifest.error || "Invalid manifest");
  }

  const runtime = getAgentRuntime();
  const guardQueue = getGuardQueue();

  const goal = manifest.description || manifest.name;

  // Build the executor *before* start() so it is registered atomically with
  // the trigger setup inside runtime.start().  The closure captures `id` by
  // reference; `id` is assigned synchronously when start() returns — always
  // before any asynchronous trigger callback can fire.
  let id: string | undefined;
  let executor: (() => Promise<void>) | undefined;

  if (manifest.body) {
    const extractResult = extractAgentFunctionBody(manifest.body);
    if (extractResult.success && extractResult.code) {
      const code = extractResult.code;

      executor = async () => {
        if (!id) return; // Guard against execution before id is assigned
        const agent = runtime.listAgents().find((a) => a.id === id);
        if (!agent) return;

        // Build the agent API (a)
        const scopedFs = vfs
          ? runtime.createScopedFs(agent.id, vfs, guardQueue)
          : undefined;
        const ctx = getContextState(getActiveSession());

        const agentAPI = {
          context: ctx.workspace,
          focus: ctx.focus,
          log: (msg: string) => {
            agent.log.push({
              ts: new Date().toISOString(),
              action: "log",
              result: msg,
            });
          },
          fs: scopedFs,
          mcp: {
            listServers() {
              return getMCPClient()
                .listServers()
                .filter((s) =>
                  runtime.checkPermission(agent.id, "mcp", `${s.name}/*`),
                );
            },
            listTools(serverName: string) {
              if (
                !runtime.checkPermission(agent.id, "mcp", `${serverName}/*`)
              ) {
                throw new Error(
                  `Agent not permitted to access MCP server: ${serverName}`,
                );
              }
              return getMCPClient().listTools(serverName);
            },
            async invokeTool(
              serverName: string,
              toolName: string,
              input: unknown,
            ) {
              if (
                !runtime.checkPermission(
                  agent.id,
                  "mcp",
                  `${serverName}/${toolName}`,
                )
              ) {
                throw new Error(
                  `Agent not permitted to invoke MCP tool: ${serverName}/${toolName}`,
                );
              }
              return getMCPClient().invokeTool(serverName, toolName, input);
            },
          },
          llm: async (prompt: string) => {
            const bridge = createAIBridge(getAIConfig());
            const cwd = String(ctx.workspace?.cwd ?? "/");
            const sessionId = getActiveSession() || undefined;
            const response = await bridge.execute(
              "chat",
              prompt,
              {
                cwd,
                env: {},
              },
              null,
              undefined,
              sessionId,
            );
            if (!response.success) {
              throw new Error(response.error || "LLM request failed");
            }
            return response.content;
          },
          lastRunAt: agent.lastRunAt || agent.createdAt,
          done: () => {
            agent.lastRunAt = new Date();
            agent.log.push({
              ts: new Date().toISOString(),
              action: "done",
              result: "Run cycle completed",
            });
            getEventBus().emit({
              type: "agent-action",
              payload: {
                agent_id: agent.id,
                action: "completed",
                agent_name: agent.name,
              },
            });
          },
        };

        await executeSandboxedAgentCode(code, agentAPI);
      };
    }
  }

  id = await runtime.start(
    manifest.name,
    goal,
    manifest.permissions || emptyPermissions(),
    manifest.trigger || { type: "manual" },
    manifest.escalate || "out-of-scope",
    executor,
  );

  return id;
}
