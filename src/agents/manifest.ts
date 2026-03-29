/**
 * @fileoverview .agent manifest file parser.
 *
 * .agent files are declarative agent definitions with metadata headers
 * and an async function body, similar to .trx files but with agent-specific
 * metadata like @trigger, @permissions.*, and @escalate.
 *
 * @module agents/manifest
 */

import type { AgentPermissions } from './permissions';
import { emptyPermissions, parseGlobs } from './permissions';
import { getAgentRuntime, parseTrigger, type AgentTrigger } from './runtime';
import { getGuardQueue } from './guard';

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
  escalate?: 'never' | 'always' | 'out-of-scope';
  body?: string;
  error?: string;
}

/**
 * Parse an .agent manifest file.
 */
export function parseAgentManifest(source: string): AgentManifest {
  const lines = source.split('\n');
  const metadata: Record<string, string> = {};
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === '') continue;
    if (line.startsWith('#!')) {
      bodyStartIndex = i + 1;
      continue;
    }

    if (line.startsWith('//')) {
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
    return { success: false, error: 'Missing required @name field' };
  }

  // Parse permissions from metadata
  const permissions = emptyPermissions();
  if (metadata['permissions.read']) {
    permissions.read = parseGlobs(metadata['permissions.read']);
  }
  if (metadata['permissions.write']) {
    permissions.write = parseGlobs(metadata['permissions.write']);
  }
  if (metadata['permissions.mcp']) {
    permissions.mcp = metadata['permissions.mcp'] === '(none)' ? [] :
      metadata['permissions.mcp'].split(',').map(s => s.trim());
  }
  if (metadata['permissions.network']) {
    permissions.network = metadata['permissions.network'] === 'true';
  }
  if (metadata['permissions.spawn']) {
    permissions.spawn = metadata['permissions.spawn'] === 'true';
  }

  // Always allow reading context
  if (!permissions.read.includes('/proc/context/*')) {
    permissions.read.push('/proc/context/*');
  }

  // Parse trigger
  let trigger: AgentTrigger = { type: 'manual' };
  if (metadata.trigger) {
    trigger = parseTrigger(metadata.trigger);
  }

  // Parse escalate
  const escalate = (metadata.escalate as 'never' | 'always' | 'out-of-scope') || 'out-of-scope';

  const body = lines.slice(bodyStartIndex).join('\n').trim();

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
function extractAgentFunctionBody(body: string): { success: boolean; code?: string; error?: string } {
  // Match: (async function(a) { ... })
  const match = body.match(/^\s*\(\s*async\s+function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*\)\s*$/);
  if (match) return { success: true, code: match[2] };

  // Match: async function(a) { ... }
  const altMatch = body.match(/^\s*async\s+function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*$/);
  if (altMatch) return { success: true, code: altMatch[2] };

  // Match: async function name(a) { ... }
  const namedMatch = body.match(/^\s*async\s+function\s+(\w+)\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*$/);
  if (namedMatch) return { success: true, code: namedMatch[3] };

  return { success: false, error: 'Invalid .agent format: expected async function(a) { ... }' };
}

/**
 * Start an agent from a parsed manifest.
 */
export async function startFromManifest(
  manifest: AgentManifest,
  vfs?: any
): Promise<string> {
  if (!manifest.success || !manifest.name) {
    throw new Error(manifest.error || 'Invalid manifest');
  }

  const runtime = getAgentRuntime();
  const guardQueue = getGuardQueue();

  // Create executor from body
  let executor: (() => Promise<void>) | undefined;

  if (manifest.body) {
    const extractResult = extractAgentFunctionBody(manifest.body);
    if (extractResult.success && extractResult.code) {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const code = extractResult.code;

      executor = async () => {
        const agent = runtime.listAgents().find(a => a.name === manifest.name);
        if (!agent) return;

        // Build the agent API (a)
        const scopedFs = vfs ? runtime.createScopedFs(agent.id, vfs, guardQueue) : undefined;
        const { getContextState } = await import('../context/state');
        const ctx = getContextState();

        const agentAPI = {
          context: ctx.workspace,
          focus: ctx.focus,
          log: (msg: string) => {
            agent.log.push({
              ts: new Date().toISOString(),
              action: 'log',
              result: msg,
            });
          },
          fs: scopedFs,
          mcp: undefined, // TODO: scoped MCP access
          llm: async (prompt: string) => {
            // Placeholder — in a real implementation this would call the AI bridge
            return `[LLM response to: ${prompt}]`;
          },
          lastRunAt: agent.lastRunAt || agent.createdAt,
          done: () => { /* signal completion of this run cycle */ },
        };

        const fn = new AsyncFunction('a', code);
        await fn(agentAPI);
      };
    }
  }

  const goal = manifest.description || manifest.name;
  const id = await runtime.start(
    manifest.name,
    goal,
    manifest.permissions || emptyPermissions(),
    manifest.trigger || { type: 'manual' },
    executor
  );

  return id;
}
