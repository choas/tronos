import type { TerminalAPI, KeyEvent } from '../../src/terminal/api';

/**
 * Creates a mock terminal for testing purposes.
 * Records all writes and provides a way to inspect output.
 */
export function createMockTerminal(): TerminalAPI & { output: string[]; getOutput: () => string } {
  const output: string[] = [];

  return {
    output,
    getOutput: () => output.join(''),
    write: (data: string) => {
      output.push(data);
    },
    writeln: (data: string) => {
      output.push(data + '\n');
    },
    clear: () => {
      output.length = 0;
    },
    clearLine: () => {
      // In a mock, just record this happened
    },
    moveTo: (_x: number, _y: number) => {
      // No-op for tests
    },
    moveBy: (_dx: number, _dy: number) => {
      // No-op for tests
    },
    getCursor: () => ({ x: 0, y: 0 }),
    getSize: () => ({ cols: 80, rows: 24 }),
    onKey: (_callback: (key: KeyEvent) => void) => {
      // Return a mock disposable
      return { dispose: () => {} };
    },
    onData: (_callback: (data: string) => void) => {
      // Return a mock disposable
      return { dispose: () => {} };
    },
    hasInput: () => false,
    hasSelection: () => false,
    getSelection: () => '',
    clearSelection: () => {},
    flush: () => {},
    dispose: () => {}
  };
}
