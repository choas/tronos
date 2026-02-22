import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { curl, fetchCmd } from '../src/engine/builtins/network';
import type { ExecutionContext } from '../src/engine/types';
import { InMemoryVFS } from '../src/vfs/memory';

describe('curl builtin', () => {
  let context: ExecutionContext;
  let vfs: InMemoryVFS;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
    context = {
      stdin: '',
      env: { HOME: '/home/tronos', PWD: '/home/tronos' },
      vfs,
    };
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('argument parsing', () => {
    it('should show error when no arguments provided', async () => {
      const result = await curl([], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('try \'curl --help\'');
    });

    it('should show help with --help', async () => {
      const result = await curl(['--help'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: curl');
      expect(result.stdout).toContain('-X, --request');
      expect(result.stdout).toContain('-H, --header');
    });

    it('should show help with -h', async () => {
      const result = await curl(['-h'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: curl');
    });

    it('should error on missing URL', async () => {
      const result = await curl(['-X', 'POST'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: no URL specified');
    });

    it('should error on missing -X argument', async () => {
      const result = await curl(['-X'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: option -X requires an argument');
    });

    it('should error on missing -H argument', async () => {
      const result = await curl(['-H'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: option -H requires an argument');
    });

    it('should error on invalid header format', async () => {
      const result = await curl(['-H', 'InvalidHeader', 'example.com'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: invalid header format: InvalidHeader');
    });

    it('should error on missing -d argument', async () => {
      const result = await curl(['-d'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: option -d requires an argument');
    });

    it('should error on missing -o argument', async () => {
      const result = await curl(['-o'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: option -o requires an argument');
    });

    it('should error on unknown option', async () => {
      const result = await curl(['--unknown', 'example.com'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: unknown option: --unknown');
    });

    it('should error on multiple URLs', async () => {
      const result = await curl(['example.com', 'another.com'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: multiple URLs not supported');
    });
  });

  describe('URL normalization', () => {
    it('should auto-add https:// if protocol missing', async () => {
      let capturedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response('Hello, World!', { status: 200 }));
      });

      await curl(['example.com'], context);

      expect(capturedUrl).toBe('https://example.com');
    });

    it('should preserve http:// if specified', async () => {
      let capturedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response('Hello, World!', { status: 200 }));
      });

      await curl(['http://example.com'], context);

      expect(capturedUrl).toBe('http://example.com');
    });

    it('should preserve https:// if specified', async () => {
      let capturedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response('Hello, World!', { status: 200 }));
      });

      await curl(['https://example.com'], context);

      expect(capturedUrl).toBe('https://example.com');
    });
  });

  describe('HTTP methods', () => {
    it('should default to GET method', async () => {
      let capturedOptions: RequestInit = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedOptions = options || {};
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['https://example.com'], context);

      expect(capturedOptions.method).toBe('GET');
    });

    it('should use specified method with -X', async () => {
      let capturedOptions: RequestInit = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedOptions = options || {};
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['-X', 'DELETE', 'https://example.com'], context);

      expect(capturedOptions.method).toBe('DELETE');
    });

    it('should convert method to uppercase', async () => {
      let capturedOptions: RequestInit = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedOptions = options || {};
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['-X', 'post', 'https://example.com'], context);

      expect(capturedOptions.method).toBe('POST');
    });

    it('should default to POST when data is provided', async () => {
      let capturedOptions: RequestInit = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedOptions = options || {};
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['-d', 'key=value', 'https://example.com'], context);

      expect(capturedOptions.method).toBe('POST');
    });

    it('should respect explicit method with data', async () => {
      let capturedOptions: RequestInit = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedOptions = options || {};
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['-X', 'PUT', '-d', 'key=value', 'https://example.com'], context);

      expect(capturedOptions.method).toBe('PUT');
    });
  });

  describe('headers', () => {
    it('should pass custom header with -H', async () => {
      let capturedHeaders: Headers | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['-H', 'Authorization: Bearer token123', 'https://example.com'], context);

      expect(capturedHeaders?.get('Authorization')).toBe('Bearer token123');
    });

    it('should pass multiple headers', async () => {
      let capturedHeaders: Headers | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl([
        '-H', 'Authorization: Bearer token123',
        '-H', 'Accept: application/json',
        'https://example.com'
      ], context);

      expect(capturedHeaders?.get('Authorization')).toBe('Bearer token123');
      expect(capturedHeaders?.get('Accept')).toBe('application/json');
    });

    it('should add default Content-Type when data is provided without Content-Type header', async () => {
      let capturedHeaders: Headers | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['-d', 'key=value', 'https://example.com'], context);

      expect(capturedHeaders?.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    });

    it('should not override explicit Content-Type', async () => {
      let capturedHeaders: Headers | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl([
        '-H', 'Content-Type: application/json',
        '-d', '{"key":"value"}',
        'https://example.com'
      ], context);

      expect(capturedHeaders?.get('Content-Type')).toBe('application/json');
    });
  });

  describe('data', () => {
    it('should send data with -d', async () => {
      let capturedOptions: RequestInit = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedOptions = options || {};
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await curl(['-d', 'key=value&other=data', 'https://example.com'], context);

      expect(capturedOptions.body).toBe('key=value&other=data');
    });

    it('should send JSON data', async () => {
      let capturedOptions: RequestInit = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedOptions = options || {};
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      const jsonData = '{"key":"value"}';
      await curl([
        '-H', 'Content-Type: application/json',
        '-d', jsonData,
        'https://example.com'
      ], context);

      expect(capturedOptions.body).toBe(jsonData);
    });
  });

  describe('output', () => {
    it('should return response body to stdout', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('Hello, World!', { status: 200 }));

      const result = await curl(['https://example.com'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('Hello, World!');
      expect(result.stderr).toBe('');
    });

    it('should write to file with -o', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('File content', { status: 200 }));

      const result = await curl(['-o', 'output.txt', 'https://example.com'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');

      // Verify file was written
      const content = await vfs.read('/home/tronos/output.txt');
      expect(content).toBe('File content');
    });

    it('should write to absolute path with -o', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('File content', { status: 200 }));

      const result = await curl(['-o', '/tmp/output.txt', 'https://example.com'], context);

      expect(result.exitCode).toBe(0);

      const content = await vfs.read('/tmp/output.txt');
      expect(content).toBe('File content');
    });

    it('should include headers with -i', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('Body content', {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'text/plain' }
      }));

      const result = await curl(['-i', 'https://example.com'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('HTTP/1.1 200 OK');
      expect(result.stdout).toContain('content-type');
      expect(result.stdout).toContain('Body content');
    });
  });

  describe('combined short options', () => {
    it('should handle -is (include + silent)', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('Body', { status: 200 }));

      const result = await curl(['-is', 'https://example.com'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('HTTP/1.1 200');
    });

    it('should error on unknown combined flag', async () => {
      const result = await curl(['-ix', 'https://example.com'], context);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('curl: unknown option: -x');
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      // aiosFetch enhances the error message
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await curl(['https://example.com'], context);

      expect(result.exitCode).toBe(1);
      // The aiosFetch wrapper transforms this to a CORS error message
      expect(result.stderr).toContain('curl:');
    });

    it('should handle CORS errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('CORS error: The server at https://example.com doesn\'t allow requests'));

      const result = await curl(['https://example.com'], context);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('CORS error');
    });

    it('should handle generic errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Something went wrong'));

      const result = await curl(['https://example.com'], context);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('curl:');
    });
  });
});

