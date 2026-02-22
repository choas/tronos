import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVFS } from '../src/vfs/memory';
import {
  procGenerators,
  isProcPath,
  isProcDirectory,
  getProcGenerator,
  listProcDirectory,
  setBootTime,
  getBootTime,
  setProcContext
} from '../src/vfs/proc';

describe('Proc Generators Module', () => {
  describe('isProcPath', () => {
    it('should return true for /proc', () => {
      expect(isProcPath('/proc')).toBe(true);
    });

    it('should return true for /proc/ai', () => {
      expect(isProcPath('/proc/ai')).toBe(true);
    });

    it('should return true for /proc/ai/model', () => {
      expect(isProcPath('/proc/ai/model')).toBe(true);
    });

    it('should return false for /home', () => {
      expect(isProcPath('/home')).toBe(false);
    });

    it('should return false for /processing', () => {
      expect(isProcPath('/processing')).toBe(false);
    });
  });

  describe('isProcDirectory', () => {
    it('should return true for /proc', () => {
      expect(isProcDirectory('/proc')).toBe(true);
    });

    it('should return true for /proc/ai', () => {
      expect(isProcDirectory('/proc/ai')).toBe(true);
    });

    it('should return true for /proc/system', () => {
      expect(isProcDirectory('/proc/system')).toBe(true);
    });

    it('should return false for /proc/ai/model', () => {
      expect(isProcDirectory('/proc/ai/model')).toBe(false);
    });

    it('should return false for /proc/env', () => {
      expect(isProcDirectory('/proc/env')).toBe(false);
    });
  });

  describe('getProcGenerator', () => {
    it('should return generator for /proc/ai/model', () => {
      const gen = getProcGenerator('/proc/ai/model');
      expect(gen).toBeDefined();
      expect(typeof gen).toBe('function');
    });

    it('should return undefined for non-existent path', () => {
      const gen = getProcGenerator('/proc/ai/nonexistent');
      expect(gen).toBeUndefined();
    });
  });

  describe('listProcDirectory', () => {
    it('should list /proc contents', () => {
      const contents = listProcDirectory('/proc');
      expect(contents).toContain('ai');
      expect(contents).toContain('system');
      expect(contents).toContain('env');
    });

    it('should list /proc/ai contents', () => {
      const contents = listProcDirectory('/proc/ai');
      expect(contents).toContain('model');
      expect(contents).toContain('provider');
      expect(contents).toContain('status');
    });

    it('should list /proc/system contents', () => {
      const contents = listProcDirectory('/proc/system');
      expect(contents).toContain('version');
      expect(contents).toContain('uptime');
      expect(contents).toContain('memory');
    });
  });

  describe('procGenerators', () => {
    it('should have /proc/ai/model generator', () => {
      expect(procGenerators['/proc/ai/model']).toBeDefined();
      const result = procGenerators['/proc/ai/model']();
      expect(typeof result).toBe('string');
    });

    it('should have /proc/ai/provider generator', () => {
      expect(procGenerators['/proc/ai/provider']).toBeDefined();
      const result = procGenerators['/proc/ai/provider']();
      expect(typeof result).toBe('string');
    });

    it('should have /proc/ai/status generator', () => {
      expect(procGenerators['/proc/ai/status']).toBeDefined();
      const result = procGenerators['/proc/ai/status']();
      expect(['configured', 'not configured']).toContain(result);
    });

    it('should have /proc/system/version generator', () => {
      const result = procGenerators['/proc/system/version']();
      expect(result).toMatch(/^TronOS v0\.1\.0/);
    });

    it('should have /proc/system/uptime generator', () => {
      setBootTime(Date.now() - 3661000); // 1h 1m 1s ago
      const result = procGenerators['/proc/system/uptime']();
      expect(result).toMatch(/^\d+h \d+m \d+s$/);
      expect(result).toBe('1h 1m 1s');
    });

    it('should have /proc/system/memory generator', () => {
      const result = procGenerators['/proc/system/memory']();
      expect(typeof result).toBe('string');
      // Either shows memory info or indicates not available
      expect(result.length).toBeGreaterThan(0);
    });

    it('should have /proc/env generator', () => {
      setProcContext({ env: { FOO: 'bar', BAZ: 'qux' } });
      const result = procGenerators['/proc/env']();
      expect(result).toContain('BAZ=qux');
      expect(result).toContain('FOO=bar');
    });

    it('should sort environment variables alphabetically', () => {
      setProcContext({ env: { ZEBRA: '1', APPLE: '2', MANGO: '3' } });
      const result = procGenerators['/proc/env']();
      const lines = result.split('\n');
      expect(lines[0]).toBe('APPLE=2');
      expect(lines[1]).toBe('MANGO=3');
      expect(lines[2]).toBe('ZEBRA=1');
    });
  });

  describe('boot time', () => {
    it('should set and get boot time', () => {
      const testTime = 1234567890;
      setBootTime(testTime);
      expect(getBootTime()).toBe(testTime);
    });
  });
});

