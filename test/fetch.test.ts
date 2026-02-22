import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { aiosFetch } from '../src/network/fetch';
import { VERSION } from '../src/version';

describe('aiosFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    vi.resetAllMocks();
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  describe('default headers', () => {
    it('should add User-Agent header if not present', async () => {
      let capturedHeaders: Headers | undefined;

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await aiosFetch('https://example.com');

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get('User-Agent')).toBe(`TronOS/${VERSION}`);
    });

    it('should not override existing User-Agent header', async () => {
      let capturedHeaders: Headers | undefined;

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await aiosFetch('https://example.com', {
        headers: { 'User-Agent': 'CustomAgent/1.0' }
      });

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get('User-Agent')).toBe('CustomAgent/1.0');
    });

    it('should preserve other headers while adding User-Agent', async () => {
      let capturedHeaders: Headers | undefined;

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await aiosFetch('https://example.com', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token'
        }
      });

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get('User-Agent')).toBe(`TronOS/${VERSION}`);
      expect(capturedHeaders!.get('Content-Type')).toBe('application/json');
      expect(capturedHeaders!.get('Authorization')).toBe('Bearer token');
    });

    it('should work with Headers object', async () => {
      let capturedHeaders: Headers | undefined;

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        capturedHeaders = options?.headers as Headers;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      const headers = new Headers();
      headers.set('X-Custom', 'value');

      await aiosFetch('https://example.com', { headers });

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get('User-Agent')).toBe(`TronOS/${VERSION}`);
      expect(capturedHeaders!.get('X-Custom')).toBe('value');
    });
  });

  describe('request options', () => {
    it('should pass through method option', async () => {
      let capturedOptions: RequestInit | undefined;

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        capturedOptions = options;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await aiosFetch('https://example.com', { method: 'POST' });

      expect(capturedOptions?.method).toBe('POST');
    });

    it('should pass through body option', async () => {
      let capturedOptions: RequestInit | undefined;

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        capturedOptions = options;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      const body = JSON.stringify({ key: 'value' });
      await aiosFetch('https://example.com', { method: 'POST', body });

      expect(capturedOptions?.body).toBe(body);
    });

    it('should pass through credentials option', async () => {
      let capturedOptions: RequestInit | undefined;

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        capturedOptions = options;
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await aiosFetch('https://example.com', { credentials: 'include' });

      expect(capturedOptions?.credentials).toBe('include');
    });
  });

  describe('response handling', () => {
    it('should return successful response', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response('Hello World', { status: 200 })
      );

      const response = await aiosFetch('https://example.com');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Hello World');
    });

    it('should return error response without throwing', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response('Not Found', { status: 404 })
      );

      const response = await aiosFetch('https://example.com/missing');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  describe('CORS error handling', () => {
    it('should enhance CORS error messages', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('CORS policy blocked the request')
      );

      await expect(aiosFetch('https://api.example.com/data')).rejects.toThrow(
        "CORS error: The server at https://api.example.com doesn't allow requests from this browser."
      );
    });

    it('should enhance cross-origin error messages', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('Cross-origin request blocked')
      );

      await expect(aiosFetch('https://other.example.com/api')).rejects.toThrow(
        "CORS error: The server at https://other.example.com doesn't allow requests from this browser."
      );
    });

    it('should enhance failed to fetch error messages', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('Failed to fetch')
      );

      await expect(aiosFetch('https://blocked.example.com')).rejects.toThrow(
        "CORS error: The server at https://blocked.example.com doesn't allow requests from this browser."
      );
    });

    it('should handle network error messages', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('Network error occurred')
      );

      await expect(aiosFetch('https://api.example.com')).rejects.toThrow(
        "CORS error:"
      );
    });

    it('should handle blocked error messages', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('Request was blocked')
      );

      await expect(aiosFetch('https://api.example.com')).rejects.toThrow(
        "CORS error:"
      );
    });

    it('should handle access-control-allow-origin error messages', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('No Access-Control-Allow-Origin header present')
      );

      await expect(aiosFetch('https://api.example.com')).rejects.toThrow(
        "CORS error:"
      );
    });
  });

  describe('generic error handling', () => {
    it('should re-throw non-CORS errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('Timeout exceeded')
      );

      await expect(aiosFetch('https://example.com')).rejects.toThrow('Timeout exceeded');
    });

    it('should re-throw non-Error objects', async () => {
      global.fetch = vi.fn().mockRejectedValue('string error');

      await expect(aiosFetch('https://example.com')).rejects.toBe('string error');
    });
  });

  describe('URL handling', () => {
    it('should pass URL to fetch', async () => {
      let capturedUrl: string | undefined;

      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response('OK'));
      });

      await aiosFetch('https://api.example.com/v1/users');

      expect(capturedUrl).toBe('https://api.example.com/v1/users');
    });

    it('should handle CORS errors even with malformed URLs', async () => {
      global.fetch = vi.fn().mockRejectedValue(
        new Error('CORS policy blocked the request')
      );

      // Invalid URL should still get CORS error message
      await expect(aiosFetch('not-a-valid-url')).rejects.toThrow(
        "CORS error: The server doesn't allow requests from this browser."
      );
    });
  });

  describe('default options', () => {
    it('should work with no options provided', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await aiosFetch('https://example.com');

      expect(response).toBeDefined();
      expect(await response.text()).toBe('OK');
    });
  });
});
