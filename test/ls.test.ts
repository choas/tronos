import { describe, it, expect, beforeEach } from 'vitest';
import { ls, cd } from '../src/engine/builtins/filesystem';
import { InMemoryVFS } from '../src/vfs/memory';

describe('ls builtin', () => {
  // Tests using mock filesystem (legacy path)
  describe('with mock filesystem', () => {
    it('should list directory contents', async () => {
      const result = await ls([], { stdin: '', env: {} });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('home');
      expect(result.stdout).toContain('bin');
    });

    it('should support -l flag for long format', async () => {
      const result = await ls(['-l'], { stdin: '', env: {} });
      expect(result.exitCode).toBe(0);
      // Should include file type indicator (d for directories)
      expect(result.stdout).toMatch(/drwxr-xr-x/);
    });

    it('should support -a flag to show hidden files', async () => {
      const result = await ls(['-a', '/home/tronos'], { stdin: '', env: {} });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('.profile');
    });

    it('should support combined flags', async () => {
      const result = await ls(['-la'], { stdin: '', env: {} });
      expect(result.exitCode).toBe(0);
      // Should include file type indicator (d for directories, - for files)
      expect(result.stdout).toMatch(/[d-]rw[x-]r-[x-]r-[x-]/);
    });

    it('should list home/user directory with hidden files', async () => {
      const result = await ls(['-la', '/home/tronos'], { stdin: '', env: {} });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('.profile');
    });

    it('should handle non-existent directory', async () => {
      const result = await ls(['/nonexistent'], { stdin: '', env: {} });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('No such file or directory');
    });
  });

  // Tests using VFS - testing current working directory behavior
  describe('with VFS', () => {
    let vfs: InMemoryVFS;

    beforeEach(async () => {
      vfs = new InMemoryVFS('test-ls');
      await vfs.init();
    });

    it('should list root directory by default (cwd is /)', async () => {
      const result = await ls([], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Root should contain home, bin, etc
      expect(result.stdout).toContain('home');
      expect(result.stdout).toContain('bin');
    });

    it('should list current directory contents after cd', async () => {
      // First change to /home/tronos
      vfs.chdir('/home/tronos');

      const result = await ls([], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Should list contents of /home/tronos, not root
      // /home/tronos has .profile file
      expect(result.stdout).not.toContain('bin');
      expect(result.stdout).not.toContain('etc');
    });

    it('should list current directory contents after cd with -a flag', async () => {
      // First change to /home/tronos
      vfs.chdir('/home/tronos');

      const result = await ls(['-a'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Should show .profile since -a shows hidden files
      expect(result.stdout).toContain('.profile');
    });

    it('should use . to mean current working directory', async () => {
      vfs.chdir('/bin');

      const result = await ls(['.'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Should list /bin contents which has help.trx and countdown.trx
      expect(result.stdout).toContain('.trx');
    });

    it('should resolve relative paths from cwd', async () => {
      vfs.chdir('/home');

      const result = await ls(['tronos'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
    });

    it('should resolve .. relative paths', async () => {
      vfs.chdir('/home/tronos');

      const result = await ls(['..'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Should list /home contents
      expect(result.stdout).toContain('tronos');
    });

    it('should resolve ./subdir relative paths', async () => {
      vfs.chdir('/');

      const result = await ls(['./home'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tronos');
    });

    it('should handle non-existent path', async () => {
      const result = await ls(['/nonexistent'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('No such file or directory');
    });

    it('should list files with long format (-l)', async () => {
      vfs.chdir('/bin');

      const result = await ls(['-l'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Should show permission string and date
      expect(result.stdout).toMatch(/rwx/);
      expect(result.stdout).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('should list a single file', async () => {
      const result = await ls(['/home/tronos/.profile'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('.profile');
    });

    it('should show directory indicator in long format', async () => {
      const result = await ls(['-l', '/'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Directories should start with 'd'
      expect(result.stdout).toMatch(/drwxr-xr-x/);
    });

    it('should show file indicator in long format for regular files', async () => {
      vfs.write('/testfile.txt', 'hello world');
      const result = await ls(['-l', '/testfile.txt'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Regular files should start with '-'
      expect(result.stdout).toMatch(/-rw-r--r--/);
    });

    it('should show executable indicator in long format', async () => {
      const result = await ls(['-l', '/bin'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Executables (.trx) should have 'x' permissions
      expect(result.stdout).toMatch(/-rwxr-xr-x/);
    });

    it('should list multiple paths', async () => {
      const result = await ls(['/bin', '/home'], { stdin: '', env: {}, vfs });
      expect(result.exitCode).toBe(0);
      // Should contain headers for both paths
      expect(result.stdout).toContain('/bin:');
      expect(result.stdout).toContain('/home:');
    });
  });
});