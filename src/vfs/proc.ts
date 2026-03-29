/**
 * /proc generators for TronOS virtual filesystem
 *
 * These generators provide dynamic content for special /proc files
 * that reflect the current state of the system.
 */

import { getAIConfig, isAIConfigured } from '../stores/ai';
import { VERSION_STRING } from '../version';
import { getCronScheduler } from '../engine/cron';
import {
  getTheme,
  getColor,
  setColor,
  getAllPresetNames,
  getPreset,
  COLOR_KEYS,
  type ColorKey,
} from '../stores/theme';
import {
  readWorkspace,
  writeWorkspace,
  readFocus,
  readHistory,
} from '../context/state';
import { getEventBus } from '../events/bus';
import { getAgentRuntime } from '../agents/runtime';
import { getGuardQueue } from '../agents/guard';
import {
  isMCPPath,
  isMCPDirectory,
  isMCPFile,
  readMCP,
  writeMCP,
  listMCPDirectory,
} from './mcp';

/** Boot time for uptime calculation */
let bootTime: number = Date.now();

/**
 * Set the boot time (called during system initialization)
 */
export function setBootTime(time: number): void {
  bootTime = time;
}

/**
 * Get the boot time
 */
export function getBootTime(): number {
  return bootTime;
}

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Context for proc generators that need external state
 */
export interface ProcContext {
  env: Record<string, string>;
}

/** Default context with empty environment */
let procContext: ProcContext = {
  env: {}
};

/**
 * Set the proc context (called by shell/execution context)
 */
export function setProcContext(ctx: ProcContext): void {
  procContext = ctx;
}

/**
 * Proc generator function type
 */
export type ProcGenerator = () => string;

/**
 * Proc write handler function type
 */
export type ProcWriteHandler = (data: string) => void;

/**
 * Map of /proc paths to their generator functions
 */
