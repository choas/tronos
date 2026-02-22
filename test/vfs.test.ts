import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVFS } from '../src/vfs/memory';

describe('VFS File CRUD Operations', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  describe('write()', () => {
    it('should create a new file', () => {
      vfs.write('/test.txt', 'Hello, World!');
      expect(vfs.exists('/test.txt')).toBe(true);
      expect(vfs.isFile('/test.txt')).toBe(true);
    });

    it('should write content to a file', () => {
      vfs.write('/test.txt', 'Hello, World!');
      expect(vfs.read('/test.txt')).toBe('Hello, World!');
    });

    it('should overwrite existing file content', () => {
      vfs.write('/test.txt', 'Original content');
      vfs.write('/test.txt', 'New content');
      expect(vfs.read('/test.txt')).toBe('New content');
    });

    it('should handle empty content', () => {
      vfs.write('/empty.txt', '');
      expect(vfs.exists('/empty.txt')).toBe(true);
      expect(vfs.read('/empty.txt')).toBe('');
    });

    it('should handle multiline content', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      vfs.write('/multiline.txt', content);
      expect(vfs.read('/multiline.txt')).toBe(content);
    });

    it('should handle special characters', () => {
      const content = 'Special: @#$%^&*(){}[]|\\:";\'<>?,./~`';
      vfs.write('/special.txt', content);
      expect(vfs.read('/special.txt')).toBe(content);
    });

    it('should handle unicode content', () => {
      const content = 'Hello \u4e16\u754c \ud83d\ude00 \u00e9\u00e8\u00ea';
      vfs.write('/unicode.txt', content);
      expect(vfs.read('/unicode.txt')).toBe(content);
    });

    it('should throw error when parent directory does not exist', () => {
      expect(() => vfs.write('/nonexistent/file.txt', 'content'))
        .toThrow('no such file or directory');
    });

    it('should throw error when writing to a directory', () => {
      vfs.mkdir('/testdir');
      expect(() => vfs.write('/testdir', 'content'))
        .toThrow('not a file');
    });

    it('should update metadata on write', () => {
      vfs.write('/test.txt', 'content');
      const stat1 = vfs.stat('/test.txt');
      const originalTime = stat1.meta.updatedAt;

      // Wait a bit to ensure timestamp difference
      const start = Date.now();
      while (Date.now() - start < 5) { /* busy wait */ }

      vfs.write('/test.txt', 'new content');
      const stat2 = vfs.stat('/test.txt');
      expect(stat2.meta.updatedAt).toBeGreaterThanOrEqual(originalTime);
    });
  });

  describe('read()', () => {
    it('should read file content', () => {
      vfs.write('/test.txt', 'Hello, World!');
      expect(vfs.read('/test.txt')).toBe('Hello, World!');
    });

    it('should throw error for non-existent file', () => {
      expect(() => vfs.read('/nonexistent.txt'))
        .toThrow('no such file or directory');
    });

    it('should throw error when reading a directory', () => {
      vfs.mkdir('/testdir');
      expect(() => vfs.read('/testdir'))
        .toThrow('not a file');
    });

    it('should read default files', () => {
      expect(vfs.read('/etc/motd')).toContain('Welcome to TronOS');
    });

    it('should read nested file paths', () => {
      vfs.mkdir('/a/b/c', true);
      vfs.write('/a/b/c/file.txt', 'nested content');
      expect(vfs.read('/a/b/c/file.txt')).toBe('nested content');
    });
  });

  describe('append()', () => {
    it('should append to existing file', () => {
      vfs.write('/test.txt', 'Hello');
      vfs.append('/test.txt', ', World!');
      expect(vfs.read('/test.txt')).toBe('Hello, World!');
    });

    it('should create file if it does not exist', () => {
      vfs.append('/newfile.txt', 'content');
      expect(vfs.exists('/newfile.txt')).toBe(true);
      expect(vfs.read('/newfile.txt')).toBe('content');
    });

    it('should append empty string without changing content', () => {
      vfs.write('/test.txt', 'content');
      vfs.append('/test.txt', '');
      expect(vfs.read('/test.txt')).toBe('content');
    });

    it('should append multiline content', () => {
      vfs.write('/test.txt', 'Line 1');
      vfs.append('/test.txt', '\nLine 2\nLine 3');
      expect(vfs.read('/test.txt')).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should throw error when appending to a directory', () => {
      vfs.mkdir('/testdir');
      expect(() => vfs.append('/testdir', 'content'))
        .toThrow('not a file');
    });
  });

  describe('remove() for files', () => {
    it('should remove a file', () => {
      vfs.write('/test.txt', 'content');
      expect(vfs.exists('/test.txt')).toBe(true);
      vfs.remove('/test.txt');
      expect(vfs.exists('/test.txt')).toBe(false);
    });

    it('should throw error for non-existent file', () => {
      expect(() => vfs.remove('/nonexistent.txt'))
        .toThrow('no such file or directory');
    });

    it('should update parent directory children list', () => {
      vfs.write('/home/tronos/test.txt', 'content');
      expect(vfs.list('/home/tronos')).toContain('test.txt');
      vfs.remove('/home/tronos/test.txt');
      expect(vfs.list('/home/tronos')).not.toContain('test.txt');
    });
  });

  describe('exists()', () => {
    it('should return true for existing file', () => {
      vfs.write('/test.txt', 'content');
      expect(vfs.exists('/test.txt')).toBe(true);
    });

    it('should return true for existing directory', () => {
      expect(vfs.exists('/home')).toBe(true);
    });

    it('should return false for non-existent path', () => {
      expect(vfs.exists('/nonexistent')).toBe(false);
    });

    it('should return true for root', () => {
      expect(vfs.exists('/')).toBe(true);
    });
  });

  describe('isFile()', () => {
    it('should return true for files', () => {
      vfs.write('/test.txt', 'content');
      expect(vfs.isFile('/test.txt')).toBe(true);
    });

    it('should return false for directories', () => {
      expect(vfs.isFile('/home')).toBe(false);
    });

    it('should return false for non-existent paths', () => {
      expect(vfs.isFile('/nonexistent')).toBe(false);
    });
  });

  describe('stat()', () => {
    it('should return file metadata', () => {
      vfs.write('/test.txt', 'content');
      const stat = vfs.stat('/test.txt');
      expect(stat.name).toBe('test.txt');
      expect(stat.type).toBe('file');
      expect(stat.parent).toBe('/');
      expect(stat.meta.createdAt).toBeDefined();
      expect(stat.meta.updatedAt).toBeDefined();
    });

    it('should return directory metadata', () => {
      const stat = vfs.stat('/home');
      expect(stat.name).toBe('home');
      expect(stat.type).toBe('directory');
      expect(stat.parent).toBe('/');
    });

    it('should throw error for non-existent path', () => {
      expect(() => vfs.stat('/nonexistent'))
        .toThrow('no such file or directory');
    });

    it('should return a copy (not reference)', () => {
      vfs.write('/test.txt', 'content');
      const stat1 = vfs.stat('/test.txt');
      const stat2 = vfs.stat('/test.txt');
      expect(stat1).not.toBe(stat2);
      expect(stat1).toEqual(stat2);
    });
  });

  describe('copy()', () => {
    it('should copy a file', () => {
      vfs.write('/original.txt', 'content');
      vfs.copy('/original.txt', '/copied.txt');
      expect(vfs.exists('/copied.txt')).toBe(true);
      expect(vfs.read('/copied.txt')).toBe('content');
    });

    it('should preserve original file after copy', () => {
      vfs.write('/original.txt', 'content');
      vfs.copy('/original.txt', '/copied.txt');
      expect(vfs.exists('/original.txt')).toBe(true);
      expect(vfs.read('/original.txt')).toBe('content');
    });

    it('should throw error when source does not exist', () => {
      expect(() => vfs.copy('/nonexistent.txt', '/dest.txt'))
        .toThrow('no such file or directory');
    });

    it('should throw error when destination already exists', () => {
      vfs.write('/original.txt', 'content');
      vfs.write('/existing.txt', 'other');
      expect(() => vfs.copy('/original.txt', '/existing.txt'))
        .toThrow('destination already exists');
    });

    it('should require recursive flag for directories', () => {
      vfs.mkdir('/srcdir');
      expect(() => vfs.copy('/srcdir', '/destdir'))
        .toThrow('source is a directory');
    });

    it('should copy directory recursively', () => {
      vfs.mkdir('/srcdir');
      vfs.write('/srcdir/file.txt', 'content');
      vfs.copy('/srcdir', '/destdir', true);
      expect(vfs.exists('/destdir')).toBe(true);
      expect(vfs.isDirectory('/destdir')).toBe(true);
      expect(vfs.exists('/destdir/file.txt')).toBe(true);
      expect(vfs.read('/destdir/file.txt')).toBe('content');
    });
  });

  describe('move()', () => {
    it('should move a file', () => {
      vfs.write('/original.txt', 'content');
      vfs.move('/original.txt', '/moved.txt');
      expect(vfs.exists('/moved.txt')).toBe(true);
      expect(vfs.read('/moved.txt')).toBe('content');
      expect(vfs.exists('/original.txt')).toBe(false);
    });

    it('should move a directory', () => {
      vfs.mkdir('/srcdir');
      vfs.write('/srcdir/file.txt', 'content');
      vfs.move('/srcdir', '/destdir');
      expect(vfs.exists('/destdir')).toBe(true);
      expect(vfs.exists('/destdir/file.txt')).toBe(true);
      expect(vfs.exists('/srcdir')).toBe(false);
    });

    it('should throw error when source does not exist', () => {
      expect(() => vfs.move('/nonexistent.txt', '/dest.txt'))
        .toThrow('no such file or directory');
    });

    it('should throw error when destination already exists', () => {
      vfs.write('/original.txt', 'content');
      vfs.write('/existing.txt', 'other');
      expect(() => vfs.move('/original.txt', '/existing.txt'))
        .toThrow('destination already exists');
    });

    it('should throw error when destination directory does not exist', () => {
      vfs.write('/original.txt', 'content');
      expect(() => vfs.move('/original.txt', '/nonexistent/dest.txt'))
        .toThrow('no such directory');
    });
  });
});

