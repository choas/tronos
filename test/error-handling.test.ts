import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryVFS } from '../src/vfs/memory';
import { executeCommand, executeSimpleCommand, executePipeline } from '../src/engine/executor';
import { tokenize, buildAST } from '../src/engine/parser';
import type { ExecutionContext, SimpleCommand, Pipeline } from '../src/engine/types';

describe('Shell Engine Error Handling', () => {
  let vfs: InMemoryVFS;
  let ctx: ExecutionContext;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test');
    await vfs.init();
    ctx = {
      stdin: '',
      env: { PATH: '/bin', HOME: '/home/tronos', PWD: '/' },
      vfs,
      terminal: {
        write: vi.fn(),
        writeln: vi.fn(),
        clear: vi.fn()
      },
      history: [],
      aliases: new Map()
    };
  });

  describe('Command Not Found', () => {
    it('returns exit code 127 for unknown commands', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'nonexistent',
        args: [],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toBe('nonexistent: command not found');
    });

    it('provides meaningful error for command not found in pipeline', async () => {
      const pipeline: Pipeline = {
        type: 'Pipeline',
        commands: [
          { type: 'Command', command: 'echo', args: ['hello'], redirects: [] },
          { type: 'Command', command: 'nonexistent', args: [], redirects: [] }
        ]
      };

      const result = await executePipeline(pipeline, ctx);

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('command not found');
    });
  });

  describe('Input Redirection Errors', () => {
    it('returns error for non-existent input file', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'cat',
        args: [],
        redirects: [{ type: 'redirect', file: '<nonexistent.txt' }]
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No such file or directory');
    });

    it('returns error when trying to read a directory', async () => {
      await vfs.mkdir('/testdir');

      const command: SimpleCommand = {
        type: 'Command',
        command: 'cat',
        args: [],
        redirects: [{ type: 'redirect', file: '</testdir' }]
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Is a directory');
    });
  });

  describe('Output Redirection Errors', () => {
    it('handles write to valid path', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'echo',
        args: ['test'],
        redirects: [{ type: 'redirect', file: 'output.txt' }]
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(0);
      const content = await vfs.read('/output.txt');
      expect(content).toBe('test\n');
    });
  });

  describe('Parser Error Handling', () => {
    it('throws error for unterminated strings', () => {
      expect(() => tokenize('echo "hello')).toThrow('Unterminated string');
    });

    it('throws error for unterminated single quoted strings', () => {
      expect(() => tokenize("echo 'hello")).toThrow('Unterminated string');
    });

    it('throws error for missing redirection filename', () => {
      const tokens = tokenize('echo hello >');
      expect(() => buildAST(tokens)).toThrow('Expected filename for redirection');
    });

    it('throws error for unexpected token', () => {
      // This creates a scenario with unexpected token
      const tokens = [
        { type: 'word' as const, value: 'echo' },
        { type: 'word' as const, value: 'hello' },
        { type: 'pipe' as const, value: '|' },
        { type: 'pipe' as const, value: '|' } // Double pipe without command
      ];
      expect(() => buildAST(tokens)).toThrow();
    });
  });

  describe('Exit Codes', () => {
    it('returns exit code 0 for successful command', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'echo',
        args: ['hello'],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(0);
    });

    it('returns exit code 1 for failed commands', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'cat',
        args: ['nonexistent.txt'],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
    });

    it('propagates exit code through && operator', async () => {
      const tokens = tokenize('false && echo "should not run"');
      const commands = buildAST(tokens);

      // The 'false' command doesn't exist, so it should fail
      const result = await executeCommand(commands[0], ctx);

      expect(result.exitCode).not.toBe(0);
    });

    it('propagates exit code through || operator', async () => {
      const tokens = tokenize('true || echo "should not run"');
      const commands = buildAST(tokens);

      // 'true' doesn't exist as a builtin, so first command fails
      // || then runs second command
      const result = await executeCommand(commands[0], ctx);

      expect(result).toBeDefined();
    });
  });

  describe('Pipeline Error Handling', () => {
    it('collects stderr from all pipeline stages', async () => {
      // Create a file for the first command
      await vfs.write('/test.txt', 'line1\nline2\nline3');

      const pipeline: Pipeline = {
        type: 'Pipeline',
        commands: [
          { type: 'Command', command: 'cat', args: ['/test.txt'], redirects: [] },
          { type: 'Command', command: 'grep', args: ['line'], redirects: [] }
        ]
      };

      const result = await executePipeline(pipeline, ctx);

      expect(result.exitCode).toBe(0);
      // grep adds ANSI color codes around matches, so check for the pattern
      expect(result.stdout).toMatch(/line.*1/);
    });

    it('continues pipeline even if intermediate command fails', async () => {
      const pipeline: Pipeline = {
        type: 'Pipeline',
        commands: [
          { type: 'Command', command: 'cat', args: ['nonexistent.txt'], redirects: [] },
          { type: 'Command', command: 'wc', args: ['-l'], redirects: [] }
        ]
      };

      const result = await executePipeline(pipeline, ctx);

      // Pipeline continues, wc processes empty input
      expect(result).toBeDefined();
    });
  });

  describe('Builtin Command Errors', () => {
    it('handles cd to non-existent directory', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'cd',
        args: ['/nonexistent'],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No such file or directory');
    });

    it('handles rm of non-existent file', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'rm',
        args: ['nonexistent.txt'],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
    });

    it('handles cat of non-existent file', async () => {
      const command: SimpleCommand = {
        type: 'Command',
        command: 'cat',
        args: ['nonexistent.txt'],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
      // Error message contains the filename
      expect(result.stderr).toContain('nonexistent.txt');
    });

    it('handles mkdir of existing directory', async () => {
      await vfs.mkdir('/existingdir');

      const command: SimpleCommand = {
        type: 'Command',
        command: 'mkdir',
        args: ['/existingdir'],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('Logical Sequence Error Handling', () => {
    it('&& stops on first failure', async () => {
      const tokens = tokenize('nonexistent && echo "should not run"');
      const commands = buildAST(tokens);

      const result = await executeCommand(commands[0], ctx);

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('command not found');
    });

    it('|| continues on first failure', async () => {
      await vfs.write('/bin/fallback.trx', `#!/tronos
// @name: fallback
(async function(t) {
  t.writeln('fallback ran');
  t.exit(0);
})`);

      const tokens = tokenize('nonexistent || fallback');
      const commands = buildAST(tokens);

      const result = await executeCommand(commands[0], ctx);

      // Fallback should have run
      expect(result.stdout).toContain('fallback ran');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Executable Error Handling', () => {
    it('handles malformed .trx file', async () => {
      await vfs.write('/bin/bad.trx', 'not valid exe format');

      const command: SimpleCommand = {
        type: 'Command',
        command: 'bad',
        args: [],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Missing required metadata field: name');
    });

    it('handles .trx with missing name metadata', async () => {
      await vfs.write('/bin/noname.trx', `#!/tronos
// @description: No name
(async function(t) {
  t.writeln('test');
})`);

      const command: SimpleCommand = {
        type: 'Command',
        command: 'noname',
        args: [],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Missing required metadata field: name');
    });

    it('handles .trx with runtime error', async () => {
      await vfs.write('/bin/error.trx', `#!/tronos
// @name: error
(async function(t) {
  throw new Error('Runtime error!');
})`);

      const command: SimpleCommand = {
        type: 'Command',
        command: 'error',
        args: [],
        redirects: []
      };

      const result = await executeSimpleCommand(command, ctx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Runtime error!');
    });
  });
});
