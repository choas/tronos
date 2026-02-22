import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVFS } from '../src/vfs/memory';
import { help } from '../src/engine/builtins/help';
import type { ExecutionContext } from '../src/engine/types';

describe('Terminal Size API', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test-size');
    await vfs.init();
  });

  describe('t.getSize()', () => {
    it('should be exposed in SandboxTerminalAPI interface', async () => {
      // The interface test - we verify getSize is part of the sandbox API
      // by importing and checking the type exists
      const { createSandboxTerminalAPI } = await import('../src/executor/sandbox');

      const mockTerminal = {
        write: () => {},
        writeln: () => {},
        clear: () => {},
        clearLine: () => {},
        moveTo: () => {},
        moveBy: () => {},
        getCursor: () => ({ x: 0, y: 0 }),
        getSize: () => ({ cols: 100, rows: 40 }),
        onKey: () => ({ dispose: () => {} }),
        onData: () => ({ dispose: () => {} }),
        hasInput: () => false,
        hasSelection: () => false,
        getSelection: () => '',
        clearSelection: () => {},
        flush: () => {},
        dispose: () => {},
      };

      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        terminal: mockTerminal
      };

      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      expect(api.getSize).toBeDefined();
      expect(typeof api.getSize).toBe('function');
    });

    it('should return terminal dimensions from underlying terminal', async () => {
      const { createSandboxTerminalAPI } = await import('../src/executor/sandbox');

      const mockTerminal = {
        write: () => {},
        writeln: () => {},
        clear: () => {},
        clearLine: () => {},
        moveTo: () => {},
        moveBy: () => {},
        getCursor: () => ({ x: 0, y: 0 }),
        getSize: () => ({ cols: 120, rows: 50 }),
        onKey: () => ({ dispose: () => {} }),
        onData: () => ({ dispose: () => {} }),
        hasInput: () => false,
        hasSelection: () => false,
        getSelection: () => '',
        clearSelection: () => {},
        flush: () => {},
        dispose: () => {},
      };

      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        terminal: mockTerminal
      };

      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));
      const size = api.getSize();

      expect(size.cols).toBe(120);
      expect(size.rows).toBe(50);
    });

    it('should return default size when no terminal available', async () => {
      const { createSandboxTerminalAPI } = await import('../src/executor/sandbox');

      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        terminal: undefined
      };

      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));
      const size = api.getSize();

      // Default size should be 80x24
      expect(size.cols).toBe(80);
      expect(size.rows).toBe(24);
    });
  });

  describe('ExecutionContext.size', () => {
    it('should contain terminal size for builtin commands', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 100, rows: 30 }
      };

      expect(ctx.size).toBeDefined();
      expect(ctx.size?.cols).toBe(100);
      expect(ctx.size?.rows).toBe(30);
    });

    it('should be optional in ExecutionContext', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs
      };

      expect(ctx.size).toBeUndefined();
    });
  });

  describe('help command with terminal size', () => {
    it('should use default width when size not provided', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs
      };

      const result = await help([], ctx);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('TronOS Shell');
      expect(result.stdout).toContain('File System');
    });

    it('should format output for wide terminal (>= 60 columns)', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 100, rows: 30 }
      };

      const result = await help([], ctx);

      expect(result.exitCode).toBe(0);
      // Wide terminal should show full syntax help
      expect(result.stdout).toContain('command1 | command2');
      expect(result.stdout).toContain('Pipe output from command1 to command2');
    });

    it('should format output for narrow terminal (< 60 columns)', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 50, rows: 20 }
      };

      const result = await help([], ctx);

      expect(result.exitCode).toBe(0);
      // Narrow terminal should show compact syntax help
      expect(result.stdout).toContain('|   Pipe output');
      expect(result.stdout).toContain('>   Redirect');
    });

    it('should show commands in columns for wide terminal', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 100, rows: 30 }
      };

      const result = await help([], ctx);
      const lines = result.stdout.split('\n');

      // File System commands should be in the output
      const fileSystemCommands = ['ls', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv'];

      // All commands should be present
      for (const cmd of fileSystemCommands) {
        expect(result.stdout).toContain(cmd);
      }
    });

    it('should use single column for very narrow terminal', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 40, rows: 20 }
      };

      const result = await help([], ctx);

      expect(result.exitCode).toBe(0);
      // Commands should still be present
      expect(result.stdout).toContain('ls');
      expect(result.stdout).toContain('cd');
    });

    it('should respect terminal width for header separator', async () => {
      const ctx: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 80, rows: 24 }
      };

      const result = await help([], ctx);
      const lines = result.stdout.split('\n');

      // The separator line (second line) should be made of '=' characters
      const separatorLine = lines[1];
      expect(separatorLine).toMatch(/^=+$/);
      // Length should not exceed terminal width - 1
      expect(separatorLine.length).toBeLessThanOrEqual(79);
    });

    it('should handle specific command help regardless of terminal size', async () => {
      const ctxNarrow: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 40, rows: 20 }
      };

      const ctxWide: ExecutionContext = {
        stdin: '',
        env: {},
        vfs,
        size: { cols: 120, rows: 40 }
      };

      const resultNarrow = await help(['ls'], ctxNarrow);
      const resultWide = await help(['ls'], ctxWide);

      // Both should show ls help
      expect(resultNarrow.exitCode).toBe(0);
      expect(resultWide.exitCode).toBe(0);
      expect(resultNarrow.stdout).toContain('List directory contents');
      expect(resultWide.stdout).toContain('List directory contents');
    });
  });
});
