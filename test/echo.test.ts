import { describe, it, expect } from 'vitest';
import { echo } from '../src/engine/builtins/filesystem';

describe('echo builtin command', () => {
  it('should print single argument', async () => {
    const result = await echo(['hello'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should print multiple arguments separated by spaces', async () => {
    const result = await echo(['hello', 'world', 'test'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello world test\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle no arguments (just newline)', async () => {
    const result = await echo([], { stdin: '', env: {} });
    expect(result.stdout).toBe('\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle -n flag (no trailing newline)', async () => {
    const result = await echo(['-n', 'hello'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle -n flag with multiple arguments', async () => {
    const result = await echo(['-n', 'hello', 'world'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle -e flag and process escape sequences', async () => {
    const result = await echo(['-e', 'hello\\nworld'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello\nworld\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle -e flag with tab escape sequence', async () => {
    const result = await echo(['-e', 'hello\\tworld'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello\tworld\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle -e flag with multiple escape sequences', async () => {
    const result = await echo(['-e', 'hello\\n\\tworld'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello\n\tworld\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle -e flag with backslash escape', async () => {
    const result = await echo(['-e', 'hello\\\\world'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello\\world\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle -E flag (no escape processing)', async () => {
    const result = await echo(['-E', 'hello\\nworld'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello\\nworld\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle combined flags -n and -e', async () => {
    const result = await echo(['-n', '-e', 'hello\\nworld'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello\nworld');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle quoted strings with spaces', async () => {
    const result = await echo(['hello world', 'test'], { stdin: '', env: {} });
    expect(result.stdout).toBe('hello world test\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should handle empty string with -n flag', async () => {
    const result = await echo(['-n', ''], { stdin: '', env: {} });
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should process various escape sequences', async () => {
    const result = await echo(['-e', '\\n\\t\\r\\b\\f\\v\\0'], { stdin: '', env: {} });
    expect(result.stdout).toBe('\n\t\r\b\f\v\0\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});