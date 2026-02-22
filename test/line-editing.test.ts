import { describe, it, expect, beforeEach } from 'vitest';
import ShellEngine from '../src/engine/shell';
import { TerminalAPI } from '../src/terminal/api';

class MockTerminal implements TerminalAPI {
  private output: string[] = [];
  private onKeyCallback?: (key: any) => void;
  private clearCalled = false;
  private selectedText = '';

  write(data: string): void {
    this.output.push(data);
  }

  writeln(data: string): void {
    this.output.push(data + '\n');
  }

  clear(): void {
    this.output = [];
    this.clearCalled = true;
  }

  onKey(callback: (key: any) => void): { dispose: () => void } {
    this.onKeyCallback = callback;
    return { dispose: () => { this.onKeyCallback = undefined; } };
  }

  onData(_callback: (data: string) => void): { dispose: () => void } {
    // Return a mock disposable
    return { dispose: () => {} };
  }

  hasSelection(): boolean {
    return this.selectedText.length > 0;
  }

  getSelection(): string {
    return this.selectedText;
  }

  clearSelection(): void {
    this.selectedText = '';
  }

  clearLine(): void {
    // No-op for tests
  }

  moveTo(_x: number, _y: number): void {
    // No-op for tests
  }

  moveBy(_dx: number, _dy: number): void {
    // No-op for tests
  }

