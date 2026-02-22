import type { Terminal } from '@xterm/xterm';

/**
 * TerminalWriteBuffer provides batched, optimized writes to xterm.js
 * Uses requestAnimationFrame to batch multiple writes into a single render frame
 */
export class TerminalWriteBuffer {
  private buffer: string[] = [];
  private rafId: number | null = null;
  private term: Terminal;
  private flushCallback: (() => void) | null = null;

  constructor(term: Terminal) {
    this.term = term;
  }

  /**
   * Queue data to be written to the terminal
   * Writes are batched and flushed on the next animation frame
   */
  write(data: string): void {
    this.buffer.push(data);
    this.scheduleFlush();
  }

  /**
   * Queue data with a newline to be written to the terminal
   */
  writeln(data: string): void {
    this.buffer.push(data + '\n');
    this.scheduleFlush();
  }

  /**
   * Schedule a flush on the next animation frame
   * If already scheduled, this is a no-op
   */
  private scheduleFlush(): void {
    if (this.rafId !== null) {
      return;
    }

    // Use requestAnimationFrame for browser environment
    // Fall back to setTimeout for test/node environments
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => this.flush());
    } else {
      this.rafId = setTimeout(() => this.flush(), 0) as unknown as number;
    }
  }

  /**
   * Immediately flush all buffered writes to the terminal
   */
  flush(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.rafId);
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }

    if (this.buffer.length === 0) {
      return;
    }

    // Concatenate all buffered writes into a single write call
    const data = this.buffer.join('');
    this.buffer = [];

    // Write to terminal in one operation
    this.term.write(data);

    // Call flush callback if registered
    if (this.flushCallback) {
      this.flushCallback();
    }
  }

  /**
   * Check if there are pending writes in the buffer
   */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Get the number of pending writes
   */
  getPendingCount(): number {
    return this.buffer.length;
  }

  /**
   * Register a callback to be called after each flush
   * Useful for testing or debugging
   */
  onFlush(callback: () => void): void {
    this.flushCallback = callback;
  }

  /**
   * Clear the flush callback
   */
  clearOnFlush(): void {
    this.flushCallback = null;
  }

  /**
   * Cancel any pending flush and clear the buffer
   */
  cancel(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.rafId);
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }
    this.buffer = [];
  }

  /**
   * Dispose of the buffer and cancel any pending operations
   */
  dispose(): void {
    this.cancel();
    this.flushCallback = null;
  }
}

/**
 * Create a new TerminalWriteBuffer for the given terminal
 */
export function createWriteBuffer(term: Terminal): TerminalWriteBuffer {
  return new TerminalWriteBuffer(term);
}
