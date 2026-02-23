/**
 * @fileoverview Sandbox environment for .trx file execution.
 *
 * This module creates a controlled environment for running .trx programs,
 * providing a safe Terminal API (`t`) without access to dangerous globals
 * or internal system state.
 *
 * The sandbox provides:
 * - **Output**: write(), writeln(), clear(), clearLine()
 * - **Cursor**: moveTo(), moveBy(), getCursor()
 * - **Styling**: t.style.bold(), t.style.red(), etc. (ANSI codes)
 * - **Context**: args[], env{}, cwd (read-only copies)
 * - **Control**: exit(), sleep()
 * - **Filesystem**: t.fs.read(), t.fs.write(), etc.
 * - **Network**: t.net.fetch()
 * - **Execution**: t.exec() for shell commands
 *
 * Security model:
 * - Executables receive copies of context data, not references
 * - VFS paths are automatically resolved relative to cwd
 * - exit() throws ExitSignal rather than terminating the process
 * - Feature availability can be checked before use
 *
 * @module executor/sandbox
 * @see spec Section 7.5 and 14.2 for security model details
 */

import type { ExecutionContext, CommandResult } from '../engine/types';
import type { InMemoryVFS } from '../vfs/memory';
import type { KeyEvent } from '../terminal/api';
import { getPackageConfigValue, setPackageConfigValue } from '../engine/builtins/tpkg';
import { VERSION, VERSION_STRING } from '../version';
import { getActiveSession } from '../stores/sessions';
import {
  getFileVersions,
  getVersion,
  saveVersion,
  hasVersionHistory,
} from '../persistence/versions';

/**
 * ExitSignal is thrown when an executable calls t.exit(code).
 * The executor catches this and returns the appropriate exit code.
 */
export class ExitSignal extends Error {
  public readonly code: number;

  constructor(code: number = 0) {
    super(`Exit with code ${code}`);
    this.name = 'ExitSignal';
    this.code = code;
  }
}

/**
 * File system interface exposed to executables.
 * Provides safe access to VFS operations with automatic path resolution.
 */
export interface SandboxFS {
  read: (path: string) => string | Promise<string>;
  write: (path: string, content: string) => void | Promise<void>;
  append: (path: string, content: string) => void;
  exists: (path: string) => boolean;
  list: (path: string) => string[];
  mkdir: (path: string) => void;
  remove: (path: string) => void;
  stat: (path: string) => { type: 'file' | 'directory' | 'virtual'; name: string };
  cwd: () => string;
  resolve: (path: string) => string;
  isFile: (path: string) => boolean;
  isDirectory: (path: string) => boolean;
}

/**
 * Network interface exposed to executables.
 */
export interface SandboxNet {
  fetch: (url: string, options?: RequestInit) => Promise<Response>;
  /** Proxy fetch for external APIs that don't support CORS */
  proxyFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

/**
 * Version information returned by timewarp API.
 */
export interface SandboxFileVersion {
  id: string;
  timestamp: number;
  author?: string;
  branch: string;
  message?: string;
}

/**
 * Timewarp (file versioning) interface exposed to executables.
 * Provides access to file version history and restoration.
 */
export interface SandboxTimewarp {
  /**
   * List versions for a file.
   * @param path - File path to get versions for
   * @returns Array of version info (newest first)
   */
  list: (path: string) => Promise<SandboxFileVersion[]>;

  /**
   * Get the content of a specific version.
   * @param path - File path
   * @param versionId - Version ID (or partial ID)
   * @returns The version content, or null if not found
   */
  getVersion: (path: string, versionId: string) => Promise<string | null>;

  /**
   * Save a new version of a file.
   * @param path - File path to save
   * @param message - Optional commit message
   * @returns The created version info
   */
  save: (path: string, message?: string) => Promise<SandboxFileVersion>;

  /**
   * Check if a file has version history.
   * @param path - File path to check
   * @returns True if the file has version history
   */
  hasHistory: (path: string) => Promise<boolean>;
}

/**
 * Configuration interface exposed to executables.
 * Allows packages to access their own configuration values at runtime.
 */
export interface SandboxConfig {
  /**
   * Get a configuration value for the current package.
   * @param key - The config key to retrieve
   * @returns The config value (decrypted if secret), or undefined if not found
   */
  get: (key: string) => string | number | boolean | undefined;

  /**
   * Set a configuration value for the current package.
   * @param key - The config key to set
   * @param value - The value to set
   * @returns True if the value was set successfully
   */
  set: (key: string, value: string | number | boolean) => boolean;
}

/**
 * Terminal API sandbox interface exposed to executables.
 * This is the 't' parameter passed to async function(t) { ... }
 */
export interface SandboxTerminalAPI {
  // Output
  write: (text: string) => void;
  writeln: (text: string) => void;
  clear: () => void;
  clearLine: () => void;

