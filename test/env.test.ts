import { describe, it, expect } from 'vitest';
import { env, exportCmd, unset } from '../src/engine/builtins/environment';
import type { ExecutionContext } from '../src/engine/types';

describe('env builtin command', () => {
  it('should display all environment variables', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { PATH: '/bin', HOME: '/home/tronos', USER: 'tronos' }
    };
    const result = await env([], context);
    expect(result.stdout).toContain('PATH=/bin');
    expect(result.stdout).toContain('HOME=/home/tronos');
    expect(result.stdout).toContain('USER=tronos');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should return empty output with no environment variables', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await env([], context);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should sort environment variables alphabetically', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { ZEBRA: '1', APPLE: '2', MANGO: '3' }
    };
    const result = await env([], context);
    const lines = result.stdout.split('\n');
    expect(lines[0]).toBe('APPLE=2');
    expect(lines[1]).toBe('MANGO=3');
    expect(lines[2]).toBe('ZEBRA=1');
    expect(result.exitCode).toBe(0);
  });
});

describe('export builtin command', () => {
  it('should list all variables with declare -x format when no args', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { PATH: '/bin', HOME: '/home/tronos' }
    };
    const result = await exportCmd([], context);
    expect(result.stdout).toContain('declare -x HOME="/home/tronos"');
    expect(result.stdout).toContain('declare -x PATH="/bin"');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('should set export request for KEY=value format', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await exportCmd(['MY_VAR=hello'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).exportRequests).toEqual([{ key: 'MY_VAR', value: 'hello' }]);
  });

  it('should handle multiple export arguments', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await exportCmd(['VAR1=value1', 'VAR2=value2'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).exportRequests).toEqual([
      { key: 'VAR1', value: 'value1' },
      { key: 'VAR2', value: 'value2' }
    ]);
  });

  it('should handle empty value in export', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await exportCmd(['MY_VAR='], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).exportRequests).toEqual([{ key: 'MY_VAR', value: '' }]);
  });

  it('should handle value with equals sign', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await exportCmd(['MY_VAR=a=b=c'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).exportRequests).toEqual([{ key: 'MY_VAR', value: 'a=b=c' }]);
  });

  it('should reject invalid variable names', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await exportCmd(['123invalid=value'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not a valid identifier');
  });

  it('should reject variable names starting with numbers', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await exportCmd(['1VAR=value'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not a valid identifier');
  });

  it('should accept variable names starting with underscore', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await exportCmd(['_MY_VAR=value'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).exportRequests).toEqual([{ key: '_MY_VAR', value: 'value' }]);
  });

  it('should handle just a key name (no value)', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { EXISTING: 'value' }
    };
    const result = await exportCmd(['EXISTING'], context);
    expect(result.exitCode).toBe(0);
    // No export requests, just marks it as exported
    expect((context as any).exportRequests).toBeUndefined();
  });
});

describe('unset builtin command', () => {
  it('should set unset request for valid variable', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { MY_VAR: 'value' }
    };
    const result = await unset(['MY_VAR'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).unsetRequests).toEqual(['MY_VAR']);
  });

  it('should handle multiple unset arguments', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { VAR1: 'v1', VAR2: 'v2', VAR3: 'v3' }
    };
    const result = await unset(['VAR1', 'VAR2'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).unsetRequests).toEqual(['VAR1', 'VAR2']);
  });

  it('should succeed with no arguments', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { MY_VAR: 'value' }
    };
    const result = await unset([], context);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('should reject invalid variable names', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await unset(['123invalid'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not a valid identifier');
  });

  it('should accept underscore-prefixed variable names', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: { _MY_VAR: 'value' }
    };
    const result = await unset(['_MY_VAR'], context);
    expect(result.exitCode).toBe(0);
    expect((context as any).unsetRequests).toEqual(['_MY_VAR']);
  });

  it('should reject variable names with special characters', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };
    const result = await unset(['MY-VAR'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not a valid identifier');
  });
});
