import { describe, it, expect, beforeEach } from 'vitest';
import ShellEngine from '../src/engine/shell';
import { TerminalAPI } from '../src/terminal/api';

class MockTerminal implements TerminalAPI {
  private output: string[] = [];
  private onKeyCallback?: (key: any) => void;
  private selectedText = '';

  write(data: string): void {
    this.output.push(data);
  }

  writeln(data: string): void {
    this.output.push(data + '\n');
  }

  clear(): void {
    this.output = [];
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
  }

  simulateKey(key: string, domEvent = {}): void {
    if (this.onKeyCallback) {
      this.onKeyCallback({ key, domEvent });
    }
  }
}

describe('Tab Completion', () => {
  let shell: ShellEngine;
  let term: MockTerminal;

  beforeEach(async () => {
    term = new MockTerminal();
    shell = new ShellEngine(term);
    // Initialize VFS for tests that access filesystem
    await (shell as any).vfs.init();
  });

  it('should have access to private getCompletion method through execution', () => {
    // This test verifies that tab completion is integrated into the shell
    // We can't directly test the private method, but we verify the shell has the method
    expect(shell).toBeDefined();
    expect(typeof (shell as any).getCompletion).toBe('function');
  });

  it('should return completion for single match', () => {
    const completion = (shell as any).getCompletion('cd ho');
    expect(completion.type).toBe('complete');
    expect(completion.newLine).toBe('cd home');
  });

  it('should return multiple matches when ambiguous', () => {
    const completion = (shell as any).getCompletion('cd ');
    expect(completion.type).toBe('multiple');
    expect(completion.matches).toContain('home');
    expect(completion.matches).toContain('bin');
    expect(completion.matches).toContain('tmp');
    expect(completion.matches.length).toBeGreaterThan(1);
  });

  it('should return none when no matches', () => {
    const completion = (shell as any).getCompletion('cd nonexistent');
    expect(completion.type).toBe('none');
  });

  it('should complete partial filenames', () => {
    const completion = (shell as any).getCompletion('ls bi');
    expect(completion.type).toBe('complete');
    expect(completion.newLine).toBe('ls bin');
  });

  it('should handle empty input by showing all files', () => {
    const completion = (shell as any).getCompletion('');
    expect(completion.type).toBe('multiple');
    expect(completion.matches.length).toBeGreaterThan(0);
  });

  it('should preserve command when completing arguments', () => {
    const completion = (shell as any).getCompletion('cat ho');
    expect(completion.type).toBe('complete');
    expect(completion.newLine).toBe('cat home');
  });

  it('should handle multiple words and complete last word', () => {
    const completion = (shell as any).getCompletion('cp bin ho');
    expect(completion.type).toBe('complete');
    expect(completion.newLine).toBe('cp bin home');
  });
});