  // Cursor control
  moveTo: (x: number, y: number) => void;
  moveBy: (dx: number, dy: number) => void;
  getCursor: () => { x: number; y: number };

  // Terminal size
  getSize: () => { cols: number; rows: number };

  // Input methods
  readLine: (prompt?: string) => Promise<string>;
  readKey: () => Promise<{ key: string; domEvent?: KeyboardEvent }>;
  readChar: () => Promise<string>;
  hasInput: () => boolean;

  // Style helpers
  style: {
    bold: (text: string) => string;
    dim: (text: string) => string;
    italic: (text: string) => string;
    underline: (text: string) => string;
    inverse: (text: string) => string;
    hidden: (text: string) => string;
    strikethrough: (text: string) => string;
    red: (text: string) => string;
    green: (text: string) => string;
    yellow: (text: string) => string;
    blue: (text: string) => string;
    magenta: (text: string) => string;
    cyan: (text: string) => string;
    white: (text: string) => string;
    gray: (text: string) => string;
    reset: (text: string) => string;
  };

  // Context (read-only)
  args: string[];
  env: { [key: string]: string };
  cwd: string;

  // Control
  exit: (code?: number) => never;
  sleep: (ms: number) => Promise<void>;

  // Filesystem
  fs: SandboxFS;

  // Network
  net: SandboxNet;

  // Package configuration (available when running as an installed package)
  config: SandboxConfig;

  // Subprocess execution (returns a promise with the result)
  exec: (command: string) => Promise<CommandResult>;

  // System information
  system: {
    /** TronOS version number (e.g., "0.1.0") */
    version: string;
    /** Full version string (e.g., "TronOS v0.1.0") */
    versionString: string;
  };

