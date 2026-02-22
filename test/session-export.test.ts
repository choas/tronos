import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { session } from '../src/engine/builtins/session';
import type { ExecutionContext } from '../src/engine/types';
import { InMemoryVFS } from '../src/vfs/memory';

describe('session export subcommand', () => {
  let vfs: InMemoryVFS;
  let context: ExecutionContext;
  let originalDocument: typeof globalThis.document;
  let originalURL: typeof globalThis.URL;
  let originalBlob: typeof globalThis.Blob;

  // Mock anchor element
  const mockAnchor = {
    href: '',
    download: '',
    click: vi.fn()
  };

  // Captured blob data
  let capturedBlobData = '';

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    mockAnchor.href = '';
    mockAnchor.download = '';
    capturedBlobData = '';

    // Save originals
    originalDocument = globalThis.document;
    originalURL = globalThis.URL;
    originalBlob = globalThis.Blob;

    // Mock document
    (globalThis as any).document = {
      createElement: vi.fn(() => mockAnchor)
    };

    // Mock URL
    (globalThis as any).URL = {
      createObjectURL: vi.fn(() => 'blob:test-url'),
      revokeObjectURL: vi.fn()
    };

    // Mock Blob to capture data
    (globalThis as any).Blob = class MockBlob {
      constructor(parts: BlobPart[], _options?: BlobPropertyBag) {
        capturedBlobData = parts[0] as string;
      }
    };

    // Create a fresh VFS with some test files
    vfs = new InMemoryVFS('test-export');
    await vfs.init();

    // Create some test files
    vfs.write('/home/tronos/test.txt', 'Hello World');
    vfs.write('/home/tronos/.profile', 'alias ll="ls -la"');

    context = {
      stdin: '',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      vfs
    };
  });

  afterEach(() => {
    // Restore originals
    (globalThis as any).document = originalDocument;
    (globalThis as any).URL = originalURL;
    (globalThis as any).Blob = originalBlob;
  });

  it('should export session with correct DiskImage structure', async () => {
    const result = await session(['export'], context);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Exported session');
    expect(result.stderr).toBe('');

    // Check that a download was triggered
    expect((globalThis as any).document.createElement).toHaveBeenCalledWith('a');
    expect(mockAnchor.click).toHaveBeenCalled();
    expect((globalThis as any).URL.createObjectURL).toHaveBeenCalled();
    expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });

  it('should set correct download filename', async () => {
    await session(['export'], context);

    // The download filename should end with .disk
    expect(mockAnchor.download).toMatch(/\.disk$/);
  });

  it('should fail gracefully when VFS is not available', async () => {
    const contextWithoutVFS: ExecutionContext = {
      stdin: '',
      env: {}
    };

    const result = await session(['export'], contextWithoutVFS);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('VFS not available');
  });

  it('should exclude /proc and /dev directories from export', async () => {
    await session(['export'], context);

    // Parse the captured JSON to check structure
    const diskImage = JSON.parse(capturedBlobData);

    // Check that no /proc or /dev paths are in the files
    const paths = Object.keys(diskImage.files);
    expect(paths.some(p => p.startsWith('/proc'))).toBe(false);
    expect(paths.some(p => p.startsWith('/dev'))).toBe(false);
  });

  it('should include regular files in the export', async () => {
    await session(['export'], context);

    // Parse the captured JSON to check structure
    const diskImage = JSON.parse(capturedBlobData);

    // Check that our test files are included
    expect(diskImage.files['/home/tronos/test.txt']).toBeDefined();
    expect(diskImage.files['/home/tronos/test.txt'].content).toBe('Hello World');
    expect(diskImage.files['/home/tronos/test.txt'].type).toBe('file');
  });

  it('should include directories in the export', async () => {
    await session(['export'], context);

    // Parse the captured JSON to check structure
    const diskImage = JSON.parse(capturedBlobData);

    // Check that directories are included
    expect(diskImage.files['/home']).toBeDefined();
    expect(diskImage.files['/home'].type).toBe('directory');
    expect(diskImage.files['/home/tronos']).toBeDefined();
    expect(diskImage.files['/home/tronos'].type).toBe('directory');
  });

  it('should have correct DiskImage version and metadata', async () => {
    await session(['export'], context);

    // Parse the captured JSON to check structure
    const diskImage = JSON.parse(capturedBlobData);

    // Check required fields
    expect(diskImage.version).toBe(1);
    expect(diskImage.name).toBeDefined();
    expect(diskImage.created).toBeDefined();
    expect(diskImage.exported).toBeDefined();

    // Check that exported is an ISO date string
    expect(() => new Date(diskImage.exported)).not.toThrow();
  });

  it('should include session env, aliases, and history', async () => {
    await session(['export'], context);

    // Parse the captured JSON to check structure
    const diskImage = JSON.parse(capturedBlobData);

    // Check session data
    expect(diskImage.session).toBeDefined();
    expect(diskImage.session.env).toBeDefined();
    expect(diskImage.session.aliases).toBeDefined();
    expect(diskImage.session.history).toBeDefined();
    expect(Array.isArray(diskImage.session.history)).toBe(true);
  });

  it('should include file metadata with ISO timestamps', async () => {
    await session(['export'], context);

    // Parse the captured JSON to check structure
    const diskImage = JSON.parse(capturedBlobData);

    // Check metadata for a file
    const testFile = diskImage.files['/home/tronos/test.txt'];
    expect(testFile.meta).toBeDefined();
    expect(testFile.meta.created).toBeDefined();
    expect(testFile.meta.modified).toBeDefined();
    expect(testFile.meta.permissions).toBeDefined();

    // Verify ISO format
    expect(() => new Date(testFile.meta.created)).not.toThrow();
    expect(() => new Date(testFile.meta.modified)).not.toThrow();
  });
});

describe('session command unknown subcommand', () => {
  it('should show export in usage message', async () => {
    const context: ExecutionContext = {
      stdin: '',
      env: {}
    };

    const result = await session(['unknown'], context);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('export');
  });
});
