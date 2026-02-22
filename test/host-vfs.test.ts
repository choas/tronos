import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HybridVFS, DEFAULT_MOUNT_POINT } from '../src/vfs/host';

// Create a temporary directory for test fixtures
let testDir: string;
let vfs: HybridVFS;

describe('HybridVFS', () => {
  beforeEach(async () => {
    // Create a unique temp directory for this test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-test-'));

    // Create some test files
    fs.writeFileSync(path.join(testDir, 'test.txt'), 'Hello World');
    fs.mkdirSync(path.join(testDir, 'subdir'));
    fs.writeFileSync(path.join(testDir, 'subdir', 'nested.txt'), 'Nested file');

    // Create VFS with the test directory as host path
    vfs = new HybridVFS('test-session', {
      hostPath: testDir,
      allowWrite: true
    });
    await vfs.init();
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should create mount point directory', () => {
      expect(vfs.exists(DEFAULT_MOUNT_POINT)).toBe(true);
      expect(vfs.isDirectory(DEFAULT_MOUNT_POINT)).toBe(true);
    });

    it('should report as mounted', () => {
      expect(vfs.isMounted()).toBe(true);
    });

    it('should return correct host and mount paths', () => {
      expect(vfs.getHostPath()).toBe(testDir);
      expect(vfs.getMountPoint()).toBe(DEFAULT_MOUNT_POINT);
    });
  });

  describe('exists', () => {
    it('should detect existing host files', () => {
      expect(vfs.exists('/mnt/host/test.txt')).toBe(true);
    });

    it('should detect existing host directories', () => {
      expect(vfs.exists('/mnt/host/subdir')).toBe(true);
    });

    it('should return false for non-existent host paths', () => {
      expect(vfs.exists('/mnt/host/nonexistent.txt')).toBe(false);
    });

    it('should still work for virtual paths', () => {
      expect(vfs.exists('/home/tronos')).toBe(true);
    });
  });

  describe('stat', () => {
    it('should return file stats for host files', () => {
      const stat = vfs.stat('/mnt/host/test.txt');
      expect(stat.name).toBe('test.txt');
      expect(stat.type).toBe('file');
    });

    it('should return directory stats for host directories', () => {
      const stat = vfs.stat('/mnt/host/subdir');
      expect(stat.name).toBe('subdir');
      expect(stat.type).toBe('directory');
    });

    it('should throw for non-existent host paths', () => {
      expect(() => vfs.stat('/mnt/host/nonexistent.txt')).toThrow('no such file or directory');
    });
  });

  describe('read', () => {
    it('should read host files', () => {
      const content = vfs.read('/mnt/host/test.txt');
      expect(content).toBe('Hello World');
    });

    it('should read nested host files', () => {
      const content = vfs.read('/mnt/host/subdir/nested.txt');
      expect(content).toBe('Nested file');
    });

    it('should throw when reading directories', () => {
      expect(() => vfs.read('/mnt/host/subdir')).toThrow('not a file');
    });

    it('should throw for non-existent files', () => {
      expect(() => vfs.read('/mnt/host/nonexistent.txt')).toThrow('no such file or directory');
    });

    it('should still work for virtual files', async () => {
      vfs.write('/home/tronos/test.txt', 'Virtual content');
      const content = vfs.read('/home/tronos/test.txt');
      expect(content).toBe('Virtual content');
    });
  });

  describe('write', () => {
    it('should write to host files', () => {
      vfs.write('/mnt/host/new.txt', 'New content');
      const content = fs.readFileSync(path.join(testDir, 'new.txt'), 'utf-8');
      expect(content).toBe('New content');
    });

    it('should overwrite existing host files', () => {
      vfs.write('/mnt/host/test.txt', 'Updated content');
      const content = fs.readFileSync(path.join(testDir, 'test.txt'), 'utf-8');
      expect(content).toBe('Updated content');
    });

    it('should throw when writing to directories', () => {
      expect(() => vfs.write('/mnt/host/subdir', 'content')).toThrow('not a file');
    });

    it('should throw when parent directory does not exist', () => {
      expect(() => vfs.write('/mnt/host/nonexistent/file.txt', 'content')).toThrow('no such file or directory');
    });

    it('should still work for virtual files', () => {
      vfs.write('/home/tronos/test.txt', 'Virtual content');
      expect(vfs.read('/home/tronos/test.txt')).toBe('Virtual content');
    });
  });

  describe('append', () => {
    it('should append to host files', () => {
      vfs.append('/mnt/host/test.txt', ' Appended');
      const content = fs.readFileSync(path.join(testDir, 'test.txt'), 'utf-8');
      expect(content).toBe('Hello World Appended');
    });
  });

  describe('isDirectory', () => {
    it('should return true for host directories', () => {
      expect(vfs.isDirectory('/mnt/host/subdir')).toBe(true);
    });

    it('should return false for host files', () => {
      expect(vfs.isDirectory('/mnt/host/test.txt')).toBe(false);
    });
  });

  describe('isFile', () => {
    it('should return true for host files', () => {
      expect(vfs.isFile('/mnt/host/test.txt')).toBe(true);
    });

    it('should return false for host directories', () => {
      expect(vfs.isFile('/mnt/host/subdir')).toBe(false);
    });
  });

  describe('list', () => {
    it('should list host directory contents', () => {
      const files = vfs.list('/mnt/host');
      expect(files).toContain('test.txt');
      expect(files).toContain('subdir');
    });

    it('should list nested host directory contents', () => {
      const files = vfs.list('/mnt/host/subdir');
      expect(files).toContain('nested.txt');
    });

    it('should throw when listing non-directory', () => {
      expect(() => vfs.list('/mnt/host/test.txt')).toThrow('not a directory');
    });
  });

  describe('listDetailed', () => {
    it('should list host directory with metadata', () => {
      const files = vfs.listDetailed('/mnt/host');
      const testFile = files.find(f => f.name === 'test.txt');
      const subdir = files.find(f => f.name === 'subdir');

      expect(testFile).toBeDefined();
      expect(testFile?.type).toBe('file');
      expect(subdir).toBeDefined();
      expect(subdir?.type).toBe('directory');
    });
  });

  describe('mkdir', () => {
    it('should create host directories', () => {
      vfs.mkdir('/mnt/host/newdir');
      expect(fs.existsSync(path.join(testDir, 'newdir'))).toBe(true);
    });

    it('should create host directories recursively', () => {
      vfs.mkdir('/mnt/host/deep/nested/dir', true);
      expect(fs.existsSync(path.join(testDir, 'deep/nested/dir'))).toBe(true);
    });

    it('should throw when directory already exists', () => {
      expect(() => vfs.mkdir('/mnt/host/subdir')).toThrow('file exists');
    });
  });

  describe('remove', () => {
    it('should remove host files', () => {
      vfs.remove('/mnt/host/test.txt');
      expect(fs.existsSync(path.join(testDir, 'test.txt'))).toBe(false);
    });

    it('should remove empty host directories', () => {
      fs.mkdirSync(path.join(testDir, 'emptydir'));
      vfs.remove('/mnt/host/emptydir');
      expect(fs.existsSync(path.join(testDir, 'emptydir'))).toBe(false);
    });

    it('should throw when removing non-empty directory without recursive', () => {
      expect(() => vfs.remove('/mnt/host/subdir')).toThrow('directory not empty');
    });

    it('should remove non-empty directory with recursive', () => {
      vfs.remove('/mnt/host/subdir', true);
      expect(fs.existsSync(path.join(testDir, 'subdir'))).toBe(false);
    });

    it('should not allow removing mount point', () => {
      expect(() => vfs.remove('/mnt/host')).toThrow('cannot remove mount point');
    });
  });

  describe('copy', () => {
    it('should copy host files within host', () => {
      vfs.copy('/mnt/host/test.txt', '/mnt/host/test-copy.txt');
      expect(fs.existsSync(path.join(testDir, 'test-copy.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, 'test-copy.txt'), 'utf-8')).toBe('Hello World');
    });

    it('should copy host file to virtual filesystem', () => {
      vfs.copy('/mnt/host/test.txt', '/home/tronos/test-copy.txt');
      expect(vfs.read('/home/tronos/test-copy.txt')).toBe('Hello World');
    });

    it('should copy virtual file to host filesystem', () => {
      vfs.write('/home/tronos/virtual.txt', 'Virtual content');
      vfs.copy('/home/tronos/virtual.txt', '/mnt/host/virtual-copy.txt');
      expect(fs.readFileSync(path.join(testDir, 'virtual-copy.txt'), 'utf-8')).toBe('Virtual content');
    });

    it('should copy host directories recursively', () => {
      vfs.copy('/mnt/host/subdir', '/mnt/host/subdir-copy', true);
      expect(fs.existsSync(path.join(testDir, 'subdir-copy'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'subdir-copy', 'nested.txt'))).toBe(true);
    });
  });

  describe('move', () => {
    it('should move host files within host', () => {
      vfs.move('/mnt/host/test.txt', '/mnt/host/test-moved.txt');
      expect(fs.existsSync(path.join(testDir, 'test.txt'))).toBe(false);
      expect(fs.existsSync(path.join(testDir, 'test-moved.txt'))).toBe(true);
    });

    it('should move host file to virtual filesystem', () => {
      vfs.move('/mnt/host/test.txt', '/home/tronos/test-moved.txt');
      expect(fs.existsSync(path.join(testDir, 'test.txt'))).toBe(false);
      expect(vfs.read('/home/tronos/test-moved.txt')).toBe('Hello World');
    });

    it('should move virtual file to host filesystem', () => {
      vfs.write('/home/tronos/virtual.txt', 'Virtual content');
      vfs.move('/home/tronos/virtual.txt', '/mnt/host/virtual-moved.txt');
      expect(vfs.exists('/home/tronos/virtual.txt')).toBe(false);
      expect(fs.readFileSync(path.join(testDir, 'virtual-moved.txt'), 'utf-8')).toBe('Virtual content');
    });
  });

  describe('read-only mode', () => {
    let readOnlyVfs: HybridVFS;

    beforeEach(async () => {
      readOnlyVfs = new HybridVFS('test-ro-session', {
        hostPath: testDir,
        allowWrite: false
      });
      await readOnlyVfs.init();
    });

    it('should allow reading files', () => {
      const content = readOnlyVfs.read('/mnt/host/test.txt');
      expect(content).toBe('Hello World');
    });

    it('should block writing files', () => {
      expect(() => readOnlyVfs.write('/mnt/host/new.txt', 'content')).toThrow('read-only');
    });

    it('should block creating directories', () => {
      expect(() => readOnlyVfs.mkdir('/mnt/host/newdir')).toThrow('read-only');
    });

    it('should block removing files', () => {
      expect(() => readOnlyVfs.remove('/mnt/host/test.txt')).toThrow('read-only');
    });

    it('should block appending to files', () => {
      expect(() => readOnlyVfs.append('/mnt/host/test.txt', ' more')).toThrow('read-only');
    });
  });

  describe('path traversal protection', () => {
    it('should block path traversal attempts', async () => {
      // Create a VFS with a nested directory as root
      const nestedDir = path.join(testDir, 'subdir');
      const restrictedVfs = new HybridVFS('test-restricted', {
        hostPath: nestedDir,
        allowWrite: true
      });
      await restrictedVfs.init();

      // Try to read a file outside the mount point using path traversal
      // The file exists (test.txt in parent), but should not be accessible
      expect(restrictedVfs.exists('/mnt/host/../test.txt')).toBe(false);
    });
  });

  describe('virtual filesystem isolation', () => {
    it('should keep /home/tronos separate from host', () => {
      // Create a file in virtual fs
      vfs.write('/home/tronos/secret.txt', 'Virtual secret');

      // It should not appear in host filesystem
      expect(fs.existsSync(path.join(testDir, 'secret.txt'))).toBe(false);

      // It should be accessible in virtual fs
      expect(vfs.read('/home/tronos/secret.txt')).toBe('Virtual secret');
    });

    it('should keep /bin separate from host', () => {
      expect(vfs.exists('/bin')).toBe(true);
      // /bin files should be virtual, not from host
      const binFiles = vfs.list('/bin');
      expect(binFiles).toBeDefined();
    });
  });
});