  // File versioning (timewarp)
  timewarp: SandboxTimewarp;
}

/**
 * ANSI escape codes for terminal styling
 */
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  hidden: '\x1b[8m',
  strikethrough: '\x1b[9m',
  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/**
 * Create style helpers that wrap text in ANSI codes
 */
function createStyleHelpers() {
  return {
    bold: (text: string) => `${ANSI.bold}${text}${ANSI.reset}`,
    dim: (text: string) => `${ANSI.dim}${text}${ANSI.reset}`,
    italic: (text: string) => `${ANSI.italic}${text}${ANSI.reset}`,
    underline: (text: string) => `${ANSI.underline}${text}${ANSI.reset}`,
    inverse: (text: string) => `${ANSI.inverse}${text}${ANSI.reset}`,
    hidden: (text: string) => `${ANSI.hidden}${text}${ANSI.reset}`,
    strikethrough: (text: string) => `${ANSI.strikethrough}${text}${ANSI.reset}`,
    red: (text: string) => `${ANSI.red}${text}${ANSI.reset}`,
    green: (text: string) => `${ANSI.green}${text}${ANSI.reset}`,
    yellow: (text: string) => `${ANSI.yellow}${text}${ANSI.reset}`,
    blue: (text: string) => `${ANSI.blue}${text}${ANSI.reset}`,
    magenta: (text: string) => `${ANSI.magenta}${text}${ANSI.reset}`,
    cyan: (text: string) => `${ANSI.cyan}${text}${ANSI.reset}`,
    white: (text: string) => `${ANSI.white}${text}${ANSI.reset}`,
    gray: (text: string) => `${ANSI.gray}${text}${ANSI.reset}`,
    reset: (text: string) => `${ANSI.reset}${text}`,
  };
}

/**
 * Create a sandboxed filesystem interface.
 * All paths are resolved relative to the current working directory.
 */
function createSandboxFS(vfs: InMemoryVFS): SandboxFS {
  return {
    read: (path: string) => vfs.read(vfs.resolve(path)),
    write: (path: string, content: string) => vfs.write(vfs.resolve(path), content),
    append: (path: string, content: string) => vfs.append(vfs.resolve(path), content),
    exists: (path: string) => vfs.exists(vfs.resolve(path)),
    list: (path: string) => vfs.list(vfs.resolve(path)),
    mkdir: (path: string) => vfs.mkdir(vfs.resolve(path), true),
    remove: (path: string) => vfs.remove(vfs.resolve(path), true),
    stat: (path: string) => {
      const node = vfs.stat(vfs.resolve(path));
      return { type: node.type, name: node.name };
    },
    cwd: () => vfs.cwd(),
    resolve: (path: string) => vfs.resolve(path),
    isFile: (path: string) => vfs.isFile(vfs.resolve(path)),
    isDirectory: (path: string) => vfs.isDirectory(vfs.resolve(path)),
  };
}

/**
 * Get the TronOS proxy URL for a given URL.
 * Routes requests through the TronOS server to bypass CORS restrictions.
 */
function getProxyUrl(url: string): string {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const proxyBase = isLocalhost
    ? `http://${window.location.hostname}:3000/api/proxy`
    : `${window.location.origin}/api/proxy`;

  return `${proxyBase}?url=${encodeURIComponent(url)}`;
}

/**
 * Create a sandboxed network interface.
 */
function createSandboxNet(): SandboxNet {
  return {
    fetch: (url: string, options?: RequestInit) => {
      // Use the browser's native fetch
      return fetch(url, options);
    },
    proxyFetch: (url: string, options?: RequestInit) => {
      // Route through TronOS proxy for external APIs that don't support CORS
      const proxyUrl = getProxyUrl(url);
      return fetch(proxyUrl, options);
    },
  };
}

/**
 * Create a sandboxed timewarp (versioning) interface.
 * Provides access to file version history.
 */
function createSandboxTimewarp(vfs: InMemoryVFS): SandboxTimewarp {
  return {
    list: async (path: string): Promise<SandboxFileVersion[]> => {
      const resolvedPath = vfs.resolve(path);
      const namespace = getActiveSession().fsNamespace;
      const versions = await getFileVersions(namespace, resolvedPath);
      return versions.map((v) => ({
        id: v.id,
        timestamp: v.timestamp,
        author: v.author,
        branch: v.branchName,
        message: v.message,
      }));
    },

    getVersion: async (path: string, versionId: string): Promise<string | null> => {
      const resolvedPath = vfs.resolve(path);
      const namespace = getActiveSession().fsNamespace;
      const versions = await getFileVersions(namespace, resolvedPath);
      const version = versions.find((v) => v.id.startsWith(versionId));
      if (!version) {
        return null;
      }
      const fullVersion = await getVersion(version.id);
      return fullVersion?.content || null;
    },

    save: async (path: string, message?: string): Promise<SandboxFileVersion> => {
      const resolvedPath = vfs.resolve(path);
      const namespace = getActiveSession().fsNamespace;
      const content = vfs.readSync(resolvedPath);
      const version = await saveVersion(namespace, resolvedPath, content, {
        message,
        author: "exe",
      });
      return {
        id: version.id,
        timestamp: version.timestamp,
        author: version.author,
        branch: version.branchName,
        message: version.message,
      };
    },

    hasHistory: async (path: string): Promise<boolean> => {
      const resolvedPath = vfs.resolve(path);
      const namespace = getActiveSession().fsNamespace;
      return hasVersionHistory(namespace, resolvedPath);
    },
  };
}

/**
 * Create a sandboxed config interface for package configuration access.
 * If no packageName is provided, returns a no-op interface that returns undefined.
 */
function createSandboxConfig(ctx: ExecutionContext, packageName?: string): SandboxConfig {
  if (!packageName) {
    // No package context - return a no-op interface
    return {
      get: () => undefined,
      set: () => false,
    };
  }

  return {
    get: (key: string) => {
      return getPackageConfigValue(packageName, key, ctx);
    },
    set: (key: string, value: string | number | boolean) => {
      return setPackageConfigValue(packageName, key, value, ctx);
    },
  };
}

/**
 * Type for the command executor function passed to the sandbox.
 * This allows executables to run shell commands.
 */
export type CommandExecutor = (command: string) => Promise<CommandResult>;

/**
 * Options for creating a sandboxed Terminal API.
 */
export interface SandboxOptions {
  /** Package name for config access (when running as an installed package) */
  packageName?: string;
}

/**
 * Create a sandboxed Terminal API for .trx execution.
 *
 * This is the main factory function that creates the `t` parameter
 * passed to executable programs. The sandbox provides controlled
 * access to terminal, filesystem, and network functionality.
 *
 * @param ctx - The execution context with env, vfs, terminal
 * @param args - Command line arguments passed to the executable
 * @param execCommand - Function to execute shell commands (for t.exec)
 * @param options - Optional configuration including package name for config access
 * @returns A sandboxed Terminal API (the `t` parameter)
 *
 * @example
 * // In an .trx file:
 * (async function(t) {
 *   t.writeln('Hello, ' + t.args[0]);
 *   t.writeln('Current directory: ' + t.cwd);
 *
 *   // Use filesystem
 *   const content = await t.fs.read('file.txt');
 *
 *   // Use styling
 *   t.writeln(t.style.green('Success!'));
 *
 *   // Access package config
 *   const apiKey = t.config.get('apiKey');
 *
 *   t.exit(0);
 * })
 */
export function createSandboxTerminalAPI(
  ctx: ExecutionContext,
  args: string[],
  execCommand: CommandExecutor,
  options: SandboxOptions = {}
): SandboxTerminalAPI {
  const terminal = ctx.terminal;
  const vfs = ctx.vfs!;

  // Create output buffer for non-terminal contexts (testing)
  let outputBuffer = '';

  const api: SandboxTerminalAPI = {
    // Output methods
    write: (text: string) => {
      if (terminal?.write) {
        terminal.write(text);
      } else {
        outputBuffer += text;
      }
    },

    writeln: (text: string) => {
      if (terminal?.writeln) {
        terminal.writeln(text);
      } else {
        outputBuffer += text + '\n';
      }
    },

    clear: () => {
      if (terminal?.clear) {
        terminal.clear();
      }
    },

    clearLine: () => {
      if (terminal?.clearLine) {
        terminal.clearLine();
      }
    },

    // Cursor control
    moveTo: (x: number, y: number) => {
      if (terminal?.moveTo) {
        terminal.moveTo(x, y);
      }
    },

    moveBy: (dx: number, dy: number) => {
      if (terminal?.moveBy) {
        terminal.moveBy(dx, dy);
      }
    },

    getCursor: () => {
      if (terminal?.getCursor) {
        return terminal.getCursor();
      }
      return { x: 0, y: 0 };
    },

    getSize: () => {
      if (terminal?.getSize) {
        return terminal.getSize();
      }
      // Default size for testing/non-terminal environments
      return { cols: 80, rows: 24 };
    },

    // Input methods
    readLine: (prompt?: string): Promise<string> => {
      return new Promise((resolve) => {
        if (!terminal?.onKey) {
          // No terminal - return empty string immediately
          resolve('');
          return;
        }

        let line = '';
        let cursorPos = 0; // Track cursor position within line
        if (prompt) {
          terminal.write(prompt);
        }

        // Helper to redraw line with cursor at correct position
        const redrawLine = () => {
          // Clear line, redraw prompt and current input
          terminal.write(`\x1b[2K\r${prompt || ''}${line}`);
          // Move cursor back if not at end
          if (cursorPos < line.length) {
            terminal.write(`\x1b[${line.length - cursorPos}D`);
          }
        };

        // Handle pasted text from onData event
        // xterm.js sends multi-character strings when text is pasted
        let dataDisposable: { dispose: () => void } | null = null;
        if (terminal.onData) {
          dataDisposable = terminal.onData((data: string) => {
            // Multi-character data is likely pasted text
            if (data.length > 1) {
              // Filter out newlines and sanitize
              const sanitized = data.replace(/[\r\n]+/g, ' ').trim();
              if (sanitized) {
                // Insert at cursor position
                line = line.slice(0, cursorPos) + sanitized + line.slice(cursorPos);
                cursorPos += sanitized.length;
                redrawLine();
              }
            }
          });
        }

        const disposable = terminal.onKey((key: KeyEvent) => {
          if (key.key === '\r') {
            // Enter - return the line
            disposable.dispose();
            if (dataDisposable) dataDisposable.dispose();
            terminal.writeln('');
            resolve(line);
          } else if (key.key === '\u007f') {
            // Backspace
            if (cursorPos > 0) {
              line = line.slice(0, cursorPos - 1) + line.slice(cursorPos);
              cursorPos--;
              redrawLine();
            }
          } else if (key.key === '\x1b[D') {
            // Left arrow
            if (cursorPos > 0) {
              cursorPos--;
              terminal.write('\x1b[D');
            }
          } else if (key.key === '\x1b[C') {
            // Right arrow
            if (cursorPos < line.length) {
              cursorPos++;
              terminal.write('\x1b[C');
            }
          } else if (key.domEvent.ctrlKey) {
            // Handle Ctrl key combinations
            switch (key.domEvent.key.toLowerCase()) {
              case 'a': // Ctrl+A - Move to beginning
                if (cursorPos > 0) {
                  terminal.write(`\x1b[${cursorPos}D`);
                  cursorPos = 0;
                }
                break;
              case 'e': // Ctrl+E - Move to end
                if (cursorPos < line.length) {
                  terminal.write(`\x1b[${line.length - cursorPos}C`);
                  cursorPos = line.length;
                }
                break;
              case 'u': // Ctrl+U - Delete to beginning
                if (cursorPos > 0) {
                  line = line.slice(cursorPos);
                  cursorPos = 0;
                  redrawLine();
                }
                break;
              case 'k': // Ctrl+K - Delete to end
                if (cursorPos < line.length) {
                  line = line.slice(0, cursorPos);
                  redrawLine();
                }
                break;
              case 'c': // Ctrl+C - Return empty (cancel)
                disposable.dispose();
                if (dataDisposable) dataDisposable.dispose();
                terminal.writeln('^C');
                resolve('');
                break;
            }
          } else if (key.key.length === 1 && !key.domEvent.ctrlKey && !key.domEvent.altKey && !key.domEvent.metaKey) {
            // Printable character - insert at cursor position
            line = line.slice(0, cursorPos) + key.key + line.slice(cursorPos);
            cursorPos++;
            // If cursor is at end, just write the character
            if (cursorPos === line.length) {
              terminal.write(key.key);
            } else {
              // Otherwise, redraw from cursor position
              redrawLine();
            }
          }
        });
      });
    },

    readKey: (): Promise<{ key: string; domEvent?: KeyboardEvent }> => {
      return new Promise((resolve) => {
        if (!terminal?.onKey) {
          // No terminal - return empty key immediately
          resolve({ key: '' });
          return;
        }

        // Also listen for pasted text - return first character if pasted
        let dataDisposable: { dispose: () => void } | null = null;
        if (terminal.onData) {
          dataDisposable = terminal.onData((data: string) => {
            // If text is pasted, return the first character as a key
            if (data.length >= 1) {
              disposable.dispose();
              if (dataDisposable) dataDisposable.dispose();
              // Return first character of pasted text
              resolve({ key: data[0] });
            }
          });
        }

        const disposable = terminal.onKey((key: KeyEvent) => {
          disposable.dispose();
          if (dataDisposable) dataDisposable.dispose();
          resolve({ key: key.key, domEvent: key.domEvent });
        });
      });
    },

    readChar: (): Promise<string> => {
      return new Promise((resolve) => {
        if (!terminal?.onKey) {
          // No terminal - return empty string immediately
          resolve('');
          return;
        }

        const disposable = terminal.onKey((key: KeyEvent) => {
          // Only return printable characters (single character keys)
          if (key.key.length === 1 && !key.domEvent.ctrlKey && !key.domEvent.altKey && !key.domEvent.metaKey) {
            disposable.dispose();
            resolve(key.key);
          }
        });
      });
    },

    hasInput: () => {
      // This would require a more sophisticated implementation
      // For now, always return false (non-blocking check)
      return false;
    },

    // Style helpers
    style: createStyleHelpers(),

    // Context (read-only copies)
    args: [...args],
    env: { ...ctx.env },
    cwd: vfs.cwd(),

    // Control
    exit: (code: number = 0): never => {
      throw new ExitSignal(code);
    },

    sleep: (ms: number) => {
      return new Promise<void>(resolve => setTimeout(resolve, ms));
    },

    // Filesystem
    fs: createSandboxFS(vfs),

    // Network
    net: createSandboxNet(),

    // Package configuration
    config: createSandboxConfig(ctx, options.packageName),

    // Subprocess execution
    exec: async (command: string) => {
      return execCommand(command);
    },

    // System information
    system: {
      version: VERSION,
      versionString: VERSION_STRING,
    },

    // File versioning (timewarp)
    timewarp: createSandboxTimewarp(vfs),
  };

  return api;
}

/**
 * Get the output buffer from a sandbox API (for testing without terminal).
 * This is a helper for tests - the actual execution uses terminal output.
 */
export function getSandboxOutput(_api: SandboxTerminalAPI): string {
  // This is a hack for testing - in real use, output goes to terminal
  // We'd need to capture it differently in a real implementation
  return '';
}

/**
 * Check if a required feature is available.
 *
 * Used to validate .trx @requires metadata before execution.
 * Programs can declare required features in their header:
 * ```
 * // @requires: network, clipboard
 * ```
 *
 * @param feature - Feature name to check (network, clipboard, storage)
 * @returns True if the feature is available
 *
 * @example
 * if (!isFeatureAvailable('network')) {
 *   return { stdout: '', stderr: 'Network not available', exitCode: 1 };
 * }
 */
export function isFeatureAvailable(feature: string): boolean {
  switch (feature.toLowerCase()) {
    case 'network':
      return typeof fetch !== 'undefined';
    case 'clipboard':
      return typeof navigator !== 'undefined' && 'clipboard' in navigator;
    case 'storage':
      return typeof localStorage !== 'undefined' || typeof indexedDB !== 'undefined';
    default:
      // Unknown features should not be assumed available
      return false;
  }
}