export const procGenerators: Record<string, ProcGenerator> = {
  // AI configuration info
  '/proc/ai/model': () => getAIConfig().model,
  '/proc/ai/provider': () => getAIConfig().provider,
  '/proc/ai/status': () => isAIConfigured() ? 'configured' : 'not configured',

  // System information
  '/proc/system/version': () => VERSION_STRING,
  '/proc/system/uptime': () => {
    const seconds = Math.floor((Date.now() - bootTime) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  },
  '/proc/system/memory': () => {
    // performance.memory is a non-standard Chrome extension
    const perfMemory = (performance as any)?.memory;
    const used = perfMemory?.usedJSHeapSize || 0;
    const total = perfMemory?.jsHeapSizeLimit || 0;
    if (used === 0 && total === 0) {
      return 'Memory info not available';
    }
    return `Used: ${formatBytes(used)}\nTotal: ${formatBytes(total)}`;
  },

  // Environment (dynamically reads from context)
  '/proc/env': () => {
    return Object.entries(procContext.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
  },

  // Cron jobs in crontab format
  '/proc/cron/jobs': () => {
    return getCronScheduler().toCrontab();
  },

  // Theme: active theme name
  '/proc/theme/active': () => getTheme(),

  // Context bus
  '/proc/context/workspace': () => readWorkspace(),
  '/proc/context/focus': () => readFocus(),
  '/proc/context/history': () => readHistory(),

  // Event bus
  '/proc/events/stream': () => {
    const bus = getEventBus();
    const recent = bus.getHistory(50);
    return recent.map(e => JSON.stringify(e)).join('\n');
  },
  '/proc/events/subscribers': () => {
    const bus = getEventBus();
    const subs = bus.getSubscriptions();
    return JSON.stringify(subs.map(s => ({
      id: s.id,
      pattern: s.pattern,
      command: s.command,
    })), null, 2);
  },
  '/proc/events/history': () => {
    const bus = getEventBus();
    return bus.getHistory().map(e => JSON.stringify(e)).join('\n');
  },
};

/**
 * Map of /proc paths to write handlers (for writable proc files)
 */
export const procWriteHandlers: Record<string, ProcWriteHandler> = {
  '/proc/context/workspace': (data: string) => writeWorkspace(data),
};

// Register write handlers for /proc/theme/colors/*
for (const key of COLOR_KEYS) {
  const procPath = `/proc/theme/colors/${key}`;
  // Read handler
  procGenerators[procPath] = () => getColor(key);
  // Write handler
  procWriteHandlers[procPath] = (data: string) => {
    const value = data.trim();
    setColor(key as ColorKey, value);
  };
}

// Register read handlers for /proc/theme/presets/*
function registerPresetGenerators(): void {
  for (const name of getAllPresetNames()) {
    const procPath = `/proc/theme/presets/${name}`;
    procGenerators[procPath] = () => {
      const preset = getPreset(name);
      if (!preset) return '';
      return Object.entries(preset.colors)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    };
  }
}

// Initial registration
registerPresetGenerators();

/**
 * Re-register preset generators (call after adding custom presets)
 */
export function refreshPresetGenerators(): void {
  registerPresetGenerators();
}

/**
 * Check if a path is a /proc path
 */
export function isProcPath(path: string): boolean {
  return path === '/proc' || path.startsWith('/proc/');
}

/**
 * Get the generator for a /proc path, if it exists.
 * Handles dynamic paths (MCP tools, agents) that aren't pre-registered.
 */
export function getProcGenerator(path: string): ProcGenerator | undefined {
  // Static generators first
  const gen = procGenerators[path];
  if (gen) return gen;

  // Dynamic: MCP tool paths /proc/mcp/{server}/{tool}
  if (isMCPPath(path) && isMCPFile(path)) {
    return () => readMCP(path);
  }

  // Dynamic: Agent paths /proc/agents/{id}/{field}
  if (path.startsWith('/proc/agents/')) {
    return getAgentProcGenerator(path);
  }

  // Dynamic: Guard paths
  if (path === '/proc/guard/pending') {
    return () => getGuardQueue().getPending().map(r => JSON.stringify(r)).join('\n');
  }
  if (path === '/proc/guard/log') {
    return () => getGuardQueue().getLog().map(r => JSON.stringify(r)).join('\n');
  }
  if (path === '/proc/guard/policy') {
    return () => JSON.stringify(getGuardQueue().getPolicy(), null, 2);
  }

  return undefined;
}

/**
 * Get a proc generator for agent-specific paths.
 */
function getAgentProcGenerator(path: string): ProcGenerator | undefined {
  const parts = path.replace('/proc/agents/', '').split('/');
  if (parts.length !== 2) return undefined;

  const [id, field] = parts;
  const runtime = getAgentRuntime();

  return () => {
    const agent = runtime.getAgent(id);
    if (!agent) return `Agent ${id} not found`;

    switch (field) {
      case 'name': return agent.name;
      case 'goal': return agent.goal;
      case 'status': return agent.status;
      case 'permissions': return JSON.stringify(agent.permissions, null, 2);
      case 'log': return agent.log.map(e => JSON.stringify(e)).join('\n');
      case 'pid': return String(agent.pid);
      case 'violations': return agent.violations.map(v => JSON.stringify(v)).join('\n');
      default: return `Unknown agent field: ${field}`;
    }
  };
}

/**
 * Get the write handler for a /proc path, if it exists.
 * Handles dynamic MCP tool writes.
 */
export function getProcWriteHandler(path: string): ProcWriteHandler | undefined {
  const handler = procWriteHandlers[path];
  if (handler) return handler;

  // Dynamic: MCP tool paths /proc/mcp/{server}/{tool}
  if (isMCPPath(path) && isMCPFile(path)) {
    return (data: string) => { writeMCP(path, data); };
  }

  return undefined;
}

/**
 * Check if a /proc path is writable
 */
export function isProcWritable(path: string): boolean {
  if (path in procWriteHandlers) return true;
  // MCP tool paths are writable (invoke on write)
  if (isMCPPath(path) && isMCPFile(path)) return true;
  return false;
}

/**
 * Structure of /proc filesystem for directory listings
 */
export const procStructure: Record<string, string[]> = {
  '/proc': ['ai', 'system', 'env', 'cron', 'theme', 'context', 'events', 'agents', 'guard'],
  '/proc/ai': ['model', 'provider', 'status'],
  '/proc/system': ['version', 'uptime', 'memory'],
  '/proc/cron': ['jobs'],
  '/proc/theme': ['active', 'colors', 'presets'],
  '/proc/theme/colors': [...COLOR_KEYS],
  '/proc/theme/presets': [], // dynamically populated
  '/proc/context': ['workspace', 'focus', 'history'],
  '/proc/events': ['stream', 'subscribers', 'history'],
  '/proc/agents': [],  // dynamically populated
  '/proc/guard': ['pending', 'log', 'policy'],
};

/**
 * Check if a /proc path is a directory
 */
export function isProcDirectory(path: string): boolean {
  if (path in procStructure) return true;
  // Dynamic: MCP server directories
  if (isMCPPath(path) && isMCPDirectory(path)) return true;
  // Dynamic: Agent directories /proc/agents/{id}
  if (path.startsWith('/proc/agents/') && !path.replace('/proc/agents/', '').includes('/')) {
    const id = path.replace('/proc/agents/', '');
    return getAgentRuntime().getAgent(id) !== undefined;
  }
  return false;
}

/**
 * List contents of a /proc directory
 */
export function listProcDirectory(path: string): string[] | undefined {
  if (path === '/proc/theme/presets') {
    return getAllPresetNames();
  }
  // Dynamic: MCP directories
  if (isMCPPath(path)) {
    return listMCPDirectory(path);
  }
  // Dynamic: Agent list
  if (path === '/proc/agents') {
    return getAgentRuntime().listAgents().map(a => a.id);
  }
  // Dynamic: Agent details directory
  if (path.startsWith('/proc/agents/') && !path.replace('/proc/agents/', '').includes('/')) {
    const id = path.replace('/proc/agents/', '');
    if (getAgentRuntime().getAgent(id)) {
      return ['name', 'goal', 'status', 'permissions', 'log', 'pid', 'violations'];
    }
    return undefined;
  }
  return procStructure[path];
}
