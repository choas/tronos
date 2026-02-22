import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InMemoryVFS } from '../src/vfs/memory';
import {
  docsFiles,
  docsStructure,
  isDocsPath,
  isDocsDirectory,
  isDocsFile,
  getDocsGenerator,
  listDocsDirectory,
  clearDocsCache,
  readDocsFile
} from '../src/vfs/docs';

describe('Docs Module', () => {

  describe('isDocsPath', () => {
    it('should return true for /docs', () => {
      expect(isDocsPath('/docs')).toBe(true);
    });

    it('should return true for /docs/tronos.md', () => {
      expect(isDocsPath('/docs/tronos.md')).toBe(true);
    });

    it('should return true for /docs/api.md', () => {
      expect(isDocsPath('/docs/api.md')).toBe(true);
    });

    it('should return false for /home', () => {
      expect(isDocsPath('/home')).toBe(false);
    });

    it('should return false for /documentation', () => {
      expect(isDocsPath('/documentation')).toBe(false);
    });
  });

  describe('isDocsDirectory', () => {
    it('should return true for /docs', () => {
      expect(isDocsDirectory('/docs')).toBe(true);
    });

    it('should return false for /docs/tronos.md', () => {
      expect(isDocsDirectory('/docs/tronos.md')).toBe(false);
    });

    it('should return false for /docs/api.md', () => {
      expect(isDocsDirectory('/docs/api.md')).toBe(false);
    });
  });

  describe('isDocsFile', () => {
    it('should return true for /docs/tronos.md', () => {
      expect(isDocsFile('/docs/tronos.md')).toBe(true);
    });

    it('should return true for /docs/api.md', () => {
      expect(isDocsFile('/docs/api.md')).toBe(true);
    });

    it('should return true for /docs/commands.md', () => {
      expect(isDocsFile('/docs/commands.md')).toBe(true);
    });

    it('should return false for /docs', () => {
      expect(isDocsFile('/docs')).toBe(false);
    });

    it('should return false for /docs/nonexistent.md', () => {
      expect(isDocsFile('/docs/nonexistent.md')).toBe(false);
    });
  });

  describe('getDocsGenerator', () => {
    it('should return generator for /docs/tronos.md', () => {
      const gen = getDocsGenerator('/docs/tronos.md');
      expect(gen).toBeDefined();
      expect(typeof gen).toBe('function');
    });

    it('should return undefined for non-existent path', () => {
      const gen = getDocsGenerator('/docs/nonexistent.md');
      expect(gen).toBeUndefined();
    });

    it('should return undefined for /docs directory', () => {
      const gen = getDocsGenerator('/docs');
      expect(gen).toBeUndefined();
    });
  });

  describe('listDocsDirectory', () => {
    it('should list /docs contents', () => {
      const contents = listDocsDirectory('/docs');
      expect(contents).toBeDefined();
      expect(contents).toContain('tronos.md');
      expect(contents).toContain('api.md');
      expect(contents).toContain('commands.md');
    });

    it('should return undefined for non-directory path', () => {
      const contents = listDocsDirectory('/docs/tronos.md');
      expect(contents).toBeUndefined();
    });
  });

  describe('docsFiles configuration', () => {
    it('should have tronos.md with inline content', () => {
      expect(docsFiles['/docs/tronos.md']).toBeDefined();
      expect(docsFiles['/docs/tronos.md'].content).toContain('TronOS');
    });

    it('should have api.md with inline content', () => {
      expect(docsFiles['/docs/api.md']).toBeDefined();
      expect(docsFiles['/docs/api.md'].content).toContain('API');
    });

    it('should have commands.md with inline content', () => {
      expect(docsFiles['/docs/commands.md']).toBeDefined();
      expect(docsFiles['/docs/commands.md'].content).toContain('Commands');
    });
  });

  describe('docsStructure', () => {
    it('should match docsFiles keys', () => {
      const structureFiles = docsStructure['/docs'];
      const fileKeys = Object.keys(docsFiles).map(p => p.replace('/docs/', ''));
      expect(structureFiles).toEqual(expect.arrayContaining(fileKeys));
    });
  });

  describe('readDocsFile', () => {
    it('should return inline content for tronos.md', async () => {
      const content = await readDocsFile('/docs/tronos.md');
      expect(content).toContain('TronOS');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should return inline content for api.md', async () => {
      const content = await readDocsFile('/docs/api.md');
      expect(content).toContain('API');
    });

    it('should return inline content for terms.md', async () => {
      const content = await readDocsFile('/docs/terms.md');
      expect(content).toContain('Terms');
    });

    it('should return same content on repeated reads', async () => {
      const content1 = await readDocsFile('/docs/tronos.md');
      const content2 = await readDocsFile('/docs/tronos.md');
      expect(content1).toBe(content2);
    });

    it('should throw for non-existent docs file', async () => {
      await expect(readDocsFile('/docs/nonexistent.md')).rejects.toThrow('no such file');
    });
  });

  describe('clearDocsCache', () => {
    it('should be a no-op (retained for backward compatibility)', () => {
      // clearDocsCache is a no-op since content is inline
      expect(() => clearDocsCache()).not.toThrow();
      expect(() => clearDocsCache('/docs/tronos.md')).not.toThrow();
    });
  });
});