describe('VFS Directory Operations', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  describe('mkdir()', () => {
    it('should create a directory', () => {
      vfs.mkdir('/newdir');
      expect(vfs.exists('/newdir')).toBe(true);
      expect(vfs.isDirectory('/newdir')).toBe(true);
    });

    it('should throw error when directory already exists', () => {
      vfs.mkdir('/newdir');
      expect(() => vfs.mkdir('/newdir'))
        .toThrow('file exists');
    });

    it('should throw error when parent does not exist (non-recursive)', () => {
      expect(() => vfs.mkdir('/nonexistent/child'))
        .toThrow('no such file or directory');
    });

    it('should create parent directories recursively', () => {
      vfs.mkdir('/a/b/c/d', true);
      expect(vfs.exists('/a')).toBe(true);
      expect(vfs.exists('/a/b')).toBe(true);
      expect(vfs.exists('/a/b/c')).toBe(true);
      expect(vfs.exists('/a/b/c/d')).toBe(true);
    });

    it('should throw error when parent is a file', () => {
      vfs.write('/file.txt', 'content');
      expect(() => vfs.mkdir('/file.txt/subdir'))
        .toThrow('not a directory');
    });

    it('should update parent directory children list', () => {
      vfs.mkdir('/newdir');
      expect(vfs.list('/')).toContain('newdir');
    });
  });

  describe('isDirectory()', () => {
    it('should return true for directories', () => {
      expect(vfs.isDirectory('/home')).toBe(true);
    });

    it('should return false for files', () => {
      vfs.write('/test.txt', 'content');
      expect(vfs.isDirectory('/test.txt')).toBe(false);
    });

    it('should return false for non-existent paths', () => {
      expect(vfs.isDirectory('/nonexistent')).toBe(false);
    });

    it('should return true for root', () => {
      expect(vfs.isDirectory('/')).toBe(true);
    });
  });

  describe('list()', () => {
    it('should list directory contents', () => {
      const contents = vfs.list('/');
      expect(contents).toContain('home');
      expect(contents).toContain('bin');
      expect(contents).toContain('tmp');
    });

    it('should list files and directories', () => {
      vfs.write('/test.txt', 'content');
      vfs.mkdir('/testdir');
      const contents = vfs.list('/');
      expect(contents).toContain('test.txt');
      expect(contents).toContain('testdir');
    });

    it('should throw error for non-existent directory', () => {
      expect(() => vfs.list('/nonexistent'))
        .toThrow('no such directory');
    });

    it('should throw error when listing a file', () => {
      vfs.write('/test.txt', 'content');
      expect(() => vfs.list('/test.txt'))
        .toThrow('no such directory');
    });

    it('should return empty array for empty directory', () => {
      vfs.mkdir('/emptydir');
      expect(vfs.list('/emptydir')).toEqual([]);
    });

    it('should return a copy of children array', () => {
      vfs.mkdir('/testdir');
      const list1 = vfs.list('/testdir');
      const list2 = vfs.list('/testdir');
      expect(list1).not.toBe(list2);
    });

    it('should include virtual directories in root listing', () => {
      const contents = vfs.list('/');
      // Virtual directories should be present even if not in nodes
      expect(contents).toContain('proc');
      expect(contents).toContain('dev');
      expect(contents).toContain('docs');
    });
  });

  describe('listDetailed()', () => {
    it('should list directory contents with metadata', () => {
      vfs.write('/test.txt', 'content');
      vfs.mkdir('/testdir');
      const contents = vfs.listDetailed('/');

      const testFile = contents.find(n => n.name === 'test.txt');
      const testDir = contents.find(n => n.name === 'testdir');

      expect(testFile).toBeDefined();
      expect(testFile?.type).toBe('file');
      expect(testDir).toBeDefined();
      expect(testDir?.type).toBe('directory');
    });

    it('should include metadata for each entry', () => {
      vfs.write('/test.txt', 'content');
      const contents = vfs.listDetailed('/');

      const testFile = contents.find(n => n.name === 'test.txt');
      expect(testFile?.meta.createdAt).toBeDefined();
      expect(testFile?.meta.updatedAt).toBeDefined();
    });

    it('should include virtual directories in root listing', () => {
      const contents = vfs.listDetailed('/');

      const procDir = contents.find(n => n.name === 'proc');
      const devDir = contents.find(n => n.name === 'dev');
      const docsDir = contents.find(n => n.name === 'docs');

      expect(procDir).toBeDefined();
      expect(procDir?.type).toBe('directory');
      expect(devDir).toBeDefined();
      expect(devDir?.type).toBe('directory');
      expect(docsDir).toBeDefined();
      expect(docsDir?.type).toBe('directory');
    });

    it('should throw error for non-existent directory', () => {
      expect(() => vfs.listDetailed('/nonexistent'))
        .toThrow('no such directory');
    });

    it('should throw error when listing a file', () => {
      vfs.write('/test.txt', 'content');
      expect(() => vfs.listDetailed('/test.txt'))
        .toThrow('no such directory');
    });
  });

  describe('remove() for directories', () => {
    it('should remove empty directory', () => {
      vfs.mkdir('/emptydir');
      vfs.remove('/emptydir');
      expect(vfs.exists('/emptydir')).toBe(false);
    });

    it('should throw error for non-empty directory without recursive', () => {
      vfs.mkdir('/nonempty');
      vfs.write('/nonempty/file.txt', 'content');
      expect(() => vfs.remove('/nonempty'))
        .toThrow('directory not empty');
    });

    it('should remove non-empty directory recursively', () => {
      vfs.mkdir('/parent/child', true);
      vfs.write('/parent/file.txt', 'content');
      vfs.write('/parent/child/nested.txt', 'nested');
      vfs.remove('/parent', true);
      expect(vfs.exists('/parent')).toBe(false);
      expect(vfs.exists('/parent/child')).toBe(false);
    });

    it('should update parent directory children list', () => {
      vfs.mkdir('/parent/child', true);
      expect(vfs.list('/parent')).toContain('child');
      vfs.remove('/parent/child');
      expect(vfs.list('/parent')).not.toContain('child');
    });
  });
});

