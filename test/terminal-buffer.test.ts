import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalWriteBuffer, createWriteBuffer } from '../src/terminal/buffer';

// Mock Terminal class
class MockTerminal {
  output: string[] = [];

  write(data: string): void {
    this.output.push(data);
  }

  writeln(data: string): void {
    this.output.push(data + '\n');
  }

  getOutput(): string {
    return this.output.join('');
  }

  clear(): void {
    this.output = [];
  }
}

describe('TerminalWriteBuffer', () => {
  let mockTerm: MockTerminal;
  let buffer: TerminalWriteBuffer;

  beforeEach(() => {
    mockTerm = new MockTerminal();
    buffer = new TerminalWriteBuffer(mockTerm as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    buffer.dispose();
    vi.useRealTimers();
  });

  describe('write()', () => {
    it('should buffer writes instead of immediately writing', () => {
      buffer.write('hello');
      expect(mockTerm.output.length).toBe(0);
      expect(buffer.hasPending()).toBe(true);
    });

    it('should batch multiple writes together', () => {
      buffer.write('hello');
      buffer.write(' ');
      buffer.write('world');
      expect(mockTerm.output.length).toBe(0);
      expect(buffer.getPendingCount()).toBe(3);
    });
  });

  describe('writeln()', () => {
    it('should buffer writeln with newline', () => {
      buffer.writeln('hello');
      expect(mockTerm.output.length).toBe(0);
      expect(buffer.hasPending()).toBe(true);
    });

    it('should add newline to each writeln', () => {
      buffer.writeln('line1');
      buffer.writeln('line2');
      buffer.flush();
      expect(mockTerm.getOutput()).toBe('line1\nline2\n');
    });
  });

  describe('flush()', () => {
    it('should write all buffered content to terminal', () => {
      buffer.write('hello');
      buffer.write(' ');
      buffer.write('world');
      buffer.flush();
      expect(mockTerm.getOutput()).toBe('hello world');
    });

    it('should combine all writes into a single terminal write call', () => {
      buffer.write('a');
      buffer.write('b');
      buffer.write('c');
      buffer.flush();
      // All writes are combined into one write call
      expect(mockTerm.output.length).toBe(1);
      expect(mockTerm.output[0]).toBe('abc');
    });

    it('should clear the buffer after flushing', () => {
      buffer.write('hello');
      buffer.flush();
      expect(buffer.hasPending()).toBe(false);
      expect(buffer.getPendingCount()).toBe(0);
    });

    it('should do nothing when buffer is empty', () => {
      buffer.flush();
      expect(mockTerm.output.length).toBe(0);
    });

    it('should call onFlush callback', () => {
      const callback = vi.fn();
      buffer.onFlush(callback);
      buffer.write('test');
      buffer.flush();
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('automatic flush scheduling', () => {
    it('should schedule flush on setTimeout in test environment', () => {
      buffer.write('hello');

      // Not flushed yet
      expect(mockTerm.output.length).toBe(0);

      // Advance timers to trigger the scheduled flush
      vi.runAllTimers();

      // Now should be flushed
      expect(mockTerm.getOutput()).toBe('hello');
    });

    it('should batch writes within the same frame', () => {
      buffer.write('a');
      buffer.write('b');
      buffer.write('c');

      // All writes are still pending
      expect(mockTerm.output.length).toBe(0);

      // Advance timers
      vi.runAllTimers();

      // All combined into single write
      expect(mockTerm.output.length).toBe(1);
      expect(mockTerm.output[0]).toBe('abc');
    });

    it('should only schedule one flush for multiple writes', () => {
      const flushCallback = vi.fn();
      buffer.onFlush(flushCallback);

      buffer.write('a');
      buffer.write('b');
      buffer.write('c');

      vi.runAllTimers();

      // Only one flush should have occurred
      expect(flushCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasPending()', () => {
    it('should return false when buffer is empty', () => {
      expect(buffer.hasPending()).toBe(false);
    });

    it('should return true when buffer has content', () => {
      buffer.write('test');
      expect(buffer.hasPending()).toBe(true);
    });

    it('should return false after flush', () => {
      buffer.write('test');
      buffer.flush();
      expect(buffer.hasPending()).toBe(false);
    });
  });

  describe('getPendingCount()', () => {
    it('should return 0 when buffer is empty', () => {
      expect(buffer.getPendingCount()).toBe(0);
    });

    it('should return count of pending writes', () => {
      buffer.write('a');
      buffer.write('b');
      buffer.write('c');
      expect(buffer.getPendingCount()).toBe(3);
    });
  });

  describe('cancel()', () => {
    it('should clear pending buffer', () => {
      buffer.write('hello');
      buffer.write('world');
      buffer.cancel();
      expect(buffer.hasPending()).toBe(false);
      expect(buffer.getPendingCount()).toBe(0);
    });

    it('should prevent scheduled flush from occurring', () => {
      buffer.write('hello');
      buffer.cancel();
      vi.runAllTimers();
      expect(mockTerm.output.length).toBe(0);
    });
  });

  describe('dispose()', () => {
    it('should clear buffer and callbacks', () => {
      const callback = vi.fn();
      buffer.onFlush(callback);
      buffer.write('test');
      buffer.dispose();

      expect(buffer.hasPending()).toBe(false);

      // Callback should be cleared
      buffer.write('after dispose');
      buffer.flush();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('onFlush() / clearOnFlush()', () => {
    it('should call registered callback on flush', () => {
      const callback = vi.fn();
      buffer.onFlush(callback);
      buffer.write('test');
      buffer.flush();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should clear callback with clearOnFlush', () => {
      const callback = vi.fn();
      buffer.onFlush(callback);
      buffer.clearOnFlush();
      buffer.write('test');
      buffer.flush();
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe('createWriteBuffer', () => {
  it('should create a TerminalWriteBuffer instance', () => {
    const mockTerm = new MockTerminal();
    const buffer = createWriteBuffer(mockTerm as any);
    expect(buffer).toBeInstanceOf(TerminalWriteBuffer);
    buffer.dispose();
  });
});

describe('TerminalWriteBuffer performance', () => {
  let mockTerm: MockTerminal;
  let buffer: TerminalWriteBuffer;

  beforeEach(() => {
    mockTerm = new MockTerminal();
    buffer = new TerminalWriteBuffer(mockTerm as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    buffer.dispose();
    vi.useRealTimers();
  });

  it('should reduce terminal write calls for burst of writes', () => {
    // Simulate a burst of rapid writes (like streaming AI response)
    for (let i = 0; i < 100; i++) {
      buffer.write(`char${i}`);
    }

    // No writes to terminal yet
    expect(mockTerm.output.length).toBe(0);

    // Flush all
    vi.runAllTimers();

    // Only one write call to terminal
    expect(mockTerm.output.length).toBe(1);
    expect(buffer.getPendingCount()).toBe(0);
  });

  it('should preserve write order', () => {
    buffer.write('1');
    buffer.write('2');
    buffer.write('3');
    buffer.writeln('4');
    buffer.write('5');

    buffer.flush();

    expect(mockTerm.getOutput()).toBe('1234\n5');
  });
});
