/**
 * @fileoverview Agent permission checking and violation logging.
 *
 * Every agent declares its permissions before first execution.
 * The runtime enforces these strictly. Violations are logged but
 * don't crash the agent — the agent receives an error.
 *
 * @module agents/permissions
 */

/**
 * Declared permissions for an agent.
 */
export interface AgentPermissions {
  /** Glob patterns for readable paths */
  read: string[];
  /** Glob patterns for writable paths */
  write: string[];
  /** server/tool pairs for MCP access */
  mcp: string[];
  /** Whether t.net.fetch() is allowed */
  network: boolean;
  /** Whether agent can start sub-agents */
  spawn: boolean;
}

/**
 * A recorded permission violation.
 */
export interface AgentViolation {
  ts: string;
  agentId: string;
  action: 'read' | 'write' | 'mcp' | 'network' | 'spawn';
  target: string;
  message: string;
}

/**
 * Default (empty) permissions — no access to anything.
 */
export function emptyPermissions(): AgentPermissions {
  return {
    read: [],
    write: [],
    mcp: [],
    network: false,
    spawn: false,
  };
}

/**
 * Check if a path matches any of the glob patterns.
 */
export function matchesGlob(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (globMatch(path, pattern)) return true;
  }
  return false;
}

/** Maximum number of '**' segments allowed in a single glob pattern. */
const MAX_DOUBLE_STAR = 5;
/** Maximum total length of a glob pattern string. */
const MAX_PATTERN_LENGTH = 1024;

/**
 * Simple glob matching.
 * Supports * (any segment) and ** (any depth).
 *
 * To prevent ReDoS from pathological regexes, patterns are rejected
 * (treated as non-matching) when they contain more than
 * {@link MAX_DOUBLE_STAR} '**' segments or exceed
 * {@link MAX_PATTERN_LENGTH} characters.
 */
function globMatch(path: string, pattern: string): boolean {
  if (path === pattern) return true;

  // Complexity guard: reject patterns that would produce expensive regexes.
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  const doubleStarCount = pattern.split('**').length - 1;
  if (doubleStarCount > MAX_DOUBLE_STAR) return false;

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLESTAR>>>/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(path);
}

/**
 * Check if an agent has read permission for a path.
 */
export function canRead(permissions: AgentPermissions, path: string): boolean {
  return matchesGlob(path, permissions.read);
}

/**
 * Check if an agent has write permission for a path.
 */
export function canWrite(permissions: AgentPermissions, path: string): boolean {
  return matchesGlob(path, permissions.write);
}

/**
 * Check if an agent can access an MCP server/tool.
 */
export function canAccessMCP(permissions: AgentPermissions, serverTool: string): boolean {
  return matchesGlob(serverTool, permissions.mcp);
}

/**
 * Parse permission globs from command-line flag value.
 * e.g. "/home/user/**,/tmp/*" → ["/home/user/**", "/tmp/*"]
 */
export function parseGlobs(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}