describe('VFS Path Resolution', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  describe('cwd()', () => {
    it('should return root by default', () => {
      expect(vfs.cwd()).toBe('/');
    });

    it('should return current working directory after chdir', () => {
      vfs.chdir('/home/tronos');
      expect(vfs.cwd()).toBe('/home/tronos');
    });
  });

  describe('chdir()', () => {
    it('should change to existing directory', () => {
      vfs.chdir('/home');
      expect(vfs.cwd()).toBe('/home');
    });

    it('should throw error for non-existent directory', () => {
      expect(() => vfs.chdir('/nonexistent'))
        .toThrow('no such file or directory');
    });

    it('should throw error when changing to a file', () => {
      vfs.write('/test.txt', 'content');
      expect(() => vfs.chdir('/test.txt'))
        .toThrow('not a directory');
    });

    it('should handle nested path changes', () => {
      vfs.chdir('/home');
      expect(vfs.cwd()).toBe('/home');
      vfs.chdir('tronos');
      expect(vfs.cwd()).toBe('/home/tronos');
    });

    it('should handle .. navigation', () => {
      vfs.chdir('/home/tronos');
      vfs.chdir('..');
      expect(vfs.cwd()).toBe('/home');
    });

    it('should handle . (current directory)', () => {
      vfs.chdir('/home/tronos');
      vfs.chdir('.');
      expect(vfs.cwd()).toBe('/home/tronos');
    });
  });

  describe('resolve()', () => {
    it('should resolve absolute path', () => {
      expect(vfs.resolve('/home/tronos')).toBe('/home/tronos');
    });

    it('should resolve relative path from root', () => {
      expect(vfs.resolve('home/tronos')).toBe('/home/tronos');
    });

    it('should resolve relative path from cwd', () => {
      vfs.chdir('/home');
      expect(vfs.resolve('tronos')).toBe('/home/tronos');
    });

    it('should resolve .. correctly', () => {
      vfs.chdir('/home/tronos');
      expect(vfs.resolve('..')).toBe('/home');
    });

    it('should resolve multiple .. correctly', () => {
      vfs.chdir('/home/tronos');
      expect(vfs.resolve('../..')).toBe('/');
    });

    it('should resolve . correctly', () => {
      vfs.chdir('/home/tronos');
      expect(vfs.resolve('.')).toBe('/home/tronos');
    });

    it('should resolve mixed relative path', () => {
      vfs.chdir('/home/tronos');
      expect(vfs.resolve('../admin/docs')).toBe('/home/admin/docs');
    });

    it('should normalize redundant slashes', () => {
      // Note: path-browserify preserves trailing slash after normalization
      expect(vfs.resolve('//home///tronos')).toBe('/home/tronos');
    });

    it('should handle empty path', () => {
      vfs.chdir('/home/tronos');
      expect(vfs.resolve('')).toBe('/home/tronos');
    });

    it('should resolve complex paths', () => {
      vfs.chdir('/home/tronos');
      expect(vfs.resolve('./docs/../projects/./app')).toBe('/home/tronos/projects/app');
    });
  });

  describe('path resolution in operations', () => {
    it('should write using relative path', () => {
      vfs.chdir('/home/tronos');
      vfs.write('test.txt', 'content');
      expect(vfs.exists('/home/tronos/test.txt')).toBe(true);
    });

    it('should read using relative path', () => {
      vfs.write('/home/tronos/test.txt', 'content');
      vfs.chdir('/home/tronos');
      expect(vfs.read('test.txt')).toBe('content');
    });

    it('should mkdir using relative path', () => {
      vfs.chdir('/home/tronos');
      vfs.mkdir('projects');
      expect(vfs.exists('/home/tronos/projects')).toBe(true);
    });

    it('should list using relative path', () => {
      vfs.chdir('/');
      const contents = vfs.list('home/tronos');
      expect(contents).toBeDefined();
    });

    it('should remove using relative path', () => {
      vfs.write('/home/tronos/test.txt', 'content');
      vfs.chdir('/home/tronos');
      vfs.remove('test.txt');
      expect(vfs.exists('/home/tronos/test.txt')).toBe(false);
    });

    it('should copy using relative paths', () => {
      vfs.write('/home/tronos/original.txt', 'content');
      vfs.chdir('/home/tronos');
      vfs.copy('original.txt', 'copied.txt');
      expect(vfs.exists('/home/tronos/copied.txt')).toBe(true);
    });

    it('should move using relative paths', () => {
      vfs.write('/home/tronos/original.txt', 'content');
      vfs.chdir('/home/tronos');
      vfs.move('original.txt', 'moved.txt');
      expect(vfs.exists('/home/tronos/moved.txt')).toBe(true);
      expect(vfs.exists('/home/tronos/original.txt')).toBe(false);
    });
  });
});

