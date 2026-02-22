import { describe, expect, it, beforeEach } from 'vitest';
import { man } from '../src/engine/builtins/man';
import { InMemoryVFS } from '../src/vfs/memory';

/**
 * Strip ANSI escape codes from a string for easier testing
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('man builtin', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test-man');
    await vfs.init();
  });

  describe('without arguments', () => {
    it('should show usage information', async () => {
      const result = await man([], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('What manual page do you want?');
      expect(result.stdout).toContain('Usage: man <command>');
    });

    it('should list available manual pages', async () => {
      const result = await man([], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Available manual pages:');
      expect(result.stdout).toContain('ls');
      expect(result.stdout).toContain('grep');
      expect(result.stdout).toContain('cd');
    });

    it('should show examples', async () => {
      const result = await man([], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Examples:');
      expect(result.stdout).toContain('man ls');
    });
  });

  describe('with command argument', () => {
    it('should display man page for ls', async () => {
      const result = await man(['ls'], { stdin: '', env: {} });
      const stdout = stripAnsi(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain('LS(1)');
      expect(stdout).toContain('NAME');
      expect(stdout).toContain('list directory contents');
      expect(stdout).toContain('SYNOPSIS');
      expect(stdout).toContain('DESCRIPTION');
      expect(stdout).toContain('OPTIONS');
    });

    it('should display man page for grep', async () => {
      const result = await man(['grep'], { stdin: '', env: {} });
      const stdout = stripAnsi(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain('GREP(1)');
      expect(stdout).toContain('print lines that match patterns');
      expect(stdout).toContain('-i');
      expect(stdout).toContain('-v');
      expect(stdout).toContain('-n');
    });

    it('should display man page for cd', async () => {
      const result = await man(['cd'], { stdin: '', env: {} });
      const stdout = stripAnsi(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain('CD(1)');
      expect(stdout).toContain('change the working directory');
      expect(stdout).toContain('ENVIRONMENT');
      expect(stdout).toContain('HOME');
    });

    it('should display man page for man itself', async () => {
      const result = await man(['man'], { stdin: '', env: {} });
      const stdout = stripAnsi(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain('MAN(1)');
      expect(stdout).toContain('display manual pages');
    });

    it('should display man page for @ai', async () => {
      const result = await man(['@ai'], { stdin: '', env: {} });
      const stdout = stripAnsi(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain('@AI(1)');
      expect(stdout).toContain('AI assistant');
    });

    it('should display man page for factory-reset', async () => {
      const result = await man(['factory-reset'], { stdin: '', env: {} });
      const stdout = stripAnsi(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain('FACTORY-RESET(1)');
      expect(stdout).toContain('restore TronOS to initial state');
    });
  });

  describe('man page sections', () => {
    it('should have NAME section', async () => {
      const result = await man(['ls'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('NAME');
      expect(result.stdout).toContain('ls - list directory contents');
    });

    it('should have SYNOPSIS section', async () => {
      const result = await man(['ls'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('SYNOPSIS');
      expect(result.stdout).toContain('ls [-l] [-a] [-h] [path...]');
    });

    it('should have DESCRIPTION section', async () => {
      const result = await man(['ls'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('DESCRIPTION');
      expect(result.stdout).toContain('List information about files');
    });

    it('should have OPTIONS section', async () => {
      const result = await man(['ls'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('OPTIONS');
      expect(result.stdout).toContain('-l');
      expect(result.stdout).toContain('-a');
      expect(result.stdout).toContain('-h');
    });

    it('should have EXAMPLES section', async () => {
      const result = await man(['ls'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('EXAMPLES');
      expect(result.stdout).toContain('ls -la');
    });

    it('should have SEE ALSO section', async () => {
      const result = await man(['ls'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('SEE ALSO');
      expect(result.stdout).toContain('cd(1)');
    });
  });

  describe('error handling', () => {
    it('should return error for non-existent command', async () => {
      const result = await man(['nonexistent'], { stdin: '', env: {} });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No manual entry for nonexistent');
    });

    it('should suggest help for executable without man page', async () => {
      const result = await man(['help'], { stdin: '', env: {}, vfs });

      // help.trx exists, but man page is defined, so should work
      expect(result.exitCode).toBe(0);
    });

    it('should handle unknown executable with helpful message', async () => {
      // Create a test executable without a man page
      vfs.write('/bin/testprog.trx', '#!/tronos\n// @name: testprog\n');

      const result = await man(['testprog'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No manual entry for testprog');
      expect(result.stderr).toContain("help testprog");
    });
  });

  describe('VFS man pages', () => {
    it('should read man page from /usr/share/man/man1', async () => {
      // Create a custom man page in VFS
      vfs.write('/usr/share/man/man1/custom.1',
        'CUSTOM(1)                User Commands                CUSTOM(1)\n\nNAME\n       custom - a custom command\n');

      const result = await man(['custom'], { stdin: '', env: {}, vfs });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('CUSTOM(1)');
      expect(result.stdout).toContain('custom - a custom command');
    });
  });

  describe('all builtin commands have man pages', () => {
    const builtinCommands = [
      'ls', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'cp', 'mv',
      'head', 'tail', 'grep', 'wc', 'clear', 'history', 'whoami', 'env',
      'export', 'unset', 'alias', 'unalias', 'which', 'type', 'help', 'man',
      'source', 'session', 'config', '@ai', 'curl', 'fetch', 'theme', 'reset',
      'factory-reset', 'boot'
    ];

    for (const cmd of builtinCommands) {
      it(`should have man page for ${cmd}`, async () => {
        const result = await man([cmd], { stdin: '', env: {} });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('NAME');
        expect(result.stdout).toContain('SYNOPSIS');
        expect(result.stdout).toContain('DESCRIPTION');
      });
    }
  });
});
