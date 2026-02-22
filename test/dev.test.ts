import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVFS } from '../src/vfs/memory';
import {
  devHandlers,
  isDevPath,
  isDevDirectory,
  isDevFile,
  getDevHandler,
  listDevDirectory,
  readDev,
  writeDev,
  getDevPermissions
} from '../src/vfs/dev';

describe('Dev Handlers Module', () => {
  describe('isDevPath', () => {
    it('should return true for /dev', () => {
      expect(isDevPath('/dev')).toBe(true);
    });

    it('should return true for /dev/null', () => {
      expect(isDevPath('/dev/null')).toBe(true);
    });

    it('should return true for /dev/random', () => {
      expect(isDevPath('/dev/random')).toBe(true);
    });

    it('should return false for /home', () => {
      expect(isDevPath('/home')).toBe(false);
    });

    it('should return false for /devices', () => {
      expect(isDevPath('/devices')).toBe(false);
    });
  });

  describe('isDevDirectory', () => {
    it('should return true for /dev', () => {
      expect(isDevDirectory('/dev')).toBe(true);
    });

    it('should return false for /dev/null', () => {
      expect(isDevDirectory('/dev/null')).toBe(false);
    });

    it('should return false for /dev/random', () => {
      expect(isDevDirectory('/dev/random')).toBe(false);
    });
  });

  describe('isDevFile', () => {
    it('should return true for /dev/null', () => {
      expect(isDevFile('/dev/null')).toBe(true);
    });

    it('should return true for /dev/zero', () => {
      expect(isDevFile('/dev/zero')).toBe(true);
    });

    it('should return true for /dev/random', () => {
      expect(isDevFile('/dev/random')).toBe(true);
    });

    it('should return true for /dev/urandom', () => {
      expect(isDevFile('/dev/urandom')).toBe(true);
    });

    it('should return true for /dev/clipboard', () => {
      expect(isDevFile('/dev/clipboard')).toBe(true);
    });

    it('should return false for /dev', () => {
      expect(isDevFile('/dev')).toBe(false);
    });

    it('should return false for /dev/nonexistent', () => {
      expect(isDevFile('/dev/nonexistent')).toBe(false);
    });
  });

  describe('getDevHandler', () => {
    it('should return handler for /dev/null', () => {
      const handler = getDevHandler('/dev/null');
      expect(handler).toBeDefined();
      expect(handler?.readable).toBe(true);
      expect(handler?.writable).toBe(true);
    });

    it('should return handler for /dev/random', () => {
      const handler = getDevHandler('/dev/random');
      expect(handler).toBeDefined();
      expect(handler?.readable).toBe(true);
      expect(handler?.writable).toBe(true);
    });

    it('should return undefined for non-existent device', () => {
      const handler = getDevHandler('/dev/nonexistent');
      expect(handler).toBeUndefined();
    });
  });

  describe('listDevDirectory', () => {
    it('should list /dev contents', () => {
      const contents = listDevDirectory('/dev');
      expect(contents).toContain('null');
      expect(contents).toContain('zero');
      expect(contents).toContain('random');
      expect(contents).toContain('urandom');
      expect(contents).toContain('clipboard');
    });

    it('should return undefined for non-directory path', () => {
      const contents = listDevDirectory('/dev/null');
      expect(contents).toBeUndefined();
    });
  });

  describe('getDevPermissions', () => {
    it('should return rw-rw-rw- for /dev/null', () => {
      expect(getDevPermissions('/dev/null')).toBe('rw-rw-rw-');
    });

    it('should return r--r--r-- for /dev/zero (read-only)', () => {
      expect(getDevPermissions('/dev/zero')).toBe('r--r--r--');
    });

    it('should return rw-rw-rw- for /dev/random', () => {
      expect(getDevPermissions('/dev/random')).toBe('rw-rw-rw-');
    });

    it('should return rw-rw-rw- for /dev/urandom', () => {
      expect(getDevPermissions('/dev/urandom')).toBe('rw-rw-rw-');
    });

    it('should return rw-rw-rw- for /dev/clipboard', () => {
      expect(getDevPermissions('/dev/clipboard')).toBe('rw-rw-rw-');
    });

    it('should return undefined for non-existent device', () => {
      expect(getDevPermissions('/dev/nonexistent')).toBeUndefined();
    });
  });

  describe('devHandlers', () => {
    describe('/dev/null', () => {
      it('should read empty string', () => {
        const handler = devHandlers['/dev/null'];
        expect(handler.read!()).toBe('');
      });

      it('should accept writes without error', () => {
        const handler = devHandlers['/dev/null'];
        expect(() => handler.write!('test data')).not.toThrow();
      });
    });

    describe('/dev/zero', () => {
      it('should read null bytes', () => {
        const handler = devHandlers['/dev/zero'];
        const result = handler.read!(10);
        expect(result.length).toBe(10);
        for (const char of result) {
          expect(char.charCodeAt(0)).toBe(0);
        }
      });

      it('should use default size when not specified', () => {
        const handler = devHandlers['/dev/zero'];
        const result = handler.read!();
        expect(result.length).toBe(1024);
      });

      it('should cap size at 65536', () => {
        const handler = devHandlers['/dev/zero'];
        const result = handler.read!(100000);
        expect(result.length).toBe(65536);
      });
    });

    describe('/dev/random', () => {
      it('should read random bytes', () => {
        const handler = devHandlers['/dev/random'];
        const result = handler.read!(32);
        expect(result.length).toBe(32);
      });

      it('should generate different values each time', () => {
        const handler = devHandlers['/dev/random'];
        const result1 = handler.read!(32);
        const result2 = handler.read!(32);
        // With very high probability, they should be different
        expect(result1).not.toBe(result2);
      });

      it('should use default size when not specified', () => {
        const handler = devHandlers['/dev/random'];
        const result = handler.read!();
        expect(result.length).toBe(32);
      });

      it('should cap size at 65536', () => {
        const handler = devHandlers['/dev/random'];
        const result = handler.read!(100000);
        expect(result.length).toBe(65536);
      });

      it('should be writable (discards data)', () => {
        const handler = devHandlers['/dev/random'];
        expect(handler.writable).toBe(true);
        expect(handler.write).toBeDefined();
        // Writing should not throw
        expect(() => handler.write!('test data')).not.toThrow();
      });
    });

    describe('/dev/urandom', () => {
      it('should behave like /dev/random', () => {
        const handler = devHandlers['/dev/urandom'];
        expect(handler.readable).toBe(true);
        expect(handler.writable).toBe(true);
        const result = handler.read!(16);
        expect(result.length).toBe(16);
      });

      it('should be writable (discards data)', () => {
        const handler = devHandlers['/dev/urandom'];
        expect(() => handler.write!('test data')).not.toThrow();
      });
    });

    describe('/dev/zero', () => {
      it('should be read-only', () => {
        const handler = devHandlers['/dev/zero'];
        expect(handler.readable).toBe(true);
        expect(handler.writable).toBe(false);
        expect(handler.write).toBeUndefined();
      });
    });

    describe('/dev/clipboard', () => {
      it('should be readable and writable', () => {
        const handler = devHandlers['/dev/clipboard'];
        expect(handler.readable).toBe(true);
        expect(handler.writable).toBe(true);
      });

      // Note: Clipboard tests are limited in headless test environments
      // Full clipboard functionality requires browser context with permissions
    });
  });

  describe('readDev', () => {
    it('should read from /dev/null', () => {
      const result = readDev('/dev/null');
      expect(result).toBe('');
    });

    it('should read from /dev/zero', () => {
      const result = readDev('/dev/zero', 5);
      expect(result.length).toBe(5);
    });

    it('should throw for non-existent device', () => {
      expect(() => readDev('/dev/nonexistent')).toThrow('No such device');
    });
  });

  describe('writeDev', () => {
    it('should write to /dev/null without error', () => {
      expect(() => writeDev('/dev/null', 'test')).not.toThrow();
    });

    it('should throw for non-writable device', () => {
      expect(() => writeDev('/dev/zero', 'test')).toThrow('not writable');
    });

    it('should write to /dev/random without error', () => {
      expect(() => writeDev('/dev/random', 'test')).not.toThrow();
    });

    it('should throw for non-existent device', () => {
      expect(() => writeDev('/dev/nonexistent', 'test')).toThrow('No such device');
    });
  });
});

