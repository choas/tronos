import { describe, it, expect } from 'vitest';
import { which, type } from '../src/engine/builtins/which';
import type { ExecutionContext } from '../src/engine/types';
import { InMemoryVFS } from '../src/vfs/memory';

describe('which builtin command', () => {
  it('should identify builtin commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await which(['ls'], context);
    expect(result.stdout).toBe('ls: shell built-in command');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should identify multiple builtin commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await which(['cd', 'pwd', 'echo'], context);
    expect(result.stdout).toContain('cd: shell built-in command');
    expect(result.stdout).toContain('pwd: shell built-in command');
    expect(result.stdout).toContain('echo: shell built-in command');
    expect(result.exitCode).toBe(0);
  });

  it('should identify aliases', async () => {
    const aliases = new Map<string, string>();
    aliases.set('ll', 'ls -l');
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await which(['ll'], context);
    expect(result.stdout).toBe('ll: aliased to ls -l');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should identify executables in /bin', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    vfs.write('/bin/myprogram.trx', '#!/bin/js\nconsole.log("hello");');
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      vfs
    };
    const result = await which(['myprogram'], context);
    expect(result.stdout).toBe('/bin/myprogram.trx');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should return error for unknown commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await which(['unknowncommand'], context);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('which: unknowncommand: not found');
    expect(result.exitCode).toBe(1);
  });

  it('should handle mixed known and unknown commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await which(['ls', 'unknowncmd', 'pwd'], context);
    expect(result.stdout).toContain('ls: shell built-in command');
    expect(result.stdout).toContain('pwd: shell built-in command');
    expect(result.stderr).toBe('which: unknowncmd: not found');
    expect(result.exitCode).toBe(1);
  });

  it('should return empty output with no arguments', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await which([], context);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should prioritize aliases over builtins', async () => {
    const aliases = new Map<string, string>();
    aliases.set('ls', 'ls --color=auto');
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await which(['ls'], context);
    expect(result.stdout).toBe('ls: aliased to ls --color=auto');
    expect(result.exitCode).toBe(0);
  });
});

describe('type builtin command', () => {
  it('should identify builtin commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await type(['ls'], context);
    expect(result.stdout).toBe('ls is a shell builtin');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should identify multiple builtin commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await type(['cd', 'pwd', 'echo'], context);
    expect(result.stdout).toContain('cd is a shell builtin');
    expect(result.stdout).toContain('pwd is a shell builtin');
    expect(result.stdout).toContain('echo is a shell builtin');
    expect(result.exitCode).toBe(0);
  });

  it('should identify aliases with bash-style output', async () => {
    const aliases = new Map<string, string>();
    aliases.set('ll', 'ls -l');
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await type(['ll'], context);
    expect(result.stdout).toBe("ll is aliased to `ls -l'");
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should identify executables in /bin', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    vfs.write('/bin/myprogram.trx', '#!/bin/js\nconsole.log("hello");');
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      vfs
    };
    const result = await type(['myprogram'], context);
    expect(result.stdout).toBe('myprogram is /bin/myprogram.trx');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should return error for unknown commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await type(['unknowncommand'], context);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('-bash: type: unknowncommand: not found');
    expect(result.exitCode).toBe(1);
  });

  it('should handle mixed known and unknown commands', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await type(['ls', 'unknowncmd', 'pwd'], context);
    expect(result.stdout).toContain('ls is a shell builtin');
    expect(result.stdout).toContain('pwd is a shell builtin');
    expect(result.stderr).toBe('-bash: type: unknowncmd: not found');
    expect(result.exitCode).toBe(1);
  });

  it('should return error with usage message when no arguments', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await type([], context);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('type: usage: type name [name ...]');
    expect(result.exitCode).toBe(1);
  });

  it('should prioritize aliases over builtins', async () => {
    const aliases = new Map<string, string>();
    aliases.set('ls', 'ls --color=auto');
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await type(['ls'], context);
    expect(result.stdout).toBe("ls is aliased to `ls --color=auto'");
    expect(result.exitCode).toBe(0);
  });

  it('should identify which and type as builtins', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await type(['which', 'type'], context);
    expect(result.stdout).toContain('which is a shell builtin');
    expect(result.stdout).toContain('type is a shell builtin');
    expect(result.exitCode).toBe(0);
  });
});
