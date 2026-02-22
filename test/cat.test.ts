import { describe, it, expect } from 'vitest';
import { cat } from '../src/engine/builtins/filesystem';
import { InMemoryVFS } from '../src/vfs/memory';

describe('cat builtin', () => {
  it('should output stdin when no files provided and stdin is available', async () => {
    const result = await cat([], { stdin: '', env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('should output non-empty stdin when no files provided', async () => {
    const result = await cat([], { stdin: 'hello from stdin', env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello from stdin');
  });

  it('should read a single file using mock filesystem', async () => {
    const result = await cat(['/home/tronos/.profile'], { stdin: '', env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('export PATH=$PATH:/bin');
  });

  it('should read multiple files using mock filesystem', async () => {
    const result = await cat(['/home/tronos/.profile', '/bin/cat.trx'], { stdin: '', env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('==> /home/tronos/.profile <==');
    expect(result.stdout).toContain('==> /bin/cat.trx <==');
    expect(result.stdout).toContain('export PATH=$PATH:/bin');
    expect(result.stdout).toContain('# cat executable');
  });

  it('should handle non-existent file', async () => {
    const result = await cat(['/nonexistent'], { stdin: '', env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No such file or directory');
  });

  it('should handle directory as input', async () => {
    const result = await cat(['/home/tronos'], { stdin: '', env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Is a directory');
  });

  it('should work with VFS', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    vfs.write('/test.txt', 'Hello from VFS');
    
    const result = await cat(['/test.txt'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Hello from VFS');
  });

  it('should handle multiple files with VFS', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    vfs.write('/file1.txt', 'Content 1');
    vfs.write('/file2.txt', 'Content 2');
    
    const result = await cat(['/file1.txt', '/file2.txt'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('==> /file1.txt <==');
    expect(result.stdout).toContain('Content 1');
    expect(result.stdout).toContain('==> /file2.txt <==');
    expect(result.stdout).toContain('Content 2');
  });

  it('should handle VFS errors gracefully', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    
    const result = await cat(['/nonexistent.txt'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no such file or directory');
  });
});