describe('VFS Initialization', () => {
  it('should create default directories on init', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();

    expect(vfs.exists('/home/tronos')).toBe(true);
    expect(vfs.exists('/bin')).toBe(true);
    expect(vfs.exists('/tmp')).toBe(true);
    expect(vfs.exists('/etc')).toBe(true);
    expect(vfs.exists('/dev')).toBe(true);
    expect(vfs.exists('/proc')).toBe(true);
  });

  it('should create default files on init', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();

    expect(vfs.exists('/etc/motd')).toBe(true);
    expect(vfs.exists('/home/tronos/.profile')).toBe(true);
    expect(vfs.exists('/bin/help.trx')).toBe(true);
    expect(vfs.exists('/bin/countdown.trx')).toBe(true);
  });

  it('should only initialize once', async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();

    // Modify something
    vfs.write('/test.txt', 'content');

    // Re-initialize should not reset
    await vfs.init();

    expect(vfs.exists('/test.txt')).toBe(true);
  });

  it('should support custom namespace', async () => {
    const vfs1 = new InMemoryVFS('namespace1');
    const vfs2 = new InMemoryVFS('namespace2');

    await vfs1.init();
    await vfs2.init();

    // Both should have default structure
    expect(vfs1.exists('/home/tronos')).toBe(true);
    expect(vfs2.exists('/home/tronos')).toBe(true);
  });
});

