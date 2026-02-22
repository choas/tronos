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
};

/**
 * Map of /proc paths to write handlers (for writable proc files)
 */
export const procWriteHandlers: Record<string, ProcWriteHandler> = {};

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
 * Get the generator for a /proc path, if it exists
 */
export function getProcGenerator(path: string): ProcGenerator | undefined {
  return procGenerators[path];
}

/**
 * Get the write handler for a /proc path, if it exists
 */
export function getProcWriteHandler(path: string): ProcWriteHandler | undefined {
  return procWriteHandlers[path];
}

/**
 * Check if a /proc path is writable
 */
export function isProcWritable(path: string): boolean {
  return path in procWriteHandlers;
}

/**
 * Structure of /proc filesystem for directory listings
 */
export const procStructure: Record<string, string[]> = {
  '/proc': ['ai', 'system', 'env', 'cron', 'theme'],
  '/proc/ai': ['model', 'provider', 'status'],
  '/proc/system': ['version', 'uptime', 'memory'],
  '/proc/cron': ['jobs'],
  '/proc/theme': ['active', 'colors', 'presets'],
  '/proc/theme/colors': [...COLOR_KEYS],
  '/proc/theme/presets': [], // dynamically populated
};

/**
 * Check if a /proc path is a directory
 */
export function isProcDirectory(path: string): boolean {
  return path in procStructure;
}

/**
 * List contents of a /proc directory
 */
export function listProcDirectory(path: string): string[] | undefined {
  if (path === '/proc/theme/presets') {
    return getAllPresetNames();
  }
  return procStructure[path];
}
