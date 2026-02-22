import { describe, it, expect } from 'vitest';
import { mkdir, touch } from '../src/engine/builtins/filesystem';
import { InMemoryVFS } from '../src/vfs/memory';

describe('mkdir builtin', () => {
  it('should create a directory', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await mkdir(['testdir'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(vfs.exists('/testdir')).toBe(true);
    expect(vfs.isDirectory('/testdir')).toBe(true);
  });

  it('should create multiple directories', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await mkdir(['dir1', 'dir2'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(vfs.exists('/dir1')).toBe(true);
    expect(vfs.exists('/dir2')).toBe(true);
  });

  it('should support -p flag for parent creation', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await mkdir(['-p', '/path/to/nested/dir'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(vfs.exists('/path/to/nested/dir')).toBe(true);
  });

  it('should fail when directory already exists', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    await mkdir(['existing'], { stdin: '', env: {}, vfs });
    const result = await mkdir(['existing'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('file exists');
  });

  it('should fail without parent directories and no -p flag', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await mkdir(['/nonexistent/path'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no such file or directory');
  });

  it('should handle missing operand error', async () => {
    const result = await mkdir([], { stdin: '', env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('missing operand');
  });

  it('should handle invalid option', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await mkdir(['-x'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid option');
  });
});

describe('touch builtin', () => {
  it('should create empty file', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await touch(['newfile.txt'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(vfs.exists('/newfile.txt')).toBe(true);
    expect(vfs.isFile('/newfile.txt')).toBe(true);
    expect(vfs.read('/newfile.txt')).toBe('');
  });

  it('should update timestamp of existing file', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    vfs.write('/existing.txt', 'content');
    const originalTime = vfs.stat('/existing.txt').meta.updatedAt;
    
    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const result = await touch(['existing.txt'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(vfs.stat('/existing.txt').meta.updatedAt).toBeGreaterThan(originalTime);
  });

  it('should create multiple files', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await touch(['file1.txt', 'file2.txt'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(0);
    expect(vfs.exists('/file1.txt')).toBe(true);
    expect(vfs.exists('/file2.txt')).toBe(true);
  });

  it('should fail when trying to touch a directory', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    vfs.mkdir('/mydir');
    const result = await touch(['/mydir'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Is a directory');
  });

  it('should handle missing operand error', async () => {
    const result = await touch([], { stdin: '', env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('missing file operand');
  });

  it('should fail when parent directory does not exist', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    const result = await touch(['/nonexistent/file.txt'], { stdin: '', env: {}, vfs });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no such file or directory');
  });

  it('should work with mock filesystem (backward compatibility)', async () => {
    const result = await touch(['testfile'], { stdin: '', env: {} });
    expect(result.exitCode).toBe(0);
    // With mock filesystem, we can't verify creation since it's isolated per command
  });

  it('should work with mock filesystem mkdir (backward compatibility)', async () => {
    const result = await mkdir(['testdir'], { stdin: '', env: {} });
    expect(result.exitCode).toBe(0);
    // With mock filesystem, we can't verify creation since it's isolated per command
  });
});