describe('VFS /proc Integration', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test');
    await vfs.init();
  });

  describe('exists', () => {
    it('should return true for /proc', () => {
      expect(vfs.exists('/proc')).toBe(true);
    });

    it('should return true for /proc/ai', () => {
      expect(vfs.exists('/proc/ai')).toBe(true);
    });

    it('should return true for /proc/ai/model', () => {
      expect(vfs.exists('/proc/ai/model')).toBe(true);
    });

    it('should return false for /proc/nonexistent', () => {
      expect(vfs.exists('/proc/nonexistent')).toBe(false);
    });
  });

  describe('isDirectory', () => {
    it('should return true for /proc', () => {
      expect(vfs.isDirectory('/proc')).toBe(true);
    });

    it('should return true for /proc/ai', () => {
      expect(vfs.isDirectory('/proc/ai')).toBe(true);
    });

    it('should return false for /proc/ai/model', () => {
      expect(vfs.isDirectory('/proc/ai/model')).toBe(false);
    });
  });

  describe('isFile', () => {
    it('should return true for /proc/ai/model', () => {
      expect(vfs.isFile('/proc/ai/model')).toBe(true);
    });

    it('should return true for /proc/env', () => {
      expect(vfs.isFile('/proc/env')).toBe(true);
    });

    it('should return false for /proc/ai', () => {
      expect(vfs.isFile('/proc/ai')).toBe(false);
    });
  });

  describe('read', () => {
    it('should read /proc/ai/model', () => {
      const content = vfs.read('/proc/ai/model');
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should read /proc/system/version', () => {
      const content = vfs.read('/proc/system/version');
      expect(content).toMatch(/^TronOS v0\.1\.0/);
    });

    it('should read /proc/env with context', () => {
      vfs.setProcEnv({ TEST_VAR: 'hello' });
      const content = vfs.read('/proc/env');
      expect(content).toContain('TEST_VAR=hello');
    });

    it('should throw for reading /proc directory', () => {
      expect(() => vfs.read('/proc')).toThrow('not a file');
    });

    it('should throw for non-existent /proc file', () => {
      expect(() => vfs.read('/proc/nonexistent')).toThrow('no such file');
    });
  });

  describe('list', () => {
    it('should list /proc contents', () => {
      const contents = vfs.list('/proc');
      expect(contents).toContain('ai');
      expect(contents).toContain('system');
      expect(contents).toContain('env');
    });

    it('should list /proc/ai contents', () => {
      const contents = vfs.list('/proc/ai');
      expect(contents).toContain('model');
      expect(contents).toContain('provider');
      expect(contents).toContain('status');
    });

    it('should throw for listing a /proc file', () => {
      expect(() => vfs.list('/proc/ai/model')).toThrow('not a directory');
    });
  });

  describe('listDetailed', () => {
    it('should list /proc contents with details', () => {
      const contents = vfs.listDetailed('/proc');
      expect(contents.length).toBe(5);

      const ai = contents.find(n => n.name === 'ai');
      expect(ai).toBeDefined();
      expect(ai?.type).toBe('directory');

      const env = contents.find(n => n.name === 'env');
      expect(env).toBeDefined();
      expect(env?.type).toBe('file');

      const cronDir = contents.find(n => n.name === 'cron');
      expect(cronDir).toBeDefined();
      expect(cronDir?.type).toBe('directory');

      const themeDir = contents.find(n => n.name === 'theme');
      expect(themeDir).toBeDefined();
      expect(themeDir?.type).toBe('directory');
    });

    it('should list /proc/ai contents with details', () => {
      const contents = vfs.listDetailed('/proc/ai');
      expect(contents.length).toBe(3);

      const model = contents.find(n => n.name === 'model');
      expect(model).toBeDefined();
      expect(model?.type).toBe('file');
    });
  });

  describe('stat', () => {
    it('should stat /proc directory', () => {
      const stat = vfs.stat('/proc');
      expect(stat.type).toBe('directory');
      expect(stat.name).toBe('proc');
    });

    it('should stat /proc/ai directory', () => {
      const stat = vfs.stat('/proc/ai');
      expect(stat.type).toBe('directory');
      expect(stat.name).toBe('ai');
    });

    it('should stat /proc/ai/model file', () => {
      const stat = vfs.stat('/proc/ai/model');
      expect(stat.type).toBe('file');
      expect(stat.name).toBe('model');
    });

    it('should throw for non-existent /proc path', () => {
      expect(() => vfs.stat('/proc/nonexistent')).toThrow('no such file');
    });
  });
});
