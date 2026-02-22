import { describe, it, expect, beforeEach } from 'vitest';
import { head, tail } from '../src/engine/builtins/filesystem';
import type { CommandContext } from '../src/engine/types';

describe('head builtin command', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = {
      env: { PWD: '/', HOME: '/home/tronos' },
      vfs: null
    };
  });

  it('should show first 10 lines by default', async () => {
    // Create a mock file with content via the mock filesystem
    const args = ['/home/tronos/.profile'];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# User profile');
    expect(result.stdout).toContain('export PATH=$PATH:/bin');
    expect(result.stdout).toContain('export USER=aios');
  });

  it('should show custom number of lines with -n flag', async () => {
    const args = ['-n', '2', '/home/tronos/.profile'];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0]).toContain('# User profile');
  });

  it('should handle combined -n flag syntax', async () => {
    const args = ['-n1', '/home/tronos/.profile'];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('# User profile');
  });

  it('should handle multiple files with headers', async () => {
    const args = ['/home/tronos/.profile', '/bin/ls.trx'];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('==> /home/tronos/.profile <==');
    expect(result.stdout).toContain('==> /bin/ls.trx <==');
  });

  it('should return error for non-existent file', async () => {
    const args = ['/non/existent/file'];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No such file or directory");
  });

  it('should return error for directory', async () => {
    const args = ['/home'];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Is a directory");
  });

  it('should return error for invalid line count', async () => {
    const args = ['-n', 'invalid', '/home/tronos/.profile'];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid line count");
  });

  it('should return error for missing file operand', async () => {
    const args: string[] = [];
    const result = await head(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing file operand");
  });
});

describe('tail builtin command', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = {
      env: { PWD: '/', HOME: '/home/tronos' },
      vfs: null
    };
  });

  it('should show last 10 lines by default', async () => {
    const args = ['/home/tronos/.profile'];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# User profile');
    expect(result.stdout).toContain('export USER=aios');
  });

  it('should show custom number of lines with -n flag', async () => {
    const args = ['-n', '1', '/home/tronos/.profile'];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('export USER=aios');
  });

  it('should handle combined -n flag syntax', async () => {
    const args = ['-n2', '/home/tronos/.profile'];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[lines.length - 1]).toContain('export USER=aios');
  });

  it('should handle multiple files with headers', async () => {
    const args = ['/home/tronos/.profile', '/bin/ls.trx'];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('==> /home/tronos/.profile <==');
    expect(result.stdout).toContain('==> /bin/ls.trx <==');
  });

  it('should return error for non-existent file', async () => {
    const args = ['/non/existent/file'];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No such file or directory");
  });

  it('should return error for directory', async () => {
    const args = ['/home'];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Is a directory");
  });

  it('should return error for invalid line count', async () => {
    const args = ['-n', 'invalid', '/home/tronos/.profile'];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid line count");
  });

  it('should return error for missing file operand', async () => {
    const args: string[] = [];
    const result = await tail(args, context);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing file operand");
  });
});