describe('VFS /docs Integration', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test');
    await vfs.init();
  });

  describe('exists', () => {
    it('should return true for /docs', () => {
      expect(vfs.exists('/docs')).toBe(true);
    });

    it('should return true for /docs/tronos.md', () => {
      expect(vfs.exists('/docs/tronos.md')).toBe(true);
    });

    it('should return true for /docs/api.md', () => {
      expect(vfs.exists('/docs/api.md')).toBe(true);
    });

    it('should return false for /docs/nonexistent.md', () => {
      expect(vfs.exists('/docs/nonexistent.md')).toBe(false);
    });
  });

  describe('isDirectory', () => {
    it('should return true for /docs', () => {
      expect(vfs.isDirectory('/docs')).toBe(true);
    });

    it('should return false for /docs/tronos.md', () => {
      expect(vfs.isDirectory('/docs/tronos.md')).toBe(false);
    });
  });

  describe('isFile', () => {
    it('should return true for /docs/tronos.md', () => {
      expect(vfs.isFile('/docs/tronos.md')).toBe(true);
    });

    it('should return true for /docs/api.md', () => {
      expect(vfs.isFile('/docs/api.md')).toBe(true);
    });

    it('should return false for /docs', () => {
      expect(vfs.isFile('/docs')).toBe(false);
    });
  });

  describe('read', () => {
    it('should read /docs/tronos.md with inline content', async () => {
      const content = await vfs.read('/docs/tronos.md');
      expect(content).toContain('TronOS');
    });

    it('should throw for reading /docs directory', () => {
      expect(() => vfs.read('/docs')).toThrow('not a file');
    });

    it('should throw for non-existent /docs file', () => {
      expect(() => vfs.read('/docs/nonexistent.md')).toThrow('no such file');
    });

    it('should return a Promise for docs read', () => {
      const result = vfs.read('/docs/tronos.md');
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('readSync', () => {
    it('should throw for /docs paths', () => {
      expect(() => vfs.readSync('/docs/tronos.md')).toThrow('cannot read /docs paths synchronously');
    });
  });

  describe('write (prevented)', () => {
    it('should throw when writing to /docs/tronos.md', () => {
      expect(() => vfs.write('/docs/tronos.md', 'new content')).toThrow('read-only virtual filesystem');
    });

    it('should throw when writing to /docs/new-file.md', () => {
      expect(() => vfs.write('/docs/new-file.md', 'new content')).toThrow('read-only virtual filesystem');
    });
  });

  describe('remove (prevented)', () => {
    it('should throw when removing /docs/tronos.md', () => {
      expect(() => vfs.remove('/docs/tronos.md')).toThrow('cannot remove virtual documentation');
    });

    it('should throw when removing /docs directory', () => {
      expect(() => vfs.remove('/docs')).toThrow('cannot remove virtual documentation');
    });

    it('should throw when removing /docs recursively', () => {
      expect(() => vfs.remove('/docs', true)).toThrow('cannot remove virtual documentation');
    });
  });

  describe('list', () => {
    it('should list /docs contents', () => {
      const contents = vfs.list('/docs');
      expect(contents).toContain('tronos.md');
      expect(contents).toContain('api.md');
      expect(contents).toContain('commands.md');
    });

    it('should throw for listing a /docs file', () => {
      expect(() => vfs.list('/docs/tronos.md')).toThrow('not a directory');
    });

    it('should throw for non-existent /docs subdirectory', () => {
      expect(() => vfs.list('/docs/subdir')).toThrow('no such directory');
    });
  });

  describe('listDetailed', () => {
    it('should list /docs contents with virtual type', () => {
      const contents = vfs.listDetailed('/docs');
      expect(contents.length).toBe(4);

      const tronos = contents.find(n => n.name === 'tronos.md');
      expect(tronos).toBeDefined();
      expect(tronos?.type).toBe('virtual');

      const api = contents.find(n => n.name === 'api.md');
      expect(api).toBeDefined();
      expect(api?.type).toBe('virtual');

      const terms = contents.find(n => n.name === 'terms.md');
      expect(terms).toBeDefined();
      expect(terms?.type).toBe('virtual');
    });

    it('should throw for listing a /docs file', () => {
      expect(() => vfs.listDetailed('/docs/tronos.md')).toThrow('not a directory');
    });
  });

  describe('stat', () => {
    it('should stat /docs directory', () => {
      const stat = vfs.stat('/docs');
      expect(stat.type).toBe('directory');
      expect(stat.name).toBe('docs');
    });

    it('should stat /docs/tronos.md as virtual', () => {
      const stat = vfs.stat('/docs/tronos.md');
      expect(stat.type).toBe('virtual');
      expect(stat.name).toBe('tronos.md');
    });

    it('should stat /docs/api.md as virtual', () => {
      const stat = vfs.stat('/docs/api.md');
      expect(stat.type).toBe('virtual');
      expect(stat.name).toBe('api.md');
    });

    it('should throw for non-existent /docs path', () => {
      expect(() => vfs.stat('/docs/nonexistent.md')).toThrow('no such file');
    });
  });
});
