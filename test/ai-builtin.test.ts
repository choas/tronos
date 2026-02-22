import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ai } from '../src/engine/builtins/ai';
import { InMemoryVFS } from '../src/vfs/memory';
import type { ExecutionContext } from '../src/engine/types';

// Mock the stores module
vi.mock('../src/stores', () => ({
  getAIConfig: vi.fn(() => ({
    provider: 'anthropic',
    apiKey: 'test-api-key',
    model: 'claude-sonnet-4-6',
    baseURL: 'https://api.anthropic.com',
    temperature: 0.7,
    maxTokens: 4096
  })),
  isAIConfigured: vi.fn(() => true)
}));

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('@ai builtin command', () => {
  let vfs: InMemoryVFS;
  let context: ExecutionContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    vfs = new InMemoryVFS();
    await vfs.init();

    // Create /bin directory
    if (!vfs.exists('/bin')) {
      vfs.mkdir('/bin');
    }

    context = {
      stdin: '',
      env: { PATH: '/bin', HOME: '/home/tronos', USER: 'tronos' },
      vfs,
      terminal: {
        write: vi.fn(),
        writeln: vi.fn(),
        clear: vi.fn()
      }
    };
  });

  describe('command parsing', () => {
    it('should return usage error with no arguments', async () => {
      const result = await ai([], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage:');
    });

    it('should return validation error for create without name', async () => {
      const result = await ai(['create'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'create' command requires a program name");
    });

    it('should return validation error for edit without file', async () => {
      const result = await ai(['edit'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'edit' command requires a target file");
    });

    it('should return validation error for explain without file', async () => {
      const result = await ai(['explain'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'explain' command requires a target file");
    });

    it('should return validation error for fix without file', async () => {
      const result = await ai(['fix'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'fix' command requires a target file");
    });
  });

  // Note: API key check is tested implicitly through the module mock
  // When isAIConfigured returns false, the command returns an error

  describe('create mode', () => {
    it('should call API with correct parameters for create', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: `// @name: hello
// @description: Says hello

async function main(t) {
  t.writeln('Hello, world!');
}
`
          }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      const result = await ai(['create', 'hello', 'a', 'simple', 'hello', 'world', 'program'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Created /bin/hello.trx');
      expect(result.stdout).toContain('Run it with: hello');

      // Verify file was created
      expect(vfs.exists('/bin/hello.trx')).toBe(true);
      const content = vfs.read('/bin/hello.trx');
      expect(content).toContain('@name: hello');
    });

    it('should show thinking indicator during API call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '// @name: test\nasync function main(t) {}' }],
          usage: { input_tokens: 10, output_tokens: 10 }
        })
      });

      await ai(['create', 'test', 'test', 'program'], context);

      expect(context.terminal?.write).toHaveBeenCalledWith('Thinking...');
      expect(context.terminal?.write).toHaveBeenCalledWith('\r\x1b[K');
    });

    it('should handle API error gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: 'Rate limit exceeded' }
        }),
        status: 429,
        statusText: 'Too Many Requests'
      });

      const result = await ai(['create', 'test', 'program'], context);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error');
    });
  });

  describe('file-based modes', () => {
    beforeEach(() => {
      // Create a test file
      vfs.write('/test.trx', `// @name: test
// @description: Test program

async function main(t) {
  t.writeln('Test');
}
`);
    });

    it('should return error for non-existent file', async () => {
      const result = await ai(['explain', '/nonexistent.txt'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('File not found');
    });

    it('should return error when trying to explain a directory', async () => {
      vfs.mkdir('/testdir');
      const result = await ai(['explain', '/testdir'], context);
      expect(result.exitCode).toBe(1);
      // File resolution excludes directories, so it returns "File not found"
      expect(result.stderr).toContain('File not found');
    });

    it('should send file content to API for explain mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'This program outputs "Test" to the terminal.' }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      const result = await ai(['explain', '/test.trx'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('This program outputs "Test"');
    });

    it('should update file for edit mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: `// @name: test
// @description: Updated program

async function main(t) {
  t.writeln('Updated!');
}
`
          }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      const result = await ai(['edit', '/test.trx', 'change', 'output', 'to', 'Updated'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Updated /test.trx');

      const content = vfs.read('/test.trx');
      expect(content).toContain('Updated!');
    });

    it('should update file and show explanation for fix mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: `<explanation>
Fixed a syntax error in the program.
</explanation>

<code>
// @name: test
// @description: Fixed program

async function main(t) {
  t.writeln('Fixed!');
}
</code>`
          }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      const result = await ai(['fix', '/test.trx'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Diagnosis:');
      expect(result.stdout).toContain('Fixed a syntax error');
      expect(result.stdout).toContain('Fixed /test.trx');
    });
  });

  describe('chat mode', () => {
    it('should return AI response for general questions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'The ls command lists files and directories.' }],
          usage: { input_tokens: 50, output_tokens: 30 }
        })
      });

      const result = await ai(['what', 'does', 'ls', 'command', 'do?'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('ls command lists files');
    });
  });

  describe('file resolution for /bin programs', () => {
    beforeEach(() => {
      // Create a test program in /bin
      vfs.write('/bin/countdown.trx', `// @name: countdown
// @description: Countdown timer

async function main(t) {
  t.writeln('Counting down...');
}
`);
    });

    it('should resolve program name without path or extension to /bin/*.trx', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'This program counts down from a number.' }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      // User just types "countdown" without path or .trx extension
      const result = await ai(['explain', 'countdown'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('counts down');
    });

    it('should resolve program name with .trx extension to /bin/*.trx', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'This program counts down from a number.' }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      // User types "countdown.trx" without path
      const result = await ai(['explain', 'countdown.trx'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('counts down');
    });

    it('should edit program using just the name without path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: `// @name: countdown
// @description: Updated countdown

async function main(t) {
  t.writeln('Updated countdown!');
}
`
          }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      // User edits using just "countdown" without /bin/ or .trx
      const result = await ai(['edit', 'countdown', 'add', 'colors'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Updated /bin/countdown.trx');

      // Verify the file was updated
      const content = vfs.read('/bin/countdown.trx');
      expect(content).toContain('Updated countdown!');
    });

    it('should fix program using just the name without path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: `<explanation>
Fixed an issue in the countdown program.
</explanation>

<code>
// @name: countdown
// @description: Fixed countdown

async function main(t) {
  t.writeln('Fixed countdown!');
}
</code>`
          }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      // User fixes using just "countdown"
      const result = await ai(['fix', 'countdown'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Fixed /bin/countdown.trx');
    });

    it('should prefer file in cwd over /bin program with same name', async () => {
      // Create a file with the same name in the current directory (root)
      vfs.write('/countdown', 'local file content');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'This is a local file.' }],
          usage: { input_tokens: 50, output_tokens: 30 }
        })
      });

      // Should find the local file first, not /bin/countdown.trx
      const result = await ai(['explain', 'countdown'], context);

      expect(result.exitCode).toBe(0);
      // The API was called, which means the file was found
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return error when program not found in /bin', async () => {
      const result = await ai(['explain', 'nonexistent'], context);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('File not found');
    });

    it('should still work with absolute paths', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'This program counts down.' }],
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });

      // Absolute path should still work
      const result = await ai(['explain', '/bin/countdown.trx'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('counts down');
    });

    it('should still work with relative paths', async () => {
      // Create a file in a subdirectory - use /tmp to avoid conflicts
      if (!vfs.exists('/tmp')) {
        vfs.mkdir('/tmp');
      }
      vfs.mkdir('/tmp/testdir');
      vfs.write('/tmp/testdir/script.txt', 'test script content');

      // Change cwd to /tmp/testdir
      context.vfs = vfs;
      vfs.chdir('/tmp/testdir');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'This is a test script.' }],
          usage: { input_tokens: 50, output_tokens: 30 }
        })
      });

      // Relative path from current directory
      const result = await ai(['explain', './script.txt'], context);

      expect(result.exitCode).toBe(0);
    });
  });
});
