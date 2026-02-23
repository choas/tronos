/**
 * @fileoverview Node.js Terminal API adapter for CLI mode.
 *
 * This module provides a TerminalAPI implementation that uses Node.js
 * stdin/stdout instead of xterm.js. It enables AIOS to run in a terminal
 * environment via CLI.
 *
 * @module cli/terminal
 */

import type { TerminalAPI, KeyEvent } from '../terminal/api';

/**
 * Disposable interface for cleanup callbacks.
 */
interface Disposable {
  dispose(): void;
}

/**
 * Create a TerminalAPI implementation for Node.js CLI environment.
 *
 * This adapter translates between the xterm.js-style TerminalAPI interface
 * and Node.js stdin/stdout streams, enabling the shell engine to work
 * in a native terminal environment.
 *
 * @returns TerminalAPI interface for CLI environment
 *
 * @example
 * const terminalApi = createNodeTerminalAPI();
 * const shell = new ShellEngine(terminalApi);
 * await shell.boot();
 */
export const createNodeTerminalAPI = (): TerminalAPI => {
  // Enable raw mode for reading individual keystrokes
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  // Track cursor position (approximate - reset on clear)
  let cursorX = 0;
  let cursorY = 0;

  // Key and data handlers
  const keyHandlers: Set<(key: KeyEvent) => void> = new Set();
  const dataHandlers: Set<(data: string) => void> = new Set();

  // Set up input handling
  // Matches xterm.js behavior: onData for pasted text, onKey for individual keypresses
  process.stdin.on('data', (chunk: string) => {
    if (chunk.length > 1 && !chunk.startsWith('\x1b')) {
      // Multi-char non-escape input = pasted text → only call data handlers
      for (const handler of dataHandlers) {
        handler(chunk);
      }
    } else {
      // Single char or escape sequence = keypress → only call key handlers
      for (const handler of keyHandlers) {
        const keyEvent = parseInputToKeyEvent(chunk);
        handler(keyEvent);
      }
    }
  });

  /**
   * Parse raw terminal input into a KeyEvent object.
   * This handles escape sequences for special keys.
   */
  function parseInputToKeyEvent(input: string): KeyEvent {
    // Create a mock KeyboardEvent for compatibility
    const createMockDomEvent = (key: string, ctrl = false, alt = false, meta = false): KeyboardEvent => {
      return {
        key,
        ctrlKey: ctrl,
        altKey: alt,
        metaKey: meta,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as KeyboardEvent;
    };

    // Handle control characters
    if (input.length === 1) {
      const code = input.charCodeAt(0);

      // Tab (code 9 / Ctrl+I)
      if (code === 9) {
        return { key: '\t', domEvent: createMockDomEvent('Tab') };
      }

      // Escape (code 27)
      if (code === 27) {
        return { key: '\x1b', domEvent: createMockDomEvent('Escape') };
      }

      // Enter / Return (code 13)
      if (code === 13) {
        return { key: '\r', domEvent: createMockDomEvent('Enter') };
      }

      // Backspace (code 127)
      if (code === 127) {
        return { key: '\x7f', domEvent: createMockDomEvent('Backspace') };
      }

      // Ctrl+A to Ctrl+Z (codes 1-26)
      if (code >= 1 && code <= 26) {
        const letter = String.fromCharCode(code + 96); // Convert to lowercase letter
        return {
          key: input,
          domEvent: createMockDomEvent(letter, true),
        };
      }

      // Regular character
      return {
        key: input,
        domEvent: createMockDomEvent(input),
      };
    }

    // Handle escape sequences
    if (input.startsWith('\x1b[')) {
      // Arrow keys and other special sequences
      switch (input) {
        case '\x1b[A':
          return { key: '\x1b[A', domEvent: createMockDomEvent('ArrowUp') };
        case '\x1b[B':
          return { key: '\x1b[B', domEvent: createMockDomEvent('ArrowDown') };
        case '\x1b[C':
          return { key: '\x1b[C', domEvent: createMockDomEvent('ArrowRight') };
        case '\x1b[D':
          return { key: '\x1b[D', domEvent: createMockDomEvent('ArrowLeft') };
        case '\x1b[H':
          return { key: '\x1b[H', domEvent: createMockDomEvent('Home') };
        case '\x1b[F':
          return { key: '\x1b[F', domEvent: createMockDomEvent('End') };
        case '\x1b[3~':
          return { key: '\x1b[3~', domEvent: createMockDomEvent('Delete') };
        case '\x1b[5~':
          return { key: '\x1b[5~', domEvent: createMockDomEvent('PageUp') };
        case '\x1b[6~':
          return { key: '\x1b[6~', domEvent: createMockDomEvent('PageDown') };
      }
    }

    // Alt key combinations
    if (input.startsWith('\x1b') && input.length === 2) {
      return {
        key: input[1],
        domEvent: createMockDomEvent(input[1], false, true),
      };
    }

    // Default: return as-is
    return {
      key: input,
      domEvent: createMockDomEvent(input),
    };
  }

  return {
    write: (data: string) => {
      process.stdout.write(data);
      // Update cursor position estimate (simplified)
      const lines = data.split('\n');
      if (lines.length > 1) {
        cursorY += lines.length - 1;
        cursorX = lines[lines.length - 1].length;
      } else {
        cursorX += data.length;
      }
    },

    writeln: (data: string) => {
      process.stdout.write(data + '\n');
      cursorY++;
      cursorX = 0;
    },

    clear: () => {
      // ANSI escape sequence to clear screen and move cursor to home
      process.stdout.write('\x1b[2J\x1b[H');
      cursorX = 0;
      cursorY = 0;
    },

    clearLine: () => {
      // Clear current line and move to beginning
      process.stdout.write('\x1b[2K\r');
      cursorX = 0;
    },

    moveTo: (x: number, y: number) => {
      // ANSI escape sequence for absolute positioning (1-indexed)
      process.stdout.write(`\x1b[${y + 1};${x + 1}H`);
      cursorX = x;
      cursorY = y;
    },

    moveBy: (dx: number, dy: number) => {
      let cmd = '';
      if (dx > 0) {
        cmd += `\x1b[${dx}C`;
        cursorX += dx;
      } else if (dx < 0) {
        cmd += `\x1b[${-dx}D`;
        cursorX += dx;
      }
      if (dy > 0) {
        cmd += `\x1b[${dy}B`;
        cursorY += dy;
      } else if (dy < 0) {
        cmd += `\x1b[${-dy}A`;
        cursorY += dy;
      }
      if (cmd) {
        process.stdout.write(cmd);
      }
    },

    getCursor: () => {
      return { x: cursorX, y: cursorY };
    },

    getSize: () => {
      return {
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      };
    },

    onKey: (callback: (key: KeyEvent) => void): Disposable => {
      keyHandlers.add(callback);
      return {
        dispose: () => {
          keyHandlers.delete(callback);
        },
      };
    },

    onData: (callback: (data: string) => void): Disposable => {
      dataHandlers.add(callback);
      return {
        dispose: () => {
          dataHandlers.delete(callback);
        },
      };
    },

    hasInput: () => {
      return false;
    },

    hasSelection: () => {
      // No selection support in CLI mode
      return false;
    },

    getSelection: () => {
      // No selection support in CLI mode
      return '';
    },

    clearSelection: () => {
      // No-op in CLI mode
    },

    flush: () => {
      // Stdout is generally unbuffered for writes, but we can try to flush
      // No direct flush method, but writes are typically synchronous
    },

    dispose: () => {
      // Clean up: restore terminal state
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      keyHandlers.clear();
      dataHandlers.clear();
    },
  };
};

/**
 * Check if the current environment is Node.js CLI (not browser).
 *
 * @returns True if running in Node.js environment
 */
export const isNodeEnvironment = (): boolean => {
  return typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node !== 'undefined';
};

/**
 * Check if the current environment is a browser.
 *
 * @returns True if running in browser environment
 */
export const isBrowserEnvironment = (): boolean => {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
};