describe('VFS Edge Cases', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  it('should handle root directory operations', () => {
    expect(vfs.exists('/')).toBe(true);
    expect(vfs.isDirectory('/')).toBe(true);
    expect(vfs.stat('/').type).toBe('directory');
  });

  it('should handle very long file paths', () => {
    const longPath = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p';
    vfs.mkdir(longPath, true);
    expect(vfs.exists(longPath)).toBe(true);
  });

  it('should handle files with spaces in name', () => {
    vfs.write('/file with spaces.txt', 'content');
    expect(vfs.exists('/file with spaces.txt')).toBe(true);
    expect(vfs.read('/file with spaces.txt')).toBe('content');
  });

  it('should handle files with dots in name', () => {
    vfs.write('/file.name.with.dots.txt', 'content');
    expect(vfs.exists('/file.name.with.dots.txt')).toBe(true);
  });

  it('should handle hidden files (starting with .)', () => {
    vfs.write('/home/tronos/.hidden', 'secret');
    expect(vfs.exists('/home/tronos/.hidden')).toBe(true);
    expect(vfs.list('/home/tronos')).toContain('.hidden');
  });

  it('should handle very large file content', () => {
    const largeContent = 'x'.repeat(1000000); // 1MB
    vfs.write('/large.txt', largeContent);
    expect(vfs.read('/large.txt')).toBe(largeContent);
  });

  it('should handle multiple operations in sequence', () => {
    vfs.mkdir('/project');
    vfs.write('/project/file1.txt', 'content1');
    vfs.write('/project/file2.txt', 'content2');
    vfs.mkdir('/project/subdir');
    vfs.write('/project/subdir/file3.txt', 'content3');

    expect(vfs.list('/project').length).toBe(3);
    expect(vfs.read('/project/subdir/file3.txt')).toBe('content3');

    vfs.remove('/project/file1.txt');
    expect(vfs.list('/project').length).toBe(2);

    vfs.move('/project/file2.txt', '/project/renamed.txt');
    expect(vfs.exists('/project/renamed.txt')).toBe(true);
    expect(vfs.exists('/project/file2.txt')).toBe(false);
  });
});
