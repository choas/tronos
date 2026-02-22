/**
 * @fileoverview Terminal API abstraction for xterm.js.
 *
 * This module provides a higher-level API for interacting with the terminal,
 * wrapping xterm.js with features like:
 * - Batched writes for optimal rendering performance
 * - Simplified cursor control
 * - ANSI escape sequence abstraction
 *
 * @module terminal/api
 */

import { Terminal } from '@xterm/xterm';
import type { IDisposable } from '@xterm/xterm';
import { TerminalWriteBuffer } from './buffer';

/**
 * Keyboard event passed to key handlers.
 *
 * @property key - The key character or escape sequence
 * @property domEvent - The underlying DOM KeyboardEvent
 */
export interface KeyEvent {
  key: string;
  domEvent: KeyboardEvent;
}

/**
 * High-level terminal API interface.
 *
 * Provides methods for:
 * - Output: write(), writeln(), clear(), clearLine()
 * - Cursor control: moveTo(), moveBy(), getCursor()
 * - Input handling: onKey(), hasInput()
 * - Selection: hasSelection(), getSelection(), clearSelection()
 * - Buffer management: flush(), dispose()
 */
export interface TerminalAPI {
  /** Write text to the terminal (no newline) */
  write: (data: string) => void;
  /** Write text followed by a newline */
  writeln: (data: string) => void;
  /** Clear the entire terminal screen */
  clear: () => void;
  /** Clear the current line and move cursor to beginning */
  clearLine: () => void;
  /** Move cursor to absolute position (0-indexed) */
  moveTo: (x: number, y: number) => void;
  /** Move cursor by relative offset */
  moveBy: (dx: number, dy: number) => void;
  /** Get current cursor position (0-indexed) */
  getCursor: () => { x: number; y: number };
  /** Get terminal size in columns and rows */
  getSize: () => { cols: number; rows: number };
  /** Register a key event handler, returns disposable to unregister */
  onKey: (callback: (key: KeyEvent) => void) => IDisposable;
  /** Register a data event handler for receiving pasted text, returns disposable to unregister */
  onData: (callback: (data: string) => void) => IDisposable;
  /** Check if there's pending input (currently always returns false) */
  hasInput: () => boolean;
  /** Check if there's text currently selected in the terminal */
  hasSelection: () => boolean;
  /** Get the currently selected text, or empty string if none */
  getSelection: () => string;
  /** Clear the current text selection */
  clearSelection: () => void;
  /** Flush any pending buffered writes to the terminal */
  flush: () => void;
  /** Clean up resources (dispose write buffer) */
  dispose: () => void;
}

/**
 * Options for creating a TerminalAPI.
 *
 * @property batchWrites - Enable batched writes using requestAnimationFrame (default: true)
 */
export interface TerminalAPIOptions {
  batchWrites?: boolean;
}

/**
 * Create a TerminalAPI wrapper around an xterm.js Terminal instance.
 *
 * The wrapper provides performance optimization through batched writes,
 * collecting multiple write operations and flushing them in a single
 * requestAnimationFrame callback.
 *
 * @param term - The xterm.js Terminal instance to wrap
 * @param options - Configuration options (batchWrites defaults to true)
 * @returns TerminalAPI interface for interacting with the terminal
 *
 * @example
 * const terminal = new Terminal();
 * const api = createTerminalAPI(terminal);
 *
 * api.writeln('Hello, world!');
 * api.moveTo(0, 5);
 * api.write('Cursor at row 5');
 *
 * // Clean up when done
 * api.dispose();
 */
export const createTerminalAPI = (
  term: Terminal,
  options: TerminalAPIOptions = {}
): TerminalAPI => {
  const { batchWrites = true } = options;

  // Create write buffer for batched rendering
  const writeBuffer = batchWrites ? new TerminalWriteBuffer(term) : null;

  return {
    write: (data: string) => {
      if (writeBuffer) {
        writeBuffer.write(data);
      } else {
        term.write(data);
      }
    },
    writeln: (data: string) => {
      if (writeBuffer) {
        writeBuffer.writeln(data);
      } else {
        term.writeln(data);
      }
    },
    clear: () => {
      // Flush pending writes before clearing
      if (writeBuffer) {
        writeBuffer.flush();
      }
      term.clear();
    },
    clearLine: () => {
      if (writeBuffer) {
        writeBuffer.write('\x1b[2K\r');
      } else {
        term.write('\x1b[2K\r');
      }
    },
    moveTo: (x: number, y: number) => {
      const moveCmd = `\x1b[${y + 1};${x + 1}H`;
      if (writeBuffer) {
        writeBuffer.write(moveCmd);
      } else {
        term.write(moveCmd);
      }
    },
    moveBy: (dx: number, dy: number) => {
      let cmd = '';
      if (dx > 0) {
        cmd += `\x1b[${dx}C`;
      } else if (dx < 0) {
        cmd += `\x1b[${-dx}D`;
      }
      if (dy > 0) {
        cmd += `\x1b[${dy}B`;
      } else if (dy < 0) {
        cmd += `\x1b[${-dy}A`;
      }
      if (cmd) {
        if (writeBuffer) {
          writeBuffer.write(cmd);
        } else {
          term.write(cmd);
        }
      }
    },
    getCursor: () => {
      // Flush pending writes to ensure cursor position is accurate
      if (writeBuffer) {
        writeBuffer.flush();
      }
      return {
        x: term.buffer.active.cursorX,
        y: term.buffer.active.cursorY,
      };
    },
    getSize: () => {
      return {
        cols: term.cols,
        rows: term.rows,
      };
    },
    onKey: (callback: (key: KeyEvent) => void): IDisposable => {
      return term.onKey(callback);
    },
    onData: (callback: (data: string) => void): IDisposable => {
      return term.onData(callback);
    },
    hasInput: () => {
      return false;
    },
    hasSelection: () => {
      return term.hasSelection();
    },
    getSelection: () => {
      return term.getSelection();
    },
    clearSelection: () => {
      term.clearSelection();
    },
    flush: () => {
      if (writeBuffer) {
        writeBuffer.flush();
      }
    },
    dispose: () => {
      if (writeBuffer) {
        writeBuffer.dispose();
      }
    },
  };
};