describe('fetch builtin', () => {
  let context: ExecutionContext;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    const vfs = new InMemoryVFS();
    await vfs.init();
    context = {
      stdin: '',
      env: { HOME: '/home/tronos', PWD: '/home/tronos' },
      vfs,
    };
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should show help when no arguments', async () => {
    const result = await fetchCmd([], context);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Usage: fetch');
  });

  it('should show help with --help', async () => {
    const result = await fetchCmd(['--help'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: fetch');
  });

  it('should auto-add https:// if protocol missing', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response('Hello!', { status: 200 }));
    });

    await fetchCmd(['example.com'], context);

    expect(capturedUrl).toBe('https://example.com');
  });

  it('should return response body on success', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('Response body', { status: 200 }));

    const result = await fetchCmd(['https://example.com'], context);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Response body');
    expect(result.stderr).toBe('');
  });

  it('should return error for non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    const result = await fetchCmd(['https://example.com'], context);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('Not Found');
    expect(result.stderr).toBe('fetch: HTTP 404 Not Found');
  });

  it('should handle fetch errors', async () => {
    // aiosFetch enhances the error message
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const result = await fetchCmd(['https://example.com'], context);

    expect(result.exitCode).toBe(1);
    // The aiosFetch wrapper transforms this to a Network error message
    expect(result.stderr).toContain('fetch:');
  });
});