  getCursor(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  hasInput(): boolean {
    return false;
  }

  flush(): void {
    // No-op for tests
  }

  dispose(): void {
    // No-op for tests
  }

  getOutput(): string {
    return this.output.join('');
  }

  clearOutput(): void {
    this.output = [];
    this.clearCalled = false;
  }

  wasClearCalled(): boolean {
    return this.clearCalled;
  }

  resetClearFlag(): void {
    this.clearCalled = false;
  }

  simulateKey(key: string, domEvent: Partial<KeyboardEvent> = {}): void {
    if (this.onKeyCallback) {
      this.onKeyCallback({
        key,
        domEvent: {
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          key: key,
          ...domEvent
        }
      });
    }
  }

  // Type a string character by character
  typeString(str: string): void {
    for (const char of str) {
      this.simulateKey(char, {});
    }
  }
}

describe('Line Editing Shortcuts', () => {
  let shell: ShellEngine;
  let term: MockTerminal;

  beforeEach(async () => {
    term = new MockTerminal();
    shell = new ShellEngine(term);
    await (shell as any).vfs.init();
  });

  describe('Ctrl+A - Move to beginning of line', () => {
    it('should move cursor to beginning of line', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('hello world');
      term.clearOutput();

      // Simulate Ctrl+A
      term.simulateKey('a', { ctrlKey: true, key: 'a' });

      const output = term.getOutput();
      // Should output cursor move left by 11 characters (length of "hello world")
      expect(output).toContain('\x1b[11D');
    });

    it('should do nothing when already at beginning', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Simulate Ctrl+A with empty input
      term.simulateKey('a', { ctrlKey: true, key: 'a' });

      const output = term.getOutput();
      // Should output nothing (no cursor movement needed)
      expect(output).toBe('');
    });

    it('should handle uppercase A with Ctrl', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      term.typeString('test');
      term.clearOutput();

      // Simulate Ctrl+A with uppercase A
      term.simulateKey('A', { ctrlKey: true, key: 'A' });

      const output = term.getOutput();
      expect(output).toContain('\x1b[4D');
    });
  });

  describe('Ctrl+E - Move to end of line', () => {
    it('should move cursor to end of line', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('hello');

      // Move cursor to beginning
      term.simulateKey('a', { ctrlKey: true, key: 'a' });
      term.clearOutput();

      // Simulate Ctrl+E
      term.simulateKey('e', { ctrlKey: true, key: 'e' });

      const output = term.getOutput();
      // Should output cursor move right by 5 characters (length of "hello")
      expect(output).toContain('\x1b[5C');
    });

    it('should do nothing when already at end', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text (cursor is already at end)
      term.typeString('test');
      term.clearOutput();

      // Simulate Ctrl+E
      term.simulateKey('e', { ctrlKey: true, key: 'e' });

      const output = term.getOutput();
      // Should output nothing (no cursor movement needed)
      expect(output).toBe('');
    });

    it('should handle uppercase E with Ctrl', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      term.typeString('abc');
      term.simulateKey('a', { ctrlKey: true, key: 'a' });
      term.clearOutput();

      // Simulate Ctrl+E with uppercase E
      term.simulateKey('E', { ctrlKey: true, key: 'E' });

      const output = term.getOutput();
      expect(output).toContain('\x1b[3C');
    });
  });

  describe('Ctrl+U - Delete to beginning of line', () => {
    it('should delete from cursor to beginning of line', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('hello world');
      term.clearOutput();

      // Simulate Ctrl+U
      term.simulateKey('u', { ctrlKey: true, key: 'u' });

      const output = term.getOutput();
      // Should redraw the line with cleared content (empty line at beginning)
      expect(output).toContain('\x1b[2K\r');
      // The prompt should be redrawn but without "hello world"
      expect(output).toContain('$');
    });

    it('should do nothing when cursor at beginning', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Simulate Ctrl+U with empty input
      term.simulateKey('u', { ctrlKey: true, key: 'u' });

      const output = term.getOutput();
      // Should output nothing
      expect(output).toBe('');
    });

    it('should delete only text before cursor', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('hello world');

      // Move cursor left 5 positions (to before "world")
      for (let i = 0; i < 5; i++) {
        term.simulateKey('\x1b[D', {}); // Left arrow
      }
      term.clearOutput();

      // Simulate Ctrl+U
      term.simulateKey('u', { ctrlKey: true, key: 'u' });

      const output = term.getOutput();
      // Should redraw with only "world" remaining
      expect(output).toContain('world');
      expect(output).not.toContain('hello');
    });

    it('should handle uppercase U with Ctrl', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      term.typeString('test');
      term.clearOutput();

      // Simulate Ctrl+U with uppercase U
      term.simulateKey('U', { ctrlKey: true, key: 'U' });

      const output = term.getOutput();
      expect(output).toContain('\x1b[2K\r');
    });
  });

  describe('Ctrl+K - Delete to end of line', () => {
    it('should delete from cursor to end of line', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('hello world');

      // Move cursor to beginning
      term.simulateKey('a', { ctrlKey: true, key: 'a' });
      term.clearOutput();

      // Simulate Ctrl+K
      term.simulateKey('k', { ctrlKey: true, key: 'k' });

      const output = term.getOutput();
      // Should redraw with empty line (all deleted)
      expect(output).toContain('\x1b[2K\r');
    });

    it('should do nothing when cursor at end', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text (cursor is at end)
      term.typeString('test');
      term.clearOutput();

      // Simulate Ctrl+K
      term.simulateKey('k', { ctrlKey: true, key: 'k' });

      const output = term.getOutput();
      // Should output nothing (nothing to delete)
      expect(output).toBe('');
    });

    it('should delete only text after cursor', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('hello world');

      // Move cursor left 6 positions (to after "hello")
      for (let i = 0; i < 6; i++) {
        term.simulateKey('\x1b[D', {}); // Left arrow
      }
      term.clearOutput();

      // Simulate Ctrl+K
      term.simulateKey('k', { ctrlKey: true, key: 'k' });

      const output = term.getOutput();
      // Should redraw with only "hello" remaining
      expect(output).toContain('hello');
      expect(output).not.toContain('world');
    });

    it('should handle uppercase K with Ctrl', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      term.typeString('abc');
      term.simulateKey('a', { ctrlKey: true, key: 'a' });
      term.clearOutput();

      // Simulate Ctrl+K with uppercase K
      term.simulateKey('K', { ctrlKey: true, key: 'K' });

      const output = term.getOutput();
      expect(output).toContain('\x1b[2K\r');
    });
  });

  describe('Arrow keys - Cursor navigation', () => {
    it('should move cursor left with left arrow', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('test');
      term.clearOutput();

      // Simulate left arrow
      term.simulateKey('\x1b[D', {});

      const output = term.getOutput();
      expect(output).toContain('\x1b[D');
    });

    it('should move cursor right with right arrow', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text and move to beginning
      term.typeString('test');
      term.simulateKey('a', { ctrlKey: true, key: 'a' });
      term.clearOutput();

      // Simulate right arrow
      term.simulateKey('\x1b[C', {});

      const output = term.getOutput();
      expect(output).toContain('\x1b[C');
    });

    it('should not move cursor left when at beginning', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Simulate left arrow with empty input
      term.simulateKey('\x1b[D', {});

      const output = term.getOutput();
      // Should output nothing
      expect(output).toBe('');
    });

    it('should not move cursor right when at end', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text (cursor is at end)
      term.typeString('test');
      term.clearOutput();

      // Simulate right arrow
      term.simulateKey('\x1b[C', {});

      const output = term.getOutput();
      // Should output nothing
      expect(output).toBe('');
    });
  });

  describe('Text insertion at cursor position', () => {
    it('should insert text at cursor position', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type "helloworld"
      term.typeString('helloworld');

      // Move cursor left 5 positions (to between "hello" and "world")
      for (let i = 0; i < 5; i++) {
        term.simulateKey('\x1b[D', {}); // Left arrow
      }
      term.clearOutput();

      // Insert a space
      term.simulateKey(' ', {});

      const output = term.getOutput();
      // Should redraw line with "hello world"
      expect(output).toContain('\x1b[2K\r');
      expect(output).toContain('hello world');
    });
  });

  describe('Backspace with cursor position', () => {
    it('should delete character before cursor', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type "hello"
      term.typeString('hello');

      // Move cursor left 2 positions (cursor after "hel")
      term.simulateKey('\x1b[D', {}); // Left arrow
      term.simulateKey('\x1b[D', {}); // Left arrow
      term.clearOutput();

      // Backspace (should delete 'l')
      term.simulateKey('\u007f', {}); // Backspace

      const output = term.getOutput();
      // Should redraw with "helo"
      expect(output).toContain('\x1b[2K\r');
      expect(output).toContain('helo');
    });

    it('should not delete when cursor at beginning', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type "test" and move to beginning
      term.typeString('test');
      term.simulateKey('a', { ctrlKey: true, key: 'a' });
      term.clearOutput();

      // Backspace at beginning
      term.simulateKey('\u007f', {});

      const output = term.getOutput();
      // Should output nothing (nothing to delete)
      expect(output).toBe('');
    });
  });

  describe('Combined operations', () => {
    it('should support Ctrl+A then Ctrl+K to delete entire line', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.typeString('delete this line');

      // Ctrl+A (move to beginning)
      term.simulateKey('a', { ctrlKey: true, key: 'a' });
      term.clearOutput();

      // Ctrl+K (delete to end)
      term.simulateKey('k', { ctrlKey: true, key: 'k' });

      const output = term.getOutput();
      // Should have an empty line (only prompt)
      expect(output).toContain('\x1b[2K\r');
      // Line should be cleared - prompt shown but no text after
      expect(output).toContain('$');
    });

    it('should support editing in middle of line', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type "cat file"
      term.typeString('cat file');

      // Move to beginning
      term.simulateKey('a', { ctrlKey: true, key: 'a' });

      // Move right 4 characters (after "cat ")
      for (let i = 0; i < 4; i++) {
        term.simulateKey('\x1b[C', {});
      }
      term.clearOutput();

      // Insert "my"
      term.typeString('my');

      const output = term.getOutput();
      // Should show "cat myfile"
      expect(output).toContain('cat myfile');
    });
  });
});
