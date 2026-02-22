import { describe, it, expect } from 'vitest';
import { cd, pwd } from '../src/engine/builtins/filesystem';
import { InMemoryVFS } from '../src/vfs/memory';

describe('cd builtin', () => {
  it('should change to home directory with no arguments', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const context = { 
      stdin: '', 
      env: { HOME: '/home/tronos', PWD: '/' },
      vfs 
    };
    
    const result = await cd([], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).requestedCd).toBe('/home/tronos');
  });

  it('should expand ~ to home directory', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const context = { 
      stdin: '', 
      env: { HOME: '/home/tronos', PWD: '/' },
      vfs 
    };
    
    const result = await cd(['~'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).requestedCd).toBe('/home/tronos');
  });

  it('should expand ~/path to home subdirectory', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    // Create the target directory so cd can succeed
    await vfs.mkdir('/home/tronos/documents');
    const context = {
      stdin: '',
      env: { HOME: '/home/tronos', PWD: '/' },
      vfs
    };

    const result = await cd(['~/documents'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).requestedCd).toBe('/home/tronos/documents');
  });

  it('should handle absolute paths', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    // /tmp already exists in default VFS
    const context = {
      stdin: '',
      env: { HOME: '/home/tronos', PWD: '/' },
      vfs
    };

    const result = await cd(['/tmp'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).requestedCd).toBe('/tmp');
  });
});

describe('pwd builtin', () => {
  it('should print current working directory', async () => {
    const context = { 
      stdin: '', 
      env: { PWD: '/home/tronos' }
    };
    
    const result = await pwd([], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('/home/tronos');
    expect(result.stderr).toBe('');
  });

  it('should default to root if PWD not set', async () => {
    const context = { 
      stdin: '', 
      env: {}
    };
    
    const result = await pwd([], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('/');
    expect(result.stderr).toBe('');
  });
});