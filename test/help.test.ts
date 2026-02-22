import { describe, it, expect } from 'vitest';
import { help } from '../src/engine/builtins/help';
import type { ExecutionContext } from '../src/engine/types';
import { InMemoryVFS } from '../src/vfs/memory';

describe('help builtin command', () => {
  it('should display general help with no arguments', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      size: { cols: 80, rows: 24 } // Provide terminal size
    };
    const result = await help([], context);
    expect(result.stdout).toContain('TronOS Shell - Available Commands');
    expect(result.stdout).toContain('Built-in commands:');
    expect(result.stdout).toContain('File System:');
    // Commands now formatted in columns, not comma-separated
    // Check that all File System commands are present
    for (const cmd of ['ls', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv']) {
      expect(result.stdout).toContain(cmd);
    }
    expect(result.stdout).toContain('Text Processing:');
    for (const cmd of ['echo', 'head', 'tail', 'grep', 'wc']) {
      expect(result.stdout).toContain(cmd);
    }
    expect(result.stdout).toContain('Environment:');
    for (const cmd of ['env', 'export', 'unset']) {
      expect(result.stdout).toContain(cmd);
    }
    expect(result.stdout).toContain('Shell:');
    for (const cmd of ['alias', 'unalias', 'which', 'type', 'clear', 'history', 'help']) {
      expect(result.stdout).toContain(cmd);
    }
    expect(result.stdout).toContain('Special syntax:');
    expect(result.stdout).toContain('command1 | command2');
    expect(result.stdout).toContain('AI Integration:');
    expect(result.stdout).toContain('@ai <request>');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should display help for specific builtin command', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await help(['ls'], context);
    expect(result.stdout).toContain('ls: List directory contents');
    expect(result.stdout).toContain('Usage: ls [-l] [-a] [-h] [path...]');
    expect(result.stdout).toContain('Examples:');
    expect(result.stdout).toContain('ls');
    expect(result.stdout).toContain('ls -la');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should display help for cd command', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await help(['cd'], context);
    expect(result.stdout).toContain('cd: Change the current directory');
    expect(result.stdout).toContain('Usage: cd [directory]');
    expect(result.stdout).toContain('Examples:');
    expect(result.stdout).toContain('cd ~');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should display help for alias command', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await help(['alias'], context);
    expect(result.stdout).toContain('alias: Define or display aliases');
    expect(result.stdout).toContain('Usage: alias [name[=value]]');
    expect(result.stdout).toContain('Examples:');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should display help for which command', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await help(['which'], context);
    expect(result.stdout).toContain('which: Show the full path or type of a command');
    expect(result.stdout).toContain('Usage: which command...');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should display help for help itself', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await help(['help'], context);
    expect(result.stdout).toContain('help: Display help information');
    expect(result.stdout).toContain('Usage: help [command]');
    expect(result.stdout).toContain('Examples:');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should return error for unknown command', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await help(['unknowncommand'], context);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe("help: no help topics match `unknowncommand'. Try 'help' for a list of commands.");
    expect(result.exitCode).toBe(1);
  });

  it('should display info for executable files in /bin', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    vfs.write('/bin/myprogram.trx', '#!/bin/js\nconsole.log("hello");');
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      vfs
    };
    const result = await help(['myprogram'], context);
    expect(result.stdout).toContain('myprogram: executable file at /bin/myprogram.trx');
    expect(result.stdout).toContain('Run "myprogram" to execute it');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle command without examples', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await help(['pwd'], context);
    expect(result.stdout).toContain('pwd: Print the current working directory');
    expect(result.stdout).toContain('Usage: pwd');
    expect(result.stdout).not.toContain('Examples:');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should display help for all categories of commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const commands = ['cat', 'echo', 'env', 'export', 'unset', 'alias', 'unalias', 'type', 'clear', 'history'];

    for (const cmd of commands) {
      const result = await help([cmd], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`${cmd}:`);
      expect(result.stdout).toContain('Usage:');
    }
  });
});
