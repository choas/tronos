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

  setSelection(text: string): void {
    this.selectedText = text;
  }

  // Additional TerminalAPI methods
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
}

describe('Global Keyboard Shortcuts', () => {
  let shell: ShellEngine;
  let term: MockTerminal;

  beforeEach(async () => {
    term = new MockTerminal();
    shell = new ShellEngine(term);
    await (shell as any).vfs.init();
  });

  describe('Ctrl+L - Clear Screen', () => {
    it('should clear screen when Ctrl+L is pressed', () => {
      // Start readLine to set up key handler
      const readLinePromise = (shell as any).readLine();
      term.clearOutput();
      term.resetClearFlag();

      // Simulate Ctrl+L
      term.simulateKey('l', { ctrlKey: true, key: 'l' });

      expect(term.wasClearCalled()).toBe(true);
    });

    it('should preserve current input after Ctrl+L', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Type some text
      term.simulateKey('h', {});
      term.simulateKey('e', {});
      term.simulateKey('l', {});
      term.simulateKey('l', {});
      term.simulateKey('o', {});

      // Clear output tracking
      term.clearOutput();
      term.resetClearFlag();

      // Simulate Ctrl+L
      term.simulateKey('l', { ctrlKey: true, key: 'l' });

      // Should clear and rewrite prompt with current input
      expect(term.wasClearCalled()).toBe(true);
      const output = term.getOutput();
      expect(output).toContain('hello');
    });
  });

  describe('Ctrl+C - Cancel Input', () => {
    it('should display ^C when Ctrl+C is pressed', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Simulate Ctrl+C
      term.simulateKey('c', { ctrlKey: true, key: 'c' });

      const output = term.getOutput();
      expect(output).toContain('^C');
    });

    it('should clear current input when Ctrl+C is pressed', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();

      // Type some text
      term.simulateKey('t', {});
      term.simulateKey('e', {});
      term.simulateKey('s', {});
      term.simulateKey('t', {});

      term.clearOutput();

      // Simulate Ctrl+C
      term.simulateKey('c', { ctrlKey: true, key: 'c' });

      // After ^C, should show a new prompt (empty line)
      const output = term.getOutput();
      expect(output).toContain('^C');
      expect(output).toContain('$'); // New prompt should appear
    });

    it('should display new prompt after Ctrl+C', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Simulate Ctrl+C
      term.simulateKey('c', { ctrlKey: true, key: 'c' });

      const output = term.getOutput();
      // Should show ^C, newline, and new prompt
      expect(output).toMatch(/\^C.*tronos@tronos/s);
    });
  });

  describe('Ctrl+D - Exit (if input empty)', () => {
    it('should display ^D when Ctrl+D is pressed with empty input', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Simulate Ctrl+D with empty input
      term.simulateKey('d', { ctrlKey: true, key: 'd' });

      const output = term.getOutput();
      expect(output).toContain('^D');
    });

    it('should display exit message when Ctrl+D is pressed with empty input', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Simulate Ctrl+D with empty input
      term.simulateKey('d', { ctrlKey: true, key: 'd' });

      const output = term.getOutput();
      expect(output).toContain('exit');
      // In CLI mode (test environment), Ctrl+D triggers exit
      // In browser mode, it would show "Use the browser tab close button to exit."
      expect((shell as any).exitRequested).toBe(true);
    });

    it('should do nothing when Ctrl+D is pressed with non-empty input', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();

      // Type some text
      term.simulateKey('t', {});
      term.simulateKey('e', {});
      term.simulateKey('s', {});
      term.simulateKey('t', {});

      term.clearOutput();

      // Simulate Ctrl+D with non-empty input
      term.simulateKey('d', { ctrlKey: true, key: 'd' });

      const output = term.getOutput();
      // Should not display ^D or exit message
      expect(output).not.toContain('^D');
      expect(output).not.toContain('exit');
    });
  });

  describe('Ctrl key modifier handling', () => {
    it('should not print character when Ctrl is held', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();

      // Try to type with Ctrl held (not a known shortcut)
      term.simulateKey('x', { ctrlKey: true, key: 'x' });

      const output = term.getOutput();
      // Should not print 'x' literally
      expect(output).not.toBe('x');
    });

    it('should handle uppercase keys with Ctrl', () => {
      // Start readLine to set up key handler
      (shell as any).readLine();
      term.clearOutput();
      term.resetClearFlag();

      // Simulate Ctrl+L with uppercase L (some keyboards might report this way)
      term.simulateKey('L', { ctrlKey: true, key: 'L' });

      expect(term.wasClearCalled()).toBe(true);
    });
  });
});
