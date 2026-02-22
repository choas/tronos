import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rm, cp, mv, wc } from '../src/engine/builtins/filesystem';
import { clear, history } from '../src/engine/builtins/system';
import { config } from '../src/engine/builtins/config';
import { InMemoryVFS } from '../src/vfs/memory';
import { setAIConfig, resetAIConfig } from '../src/stores/ai';

// ============================================================================
// rm builtin tests
// ============================================================================
describe('rm builtin command', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  describe('basic file removal', () => {
    it('should remove a single file', async () => {
      await vfs.write('/test.txt', 'content');
      expect(vfs.exists('/test.txt')).toBe(true);

      const result = await rm(['/test.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(vfs.exists('/test.txt')).toBe(false);
    });

    it('should remove multiple files', async () => {
      await vfs.write('/file1.txt', 'content1');
      await vfs.write('/file2.txt', 'content2');

      const result = await rm(['/file1.txt', '/file2.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/file1.txt')).toBe(false);
      expect(vfs.exists('/file2.txt')).toBe(false);
    });

    it('should fail for non-existent file without -f', async () => {
      const result = await rm(['/nonexistent.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cannot remove');
    });

    it('should silently skip non-existent file with -f', async () => {
      const result = await rm(['-f', '/nonexistent.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  describe('directory removal', () => {
    it('should fail to remove non-empty directory without -r', async () => {
      vfs.mkdir('/mydir');
      await vfs.write('/mydir/file.txt', 'content');

      const result = await rm(['/mydir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cannot remove');
      expect(vfs.exists('/mydir')).toBe(true);
    });

    it('should remove empty directory with -r', async () => {
      vfs.mkdir('/emptydir');

      const result = await rm(['-r', '/emptydir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/emptydir')).toBe(false);
    });

    it('should remove non-empty directory with -r', async () => {
      vfs.mkdir('/mydir');
      await vfs.write('/mydir/file.txt', 'content');
      vfs.mkdir('/mydir/subdir');
      await vfs.write('/mydir/subdir/nested.txt', 'nested');

      const result = await rm(['-r', '/mydir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/mydir')).toBe(false);
    });

    it('should support -R as alias for -r', async () => {
      vfs.mkdir('/mydir');
      await vfs.write('/mydir/file.txt', 'content');

      const result = await rm(['-R', '/mydir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/mydir')).toBe(false);
    });
  });

  describe('combined flags', () => {
    it('should support -rf combined flag', async () => {
      vfs.mkdir('/mydir');
      await vfs.write('/mydir/file.txt', 'content');

      const result = await rm(['-rf', '/mydir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/mydir')).toBe(false);
    });

    it('should support -fr combined flag', async () => {
      const result = await rm(['-fr', '/nonexistent'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  describe('error handling', () => {
    it('should return error for missing operand', async () => {
      const result = await rm([], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing operand');
    });

    it('should return error for invalid option', async () => {
      const result = await rm(['-x', '/file'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('invalid option');
    });
  });
});

// ============================================================================
// cp builtin tests
// ============================================================================
describe('cp builtin command', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  describe('basic file copying', () => {
    it('should copy a single file', async () => {
      await vfs.write('/source.txt', 'content');

      const result = await cp(['/source.txt', '/dest.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/dest.txt')).toBe(true);
      expect(await vfs.read('/dest.txt')).toBe('content');
      expect(vfs.exists('/source.txt')).toBe(true);
    });

    it('should fail when copying to existing directory (VFS limitation)', async () => {
      // VFS copy expects full destination path, not copying into a directory
      await vfs.write('/source.txt', 'content');
      vfs.mkdir('/destdir');

      const result = await cp(['/source.txt', '/destdir'], { stdin: '', env: {}, vfs });

      // Current VFS behavior: destination already exists error
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cannot copy');
    });

    it('should copy file to specific path inside directory', async () => {
      await vfs.write('/source.txt', 'content');
      vfs.mkdir('/destdir');

      const result = await cp(['/source.txt', '/destdir/copied.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/destdir/copied.txt')).toBe(true);
      expect(await vfs.read('/destdir/copied.txt')).toBe('content');
    });
  });

  describe('directory copying', () => {
    it('should fail to copy directory without -r', async () => {
      vfs.mkdir('/srcdir');
      await vfs.write('/srcdir/file.txt', 'content');

      const result = await cp(['/srcdir', '/destdir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cannot copy');
    });

    it('should copy directory with -r', async () => {
      vfs.mkdir('/srcdir');
      await vfs.write('/srcdir/file.txt', 'content');

      const result = await cp(['-r', '/srcdir', '/destdir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/destdir')).toBe(true);
      expect(vfs.exists('/destdir/file.txt')).toBe(true);
      expect(await vfs.read('/destdir/file.txt')).toBe('content');
    });

    it('should copy nested directories with -r', async () => {
      vfs.mkdir('/srcdir');
      vfs.mkdir('/srcdir/subdir');
      await vfs.write('/srcdir/file.txt', 'content');
      await vfs.write('/srcdir/subdir/nested.txt', 'nested');

      const result = await cp(['-r', '/srcdir', '/destdir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/destdir/subdir')).toBe(true);
      expect(vfs.exists('/destdir/subdir/nested.txt')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should return error for missing operand', async () => {
      const result = await cp([], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing file operand');
    });

    it('should return error for missing destination', async () => {
      const result = await cp(['/source.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing');
    });

    it('should return error for non-existent source', async () => {
      const result = await cp(['/nonexistent.txt', '/dest.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cannot copy');
    });

    it('should return error for invalid option', async () => {
      const result = await cp(['-x', '/src', '/dest'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('invalid option');
    });
  });
});

// ============================================================================
// mv builtin tests
// ============================================================================
describe('mv builtin command', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  describe('basic file moving', () => {
    it('should move a file to new name (rename)', async () => {
      await vfs.write('/oldname.txt', 'content');

      const result = await mv(['/oldname.txt', '/newname.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/newname.txt')).toBe(true);
      expect(vfs.exists('/oldname.txt')).toBe(false);
      expect(await vfs.read('/newname.txt')).toBe('content');
    });

    it('should fail when moving to existing directory (VFS limitation)', async () => {
      // VFS move expects full destination path, not moving into a directory
      await vfs.write('/file.txt', 'content');
      vfs.mkdir('/destdir');

      const result = await mv(['/file.txt', '/destdir'], { stdin: '', env: {}, vfs });

      // Current VFS behavior: destination already exists error
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cannot move');
    });

    it('should move file to specific path inside directory', async () => {
      await vfs.write('/file.txt', 'content');
      vfs.mkdir('/destdir');

      const result = await mv(['/file.txt', '/destdir/moved.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/destdir/moved.txt')).toBe(true);
      expect(vfs.exists('/file.txt')).toBe(false);
    });
  });

  describe('directory moving', () => {
    it('should move a directory', async () => {
      vfs.mkdir('/srcdir');
      await vfs.write('/srcdir/file.txt', 'content');

      const result = await mv(['/srcdir', '/destdir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(vfs.exists('/destdir')).toBe(true);
      expect(vfs.exists('/destdir/file.txt')).toBe(true);
      expect(vfs.exists('/srcdir')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return error for missing operand', async () => {
      const result = await mv([], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing file operand');
    });

    it('should return error for missing destination', async () => {
      const result = await mv(['/source.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing file operand');
    });

    it('should return error for non-existent source', async () => {
      const result = await mv(['/nonexistent.txt', '/dest.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cannot move');
    });
  });
});

// ============================================================================
// wc builtin tests
// ============================================================================
describe('wc builtin command', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
  });

  describe('basic counting', () => {
    it('should count lines, words, and characters', async () => {
      await vfs.write('/test.txt', 'hello world\nfoo bar baz\n');

      const result = await wc(['/test.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      // 2 lines, 5 words, 24 characters
      expect(result.stdout).toContain('2');
      expect(result.stdout).toContain('5');
      expect(result.stdout).toContain('24');
    });

    it('should count from stdin', async () => {
      const result = await wc([], { stdin: 'hello world\n', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1'); // 1 line
      expect(result.stdout).toContain('2'); // 2 words
      expect(result.stdout).toContain('12'); // 12 characters
    });
  });

  describe('flag options', () => {
    it('should count only lines with -l', async () => {
      await vfs.write('/test.txt', 'line1\nline2\nline3\n');

      const result = await wc(['-l', '/test.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('3');
    });

    it('should count only words with -w', async () => {
      await vfs.write('/test.txt', 'one two three four\n');

      const result = await wc(['-w', '/test.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('4');
    });

    it('should count only characters with -c', async () => {
      await vfs.write('/test.txt', 'hello');

      const result = await wc(['-c', '/test.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('5');
    });

    it('should support combined flags -lw', async () => {
      await vfs.write('/test.txt', 'hello world\nfoo bar\n');

      const result = await wc(['-lw', '/test.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      // Should have lines and words, but not characters
      expect(result.stdout).toContain('2'); // lines
      expect(result.stdout).toContain('4'); // words
    });
  });

  describe('multiple files', () => {
    it('should count multiple files and show total', async () => {
      await vfs.write('/file1.txt', 'hello\n');
      await vfs.write('/file2.txt', 'world\n');

      const result = await wc(['/file1.txt', '/file2.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('file1.txt');
      expect(result.stdout).toContain('file2.txt');
      expect(result.stdout).toContain('total');
    });
  });

  describe('error handling', () => {
    it('should return error for non-existent file', async () => {
      const result = await wc(['/nonexistent.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No such file or directory');
    });

    it('should return error for directory', async () => {
      vfs.mkdir('/mydir');

      const result = await wc(['/mydir'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Is a directory');
    });

    it('should return error for missing operand without stdin', async () => {
      const result = await wc([], { stdin: undefined as unknown as string, env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing file operand');
    });

    it('should return error for invalid option', async () => {
      const result = await wc(['-x', '/file.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('invalid option');
    });
  });

  describe('edge cases', () => {
    it('should handle empty file', async () => {
      await vfs.write('/empty.txt', '');

      const result = await wc(['/empty.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('0'); // 0 lines, 0 words, 0 chars
    });

    it('should handle file without trailing newline', async () => {
      await vfs.write('/notrail.txt', 'no newline');

      const result = await wc(['/notrail.txt'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('0'); // 0 lines (no newline)
      expect(result.stdout).toContain('2'); // 2 words
    });
  });
});

// ============================================================================
// clear builtin tests
// ============================================================================
describe('clear builtin command', () => {
  it('should call terminal.clear() when terminal is available', async () => {
    const mockClear = vi.fn();
    const terminal = { clear: mockClear };

    const result = await clear([], { stdin: '', env: {}, terminal });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('should succeed even without terminal', async () => {
    const result = await clear([], { stdin: '', env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('should ignore arguments', async () => {
    const mockClear = vi.fn();
    const terminal = { clear: mockClear };

    const result = await clear(['extra', 'args'], { stdin: '', env: {}, terminal });

    expect(result.exitCode).toBe(0);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// history builtin tests
// ============================================================================
describe('history builtin command', () => {
  it('should display full history when no arguments', async () => {
    const historyList = ['ls', 'pwd', 'cd /home'];

    const result = await history([], { stdin: '', env: {}, history: historyList } as any);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ls');
    expect(result.stdout).toContain('pwd');
    expect(result.stdout).toContain('cd /home');
  });

  it('should display limited history with count argument', async () => {
    const historyList = ['ls', 'pwd', 'cd /home', 'cat file.txt', 'echo hello'];

    const result = await history(['2'], { stdin: '', env: {}, history: historyList } as any);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('cat file.txt');
    expect(result.stdout).toContain('echo hello');
    expect(result.stdout).not.toContain('ls');
    expect(result.stdout).not.toContain('pwd');
  });

  it('should show line numbers', async () => {
    const historyList = ['first', 'second', 'third'];

    const result = await history([], { stdin: '', env: {}, history: historyList } as any);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\s*1\s+first/);
    expect(result.stdout).toMatch(/\s*2\s+second/);
    expect(result.stdout).toMatch(/\s*3\s+third/);
  });

  it('should handle empty history', async () => {
    const result = await history([], { stdin: '', env: {}, history: [] } as any);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('should return error for invalid count argument', async () => {
    const historyList = ['ls', 'pwd'];

    const result = await history(['abc'], { stdin: '', env: {}, history: historyList } as any);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid argument');
  });

  it('should handle count larger than history length', async () => {
    const historyList = ['ls', 'pwd'];

    const result = await history(['100'], { stdin: '', env: {}, history: historyList } as any);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ls');
    expect(result.stdout).toContain('pwd');
  });

  it('should handle count of zero', async () => {
    const historyList = ['ls', 'pwd'];

    const result = await history(['0'], { stdin: '', env: {}, history: historyList } as any);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

// ============================================================================
// config builtin tests
// ============================================================================
describe('config builtin command', () => {
  beforeEach(() => {
    // Reset AI config to defaults before each test
    resetAIConfig();
  });

  describe('show subcommand', () => {
    it('should display current configuration', async () => {
      const result = await config([], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('provider:');
      expect(result.stdout).toContain('model:');
      expect(result.stdout).toContain('baseURL:');
      expect(result.stdout).toContain('apiKey:');
      expect(result.stdout).toContain('temperature:');
      expect(result.stdout).toContain('maxTokens:');
    });

    it('should show masked API key when set', async () => {
      setAIConfig({ apiKey: 'sk-secret-key-12345678' });

      const result = await config(['show'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('sk-s');
      expect(result.stdout).toContain('5678');
      expect(result.stdout).not.toContain('sk-secret-key-12345678');
    });

    it('should show "(not set)" when API key is empty', async () => {
      setAIConfig({ apiKey: '' });

      const result = await config(['show'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('(not set)');
    });
  });

  describe('set subcommand', () => {
    it('should set provider and apply defaults', async () => {
      const result = await config(['set', 'provider', 'openai'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set provider = openai');
    });

    it('should set model', async () => {
      const result = await config(['set', 'model', 'gpt-4'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set model = gpt-4');
    });

    it('should set API key with masking', async () => {
      const result = await config(['set', 'apiKey', 'sk-test-1234567890'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set apiKey = sk-t');
      expect(result.stdout).not.toContain('sk-test-1234567890');
    });

    it('should set temperature', async () => {
      const result = await config(['set', 'temperature', '0.5'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set temperature = 0.5');
    });

    it('should set maxTokens', async () => {
      const result = await config(['set', 'maxTokens', '2000'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set maxTokens = 2000');
    });

    it('should reject invalid provider', async () => {
      const result = await config(['set', 'provider', 'invalid'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid provider');
    });

    it('should reject invalid key', async () => {
      const result = await config(['set', 'invalidKey', 'value'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid key');
    });

    it('should reject temperature out of range', async () => {
      const result = await config(['set', 'temperature', '3.0'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Temperature must be a number between 0 and 2');
    });

    it('should reject invalid maxTokens', async () => {
      const result = await config(['set', 'maxTokens', '-100'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('maxTokens must be a positive integer');
    });

    it('should require key and value', async () => {
      const result = await config(['set'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage');
    });
  });

  describe('reset subcommand', () => {
    it('should reset configuration to defaults', async () => {
      setAIConfig({ apiKey: 'test-key', model: 'custom-model' });

      const result = await config(['reset'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Configuration reset');
    });
  });

  describe('ui subcommand', () => {
    it('should return uiRequest to show config modal', async () => {
      const result = await config(['ui'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Opening configuration UI');
      expect(result.uiRequest).toBe('showConfigModal');
    });
  });

  describe('error handling', () => {
    it('should return error for unknown subcommand', async () => {
      const result = await config(['unknown'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage');
    });
  });
});
