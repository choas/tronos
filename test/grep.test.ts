import { describe, it, expect, beforeEach } from 'vitest';
import { grep } from '../src/engine/builtins/filesystem.js';
import { type CommandContext } from '../src/engine/types.js';

describe('grep builtin command', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = {
      env: {
        PWD: '/home/tronos',
        HOME: '/home/tronos',
        PATH: '/bin:/usr/bin'
      },
      vfs: null
    };
  });

  it('should search for pattern in files', async () => {
    // Create a mock file system with test content
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => 'Hello world\nThis is a test\nAnother line with hello'
    };
    context.vfs = mockVFS as any;

    const result = await grep(['hello', 'test.txt'], context);
    
    expect(result.exitCode).toBe(0);
    // Should only match lowercase "hello" since we're doing case-sensitive search
    expect(result.stdout).toContain('hello');
    expect(result.stdout).not.toContain('world');
    expect(result.stdout).not.toContain('This is a test');
  });

  it('should support case insensitive search with -i flag', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => 'Hello WORLD\nhello world'
    };
    context.vfs = mockVFS as any;

    const result = await grep(['-i', 'hello', 'test.txt'], context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('WORLD');
    expect(result.stdout).toContain('world');
  });

  it('should show line numbers with -n flag', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => 'First line\nSecond line\nThird line'
    };
    context.vfs = mockVFS as any;

    const result = await grep(['-n', 'Second', 'test.txt'], context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('2:');
    expect(result.stdout).toContain('line');
  });

  it('should invert matches with -v flag', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => 'match this line\nDo not find this line\nAnother match'
    };
    context.vfs = mockVFS as any;

    const result = await grep(['-v', 'match', 'test.txt'], context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Do not find this line');
    expect(result.stdout).not.toContain('match this line');
    expect(result.stdout).not.toContain('Another match');
  });

  it('should support multiple combined flags', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => 'HELLO world\nhello again\nno match here'
    };
    context.vfs = mockVFS as any;

    const result = await grep(['-in', 'hello', 'test.txt'], context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('1:');
    expect(result.stdout).toContain('2:');
    expect(result.stdout).toContain('HELLO');
    expect(result.stdout).toContain('hello');
  });

  it('should handle multiple files and show filenames', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => {
        if (path === 'file1.txt') return 'Line with pattern\nOther line';
        if (path === 'file2.txt') return 'Different pattern line';
        return '';
      }
    };
    context.vfs = mockVFS as any;

    const result = await grep(['pattern', 'file1.txt', 'file2.txt'], context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('file1.txt:Line with');
    expect(result.stdout).toContain('file2.txt:Different');
  });

  it('should handle regular expressions', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => 'abc123def\ntest456ghi\nno numbers'
    };
    context.vfs = mockVFS as any;

    const result = await grep(['\\d+', 'test.txt'], context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('abc');
    expect(result.stdout).toContain('test');
    expect(result.stdout).not.toContain('no numbers');
  });

  it('should return exit code 1 when no matches found', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => 'No matching lines here'
    };
    context.vfs = mockVFS as any;

    const result = await grep(['pattern', 'test.txt'], context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('should handle missing files', async () => {
    const mockVFS = {
      exists: (path: string) => false,
      stat: (path: string) => ({ type: 'file' }),
      read: (path: string) => ''
    };
    context.vfs = mockVFS as any;

    const result = await grep(['pattern', 'missing.txt'], context);
    
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('No such file or directory');
  });

  it('should handle directories', async () => {
    const mockVFS = {
      exists: (path: string) => true,
      stat: (path: string) => ({ type: 'directory' }),
      read: (path: string) => ''
    };
    context.vfs = mockVFS as any;

    const result = await grep(['pattern', 'directory'], context);
    
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Is a directory');
  });

  it('should require pattern argument', async () => {
    const result = await grep([], context);
    
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('missing pattern');
  });

  it('should handle invalid regular expressions', async () => {
    const result = await grep(['[unclosed', 'test.txt'], context);
    
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid pattern');
  });
});