import { describe, it, expect } from 'vitest';
import { alias, unalias } from '../src/engine/builtins/alias';
import { expandAliases, tokenize } from '../src/engine/parser';
import type { ExecutionContext } from '../src/engine/types';

describe('alias builtin command', () => {
  it('should list all aliases when no args', async () => {
    const aliases = new Map([
      ['ll', 'ls -l'],
      ['la', 'ls -la']
    ]);
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await alias([], context);
    expect(result.stdout).toContain("alias la='ls -la'");
    expect(result.stdout).toContain("alias ll='ls -l'");
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should return empty output with no aliases', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias([], context);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should display a specific alias when queried', async () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await alias(['ll'], context);
    expect(result.stdout).toBe("alias ll='ls -l'");
    expect(result.exitCode).toBe(0);
  });

  it('should error when querying non-existent alias', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias(['nosuchalias'], context);
    expect(result.stderr).toContain('nosuchalias: not found');
    expect(result.exitCode).toBe(1);
  });

  it('should set alias with name=command format', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias(['ll=ls -l'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).aliasRequests).toEqual([
      { action: 'add', name: 'll', command: 'ls -l' }
    ]);
  });

  it('should set alias with name=\'command\' format', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias(["ll='ls -l'"], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).aliasRequests).toEqual([
      { action: 'add', name: 'll', command: 'ls -l' }
    ]);
  });

  it('should handle multiple alias definitions', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias(['ll=ls -l', 'la=ls -la'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).aliasRequests).toEqual([
      { action: 'add', name: 'll', command: 'ls -l' },
      { action: 'add', name: 'la', command: 'ls -la' }
    ]);
  });

  it('should reject invalid alias names', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias(['123invalid=command'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid alias name');
  });

  it('should accept alias names with hyphens', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias(['my-alias=echo hello'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).aliasRequests).toEqual([
      { action: 'add', name: 'my-alias', command: 'echo hello' }
    ]);
  });

  it('should accept alias names starting with underscore', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await alias(['_private=echo secret'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).aliasRequests).toEqual([
      { action: 'add', name: '_private', command: 'echo secret' }
    ]);
  });

  it('should sort aliases alphabetically when listing', async () => {
    const aliases = new Map([
      ['zebra', 'echo z'],
      ['apple', 'echo a'],
      ['mango', 'echo m']
    ]);
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await alias([], context);
    const lines = result.stdout.split('\n');
    expect(lines[0]).toContain('apple');
    expect(lines[1]).toContain('mango');
    expect(lines[2]).toContain('zebra');
  });
});

describe('unalias builtin command', () => {
  it('should remove a single alias', async () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await unalias(['ll'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).unaliasRequests).toEqual([
      { action: 'remove', name: 'll' }
    ]);
  });

  it('should remove multiple aliases', async () => {
    const aliases = new Map([
      ['ll', 'ls -l'],
      ['la', 'ls -la']
    ]);
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await unalias(['ll', 'la'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).unaliasRequests).toEqual([
      { action: 'remove', name: 'll' },
      { action: 'remove', name: 'la' }
    ]);
  });

  it('should remove all aliases with -a flag', async () => {
    const aliases = new Map([
      ['ll', 'ls -l'],
      ['la', 'ls -la']
    ]);
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases
    };
    const result = await unalias(['-a'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).unaliasRequests).toEqual([
      { action: 'removeAll' }
    ]);
  });

  it('should error when unaliasing non-existent alias', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await unalias(['nosuchalias'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('nosuchalias: not found');
  });

  it('should error with no arguments', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await unalias([], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('usage');
  });

  it('should reject invalid alias names', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {},
      aliases: new Map()
    };
    const result = await unalias(['123invalid'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid alias name');
  });
});

describe('expandAliases function', () => {
  it('should expand alias in command position', () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const tokens = tokenize('ll /tmp');
    const result = expandAliases(tokens, aliases);
    expect(result.map(t => t.value)).toEqual(['ls', '-l', '/tmp']);
  });

  it('should not expand aliases in argument position', () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const tokens = tokenize('echo ll');
    const result = expandAliases(tokens, aliases);
    expect(result.map(t => t.value)).toEqual(['echo', 'll']);
  });

  it('should expand aliases after pipe', () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const tokens = tokenize('echo test | ll');
    const result = expandAliases(tokens, aliases);
    expect(result.map(t => t.value)).toEqual(['echo', 'test', '|', 'ls', '-l']);
  });

  it('should expand aliases after semicolon', () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const tokens = tokenize('echo test; ll');
    const result = expandAliases(tokens, aliases);
    expect(result.map(t => t.value)).toEqual(['echo', 'test', ';', 'ls', '-l']);
  });

  it('should expand aliases after &&', () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const tokens = tokenize('true && ll');
    const result = expandAliases(tokens, aliases);
    expect(result.map(t => t.value)).toEqual(['true', '&&', 'ls', '-l']);
  });

  it('should expand aliases after ||', () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const tokens = tokenize('false || ll');
    const result = expandAliases(tokens, aliases);
    expect(result.map(t => t.value)).toEqual(['false', '||', 'ls', '-l']);
  });

  it('should handle empty tokens', () => {
    const aliases = new Map([['ll', 'ls -l']]);
    const result = expandAliases([], aliases);
    expect(result).toEqual([]);
  });

  it('should handle empty aliases', () => {
    const aliases = new Map<string, string>();
    const tokens = tokenize('ll /tmp');
    const result = expandAliases(tokens, aliases);
    expect(result.map(t => t.value)).toEqual(['ll', '/tmp']);
  });

  it('should prevent infinite recursion', () => {
    const aliases = new Map([['ll', 'll -a']]); // Self-referential alias
    const tokens = tokenize('ll');
    const result = expandAliases(tokens, aliases);
    // Should expand once but not recursively
    expect(result.map(t => t.value)).toEqual(['ll', '-a']);
  });

  it('should handle chained alias expansion', () => {
    const aliases = new Map([
      ['l', 'ls'],
      ['ll', 'l -l']
    ]);
    const tokens = tokenize('ll');
    const result = expandAliases(tokens, aliases);
    // ll -> l -l -> ls -l
    expect(result.map(t => t.value)).toEqual(['ls', '-l']);
  });
});