describe('VFS /dev Integration', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test');
    await vfs.init();
  });

  describe('exists', () => {
    it('should return true for /dev', () => {
      expect(vfs.exists('/dev')).toBe(true);
    });

    it('should return true for /dev/null', () => {
      expect(vfs.exists('/dev/null')).toBe(true);
    });

    it('should return true for /dev/zero', () => {
      expect(vfs.exists('/dev/zero')).toBe(true);
    });

    it('should return true for /dev/random', () => {
      expect(vfs.exists('/dev/random')).toBe(true);
    });

    it('should return true for /dev/clipboard', () => {
      expect(vfs.exists('/dev/clipboard')).toBe(true);
    });

    it('should return false for /dev/nonexistent', () => {
      expect(vfs.exists('/dev/nonexistent')).toBe(false);
    });
  });

  describe('isDirectory', () => {
    it('should return true for /dev', () => {
      expect(vfs.isDirectory('/dev')).toBe(true);
    });

    it('should return false for /dev/null', () => {
      expect(vfs.isDirectory('/dev/null')).toBe(false);
    });
  });

  describe('isFile', () => {
    it('should return true for /dev/null', () => {
      expect(vfs.isFile('/dev/null')).toBe(true);
    });

    it('should return true for /dev/random', () => {
      expect(vfs.isFile('/dev/random')).toBe(true);
    });

    it('should return false for /dev', () => {
      expect(vfs.isFile('/dev')).toBe(false);
    });
  });

  describe('read', () => {
    it('should read /dev/null as empty string', () => {
      const content = vfs.read('/dev/null');
      expect(content).toBe('');
    });

    it('should read /dev/zero as null bytes', () => {
      const content = vfs.read('/dev/zero');
      expect(typeof content).toBe('string');
      // Check first few bytes are null
      for (let i = 0; i < Math.min(10, content.length); i++) {
        expect(content.charCodeAt(i)).toBe(0);
      }
    });

    it('should read /dev/random as random bytes', () => {
      const content = vfs.read('/dev/random');
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should throw for reading /dev directory', () => {
      expect(() => vfs.read('/dev')).toThrow('not a file');
    });

    it('should throw for non-existent /dev file', () => {
      expect(() => vfs.read('/dev/nonexistent')).toThrow('no such file');
    });
  });

  describe('write', () => {
    it('should write to /dev/null without error', () => {
      expect(() => vfs.write('/dev/null', 'test data')).not.toThrow();
    });

    it('should write to /dev/random without error', () => {
      expect(() => vfs.write('/dev/random', 'test')).not.toThrow();
    });

    it('should throw for writing to /dev/zero', () => {
      expect(() => vfs.write('/dev/zero', 'test')).toThrow('not writable');
    });

    it('should throw for writing to non-existent device', () => {
      expect(() => vfs.write('/dev/nonexistent', 'test')).toThrow('no such device');
    });

    it('should throw for writing to /dev directory', () => {
      expect(() => vfs.write('/dev', 'test')).toThrow('not a file');
    });
  });

  describe('list', () => {
    it('should list /dev contents', () => {
      const contents = vfs.list('/dev');
      expect(contents).toContain('null');
      expect(contents).toContain('zero');
      expect(contents).toContain('random');
      expect(contents).toContain('urandom');
      expect(contents).toContain('clipboard');
    });

    it('should throw for listing a /dev file', () => {
      expect(() => vfs.list('/dev/null')).toThrow('not a directory');
    });
  });

  describe('listDetailed', () => {
    it('should list /dev contents with details', () => {
      const contents = vfs.listDetailed('/dev');
      expect(contents.length).toBe(5);

      const nullDev = contents.find(n => n.name === 'null');
      expect(nullDev).toBeDefined();
      expect(nullDev?.type).toBe('file');

      const random = contents.find(n => n.name === 'random');
      expect(random).toBeDefined();
      expect(random?.type).toBe('file');
    });

    it('should throw for listing a /dev file in detail', () => {
      expect(() => vfs.listDetailed('/dev/null')).toThrow('not a directory');
    });
  });

  describe('stat', () => {
    it('should stat /dev directory', () => {
      const stat = vfs.stat('/dev');
      expect(stat.type).toBe('directory');
      expect(stat.name).toBe('dev');
    });

    it('should stat /dev/null device', () => {
      const stat = vfs.stat('/dev/null');
      expect(stat.type).toBe('file');
      expect(stat.name).toBe('null');
    });

    it('should stat /dev/random device', () => {
      const stat = vfs.stat('/dev/random');
      expect(stat.type).toBe('file');
      expect(stat.name).toBe('random');
    });

    it('should throw for non-existent /dev path', () => {
      expect(() => vfs.stat('/dev/nonexistent')).toThrow('no such file');
    });
  });
});
