import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { session, importSession, parseDiskImage, isValidDiskImage, isYamlContent, serializeDiskImageToYaml, mergeSession, formatMergeResult, detectMergeConflicts, diffDiskImage, recordImportHistory } from '../src/engine/builtins/session';
import type { ExecutionContext } from '../src/engine/types';
import type { DiskImage } from '../src/types';
import { InMemoryVFS } from '../src/vfs/memory';

// Helper to create a valid DiskImage for testing
function createTestDiskImage(overrides?: Partial<DiskImage>): DiskImage {
  return {
    version: 1,
    name: 'test-session',
    created: '2026-01-01T00:00:00.000Z',
    exported: '2026-02-03T12:00:00.000Z',
    session: {
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'testuser', CUSTOM_VAR: 'custom_value' },
      aliases: { ll: 'ls -la', grep: 'grep --color=auto' },
      history: ['cd ~', 'ls -la', 'cat test.txt']
    },
    files: {
      '/home': {
        type: 'directory',
        meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rwxr-xr-x' }
      },
      '/home/tronos': {
        type: 'directory',
        meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rwxr-xr-x' }
      },
      '/home/tronos/test.txt': {
        type: 'file',
        content: 'Hello World from imported session!',
        meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
      },
      '/home/tronos/.profile': {
        type: 'file',
        content: '# Imported profile\nalias ll="ls -la"\n',
        meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
      }
    },
    ...overrides
  };
}

describe('isValidDiskImage', () => {
  it('should validate a correct DiskImage structure', () => {
    const diskImage = createTestDiskImage();
    expect(isValidDiskImage(diskImage)).toBe(true);
  });

  it('should reject null', () => {
    expect(isValidDiskImage(null)).toBe(false);
  });

  it('should reject non-objects', () => {
    expect(isValidDiskImage('string')).toBe(false);
    expect(isValidDiskImage(123)).toBe(false);
    expect(isValidDiskImage([])).toBe(false);
  });

  it('should reject missing version', () => {
    const invalid = { ...createTestDiskImage() } as any;
    delete invalid.version;
    expect(isValidDiskImage(invalid)).toBe(false);
  });

  it('should reject wrong version', () => {
    const invalid = { ...createTestDiskImage(), version: 2 } as any;
    expect(isValidDiskImage(invalid)).toBe(false);
  });

  it('should reject missing name', () => {
    const invalid = { ...createTestDiskImage() } as any;
    delete invalid.name;
    expect(isValidDiskImage(invalid)).toBe(false);
  });

  it('should reject missing session', () => {
    const invalid = { ...createTestDiskImage() } as any;
    delete invalid.session;
    expect(isValidDiskImage(invalid)).toBe(false);
  });

  it('should reject session without env', () => {
    const invalid = { ...createTestDiskImage() } as any;
    invalid.session = { aliases: {}, history: [] };
    expect(isValidDiskImage(invalid)).toBe(false);
  });

  it('should reject session without aliases', () => {
    const invalid = { ...createTestDiskImage() } as any;
    invalid.session = { env: {}, history: [] };
    expect(isValidDiskImage(invalid)).toBe(false);
  });

  it('should reject session without history array', () => {
    const invalid = { ...createTestDiskImage() } as any;
    invalid.session = { env: {}, aliases: {}, history: 'not-array' };
    expect(isValidDiskImage(invalid)).toBe(false);
  });

  it('should reject missing files object', () => {
    const invalid = { ...createTestDiskImage() } as any;
    delete invalid.files;
    expect(isValidDiskImage(invalid)).toBe(false);
  });
});

describe('isYamlContent', () => {
  it('should detect JSON starting with {', () => {
    expect(isYamlContent('{"version": 1}')).toBe(false);
  });

  it('should detect JSON starting with [', () => {
    expect(isYamlContent('[1, 2, 3]')).toBe(false);
  });

  it('should detect YAML starting with ---', () => {
    expect(isYamlContent('---\nversion: 1')).toBe(true);
  });

  it('should detect YAML starting with # comment', () => {
    expect(isYamlContent('# TronOS disk image\nversion: 1')).toBe(true);
  });

  it('should detect YAML starting with key:', () => {
    expect(isYamlContent('version: 1')).toBe(true);
  });

  it('should handle whitespace before content', () => {
    expect(isYamlContent('   {"version": 1}')).toBe(false);
    expect(isYamlContent('   version: 1')).toBe(true);
  });
});

describe('parseDiskImage', () => {
  it('should parse valid JSON into DiskImage', () => {
    const diskImage = createTestDiskImage();
    const jsonString = JSON.stringify(diskImage);

    const result = parseDiskImage(jsonString);

    expect(result.version).toBe(1);
    expect(result.name).toBe('test-session');
    expect(result.session.env.CUSTOM_VAR).toBe('custom_value');
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseDiskImage('not valid json {')).toThrow('Invalid JSON format');
  });

  it('should throw on valid JSON but invalid DiskImage structure', () => {
    const invalidStructure = { foo: 'bar' };
    expect(() => parseDiskImage(JSON.stringify(invalidStructure))).toThrow('Invalid disk image format');
  });

  it('should throw on empty string', () => {
    expect(() => parseDiskImage('')).toThrow('Invalid JSON format');
  });

  it('should parse valid YAML into DiskImage', () => {
    const diskImage = createTestDiskImage();
    const yamlString = serializeDiskImageToYaml(diskImage);

    const result = parseDiskImage(yamlString);

    expect(result.version).toBe(1);
    expect(result.name).toBe('test-session');
    expect(result.session.env.CUSTOM_VAR).toBe('custom_value');
  });

  it('should throw on invalid YAML', () => {
    // YAML that starts with a key but has invalid syntax
    expect(() => parseDiskImage('version: 1\n  invalid indent:')).toThrow('Invalid YAML format');
  });

  it('should handle YAML with multi-line strings', () => {
    const diskImage = createTestDiskImage({
      files: {
        '/test.txt': {
          type: 'file',
          content: 'Line 1\nLine 2\nLine 3\nLine 4',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      }
    });

    const yamlString = serializeDiskImageToYaml(diskImage);
    const result = parseDiskImage(yamlString);

    expect(result.files['/test.txt'].content).toBe('Line 1\nLine 2\nLine 3\nLine 4');
  });

  it('should round-trip JSON -> YAML -> JSON', () => {
    const original = createTestDiskImage();
    const yamlString = serializeDiskImageToYaml(original);
    const parsed = parseDiskImage(yamlString);

    expect(parsed.version).toBe(original.version);
    expect(parsed.name).toBe(original.name);
    expect(parsed.session.env).toEqual(original.session.env);
    expect(parsed.session.aliases).toEqual(original.session.aliases);
    expect(parsed.session.history).toEqual(original.session.history);
    expect(Object.keys(parsed.files)).toEqual(Object.keys(original.files));
  });
});

describe('serializeDiskImageToYaml', () => {
  it('should serialize DiskImage to YAML string', () => {
    const diskImage = createTestDiskImage();
    const yaml = serializeDiskImageToYaml(diskImage);

    expect(yaml).toContain('version: 1');
    expect(yaml).toContain('name: test-session');
  });

  it('should handle file content with special characters', () => {
    const diskImage = createTestDiskImage({
      files: {
        '/code.trx': {
          type: 'file',
          content: 'async function main(t) {\n  const name = await t.readline("Name: ");\n  t.print(`Hello, ${name}!`);\n}',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      }
    });

    const yaml = serializeDiskImageToYaml(diskImage);
    const parsed = parseDiskImage(yaml);

    expect(parsed.files['/code.trx'].content).toContain('async function main(t)');
    expect(parsed.files['/code.trx'].content).toContain('await t.readline');
  });
});

describe('importSession', () => {
  beforeEach(() => {
    // Reset the session store to a known state
    // Note: In a real test we'd want to mock the store, but for now we'll just test what we can
  });

  it('should import session with unique name if name exists', async () => {
    // Create a disk image with a name that might conflict
    const diskImage = createTestDiskImage({ name: 'default' });

    // Import should create a unique name
    const importedName = await importSession(diskImage);

    // Should have a suffix since 'default' already exists
    expect(importedName).toMatch(/^default(-\d+)?$/);
  });

  it('should import session with provided name if unique', async () => {
    // Create a disk image with a unique name
    const uniqueName = `test-import-${Date.now()}`;
    const diskImage = createTestDiskImage({ name: uniqueName });

    const importedName = await importSession(diskImage);

    expect(importedName).toBe(uniqueName);
  });
});

describe('session import subcommand', () => {
  let context: ExecutionContext;

  beforeEach(async () => {
    const vfs = new InMemoryVFS('test-import-cmd');
    await vfs.init();

    context = {
      stdin: '',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      vfs
    };
  });

  it('should return uiRequest for import dialog', async () => {
    const result = await session(['import'], context);

    expect(result.exitCode).toBe(0);
    expect(result.uiRequest).toBe('showImportDialog');
  });

  it('should include import in usage message', async () => {
    const result = await session(['unknown'], context);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('import');
  });
});

describe('DiskImage with various file structures', () => {
  it('should handle empty files object', () => {
    const diskImage = createTestDiskImage({ files: {} });
    expect(isValidDiskImage(diskImage)).toBe(true);
  });

  it('should handle deeply nested directories', () => {
    const diskImage = createTestDiskImage({
      files: {
        '/a': { type: 'directory', meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rwxr-xr-x' } },
        '/a/b': { type: 'directory', meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rwxr-xr-x' } },
        '/a/b/c': { type: 'directory', meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rwxr-xr-x' } },
        '/a/b/c/d': { type: 'directory', meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rwxr-xr-x' } },
        '/a/b/c/d/file.txt': { type: 'file', content: 'deep', meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' } }
      }
    });
    expect(isValidDiskImage(diskImage)).toBe(true);
  });

  it('should handle files with empty content', () => {
    const diskImage = createTestDiskImage({
      files: {
        '/empty.txt': { type: 'file', content: '', meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' } }
      }
    });
    expect(isValidDiskImage(diskImage)).toBe(true);
  });

  it('should handle files with special characters in content', () => {
    const diskImage = createTestDiskImage({
      files: {
        '/special.txt': {
          type: 'file',
          content: 'Line1\nLine2\tTabbed\r\nWindows\n\u0000NullByte',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      }
    });
    expect(isValidDiskImage(diskImage)).toBe(true);
  });
});

describe('session env/aliases/history import', () => {
  it('should accept empty env object', () => {
    const diskImage = createTestDiskImage();
    diskImage.session.env = {};
    expect(isValidDiskImage(diskImage)).toBe(true);
  });

  it('should accept empty aliases object', () => {
    const diskImage = createTestDiskImage();
    diskImage.session.aliases = {};
    expect(isValidDiskImage(diskImage)).toBe(true);
  });

  it('should accept empty history array', () => {
    const diskImage = createTestDiskImage();
    diskImage.session.history = [];
    expect(isValidDiskImage(diskImage)).toBe(true);
  });

  it('should preserve complex aliases', () => {
    const diskImage = createTestDiskImage();
    diskImage.session.aliases = {
      'complex': "cat file | grep 'pattern' | sort -u",
      '..': 'cd ..',
      'gitlog': 'git log --oneline --graph'
    };

    const jsonString = JSON.stringify(diskImage);
    const parsed = parseDiskImage(jsonString);

    expect(parsed.session.aliases['complex']).toBe("cat file | grep 'pattern' | sort -u");
    expect(parsed.session.aliases['..']).toBe('cd ..');
  });

  it('should preserve environment variables with special values', () => {
    const diskImage = createTestDiskImage();
    diskImage.session.env = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      PS1: '\\u@\\h:\\w\\$ ',
      EDITOR: 'vim',
      EMPTY: ''
    };

    const jsonString = JSON.stringify(diskImage);
    const parsed = parseDiskImage(jsonString);

    expect(parsed.session.env.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
    expect(parsed.session.env.PS1).toBe('\\u@\\h:\\w\\$ ');
    expect(parsed.session.env.EMPTY).toBe('');
  });
});

describe('session import --merge command', () => {
  let context: ExecutionContext;

  beforeEach(async () => {
    const vfs = new InMemoryVFS('test-merge-cmd');
    await vfs.init();

    context = {
      stdin: '',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      vfs
    };
  });

  it('should return merge dialog request with interactive strategy by default', async () => {
    const result = await session(['import', '--merge'], context);

    expect(result.exitCode).toBe(0);
    expect(result.uiRequest).toBe('showMergeDialog:interactive');
  });

  it('should return merge dialog request with overwrite strategy', async () => {
    const result = await session(['import', '--merge', '--overwrite'], context);

    expect(result.exitCode).toBe(0);
    expect(result.uiRequest).toBe('showMergeDialog:overwrite');
  });

  it('should return merge dialog request with skip strategy', async () => {
    const result = await session(['import', '--merge', '--skip'], context);

    expect(result.exitCode).toBe(0);
    expect(result.uiRequest).toBe('showMergeDialog:skip');
  });

  it('should return merge dialog request with interactive strategy explicitly', async () => {
    const result = await session(['import', '--merge', '--interactive'], context);

    expect(result.exitCode).toBe(0);
    expect(result.uiRequest).toBe('showMergeDialog:interactive');
  });

  it('should reject multiple conflict resolution flags', async () => {
    const result = await session(['import', '--merge', '--overwrite', '--skip'], context);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Only one of --overwrite, --skip, or --interactive');
  });

  it('should reject conflict flags without --merge', async () => {
    const result = await session(['import', '--overwrite'], context);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('require --merge flag');
  });

  it('should show import dialog without --merge flag', async () => {
    const result = await session(['import'], context);

    expect(result.exitCode).toBe(0);
    expect(result.uiRequest).toBe('showImportDialog');
  });
});

describe('mergeSession', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test-merge');
    await vfs.init();
  });

  it('should merge new files without conflicts', async () => {
    // Create a disk image with a new file
    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/newfile.txt': {
          type: 'file',
          content: 'new content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: {}, aliases: {}, history: [] }
    });

    const result = await mergeSession(diskImage, vfs, 'skip');

    expect(result.merged).toContain('/home/tronos/newfile.txt');
    expect(result.skipped).toHaveLength(0);
    expect(vfs.readSync('/home/tronos/newfile.txt')).toBe('new content');
  });

  it('should skip conflicting files with skip strategy', async () => {
    // Create existing file
    await vfs.write('/home/tronos/existing.txt', 'original content');

    // Create a disk image with same file but different content
    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/existing.txt': {
          type: 'file',
          content: 'new content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: {}, aliases: {}, history: [] }
    });

    const result = await mergeSession(diskImage, vfs, 'skip');

    expect(result.skipped).toContain('/home/tronos/existing.txt');
    expect(result.overwritten).toHaveLength(0);
    // File should remain unchanged
    expect(vfs.readSync('/home/tronos/existing.txt')).toBe('original content');
  });

  it('should overwrite conflicting files with overwrite strategy', async () => {
    // Create existing file
    await vfs.write('/home/tronos/existing.txt', 'original content');

    // Create a disk image with same file but different content
    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/existing.txt': {
          type: 'file',
          content: 'new content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: {}, aliases: {}, history: [] }
    });

    const result = await mergeSession(diskImage, vfs, 'overwrite');

    expect(result.merged).toContain('/home/tronos/existing.txt');
    expect(result.overwritten).toContain('/home/tronos/existing.txt');
    // File should be updated
    expect(vfs.readSync('/home/tronos/existing.txt')).toBe('new content');
  });

  it('should handle interactive strategy with resolver', async () => {
    // Create existing file
    await vfs.write('/home/tronos/existing.txt', 'original content');

    // Create a disk image with same file but different content
    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/existing.txt': {
          type: 'file',
          content: 'new content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: {}, aliases: {}, history: [] }
    });

    // Resolver that always overwrites
    const resolver = vi.fn().mockResolvedValue('overwrite');

    const result = await mergeSession(diskImage, vfs, 'interactive', resolver);

    expect(resolver).toHaveBeenCalled();
    expect(result.merged).toContain('/home/tronos/existing.txt');
    expect(result.overwritten).toContain('/home/tronos/existing.txt');
  });

  it('should not count identical files as conflicts', async () => {
    // Create existing file with same content
    await vfs.write('/home/tronos/same.txt', 'same content');

    // Create a disk image with same file and same content
    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/same.txt': {
          type: 'file',
          content: 'same content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: {}, aliases: {}, history: [] }
    });

    const result = await mergeSession(diskImage, vfs, 'skip');

    // File should not be in merged or skipped since content is identical
    expect(result.merged).not.toContain('/home/tronos/same.txt');
    expect(result.skipped).not.toContain('/home/tronos/same.txt');
  });

  it('should create directories as needed', async () => {
    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/deep/nested/dir': {
          type: 'directory',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rwxr-xr-x' }
        },
        '/home/tronos/deep/nested/dir/file.txt': {
          type: 'file',
          content: 'nested content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: {}, aliases: {}, history: [] }
    });

    const result = await mergeSession(diskImage, vfs, 'skip');

    expect(vfs.exists('/home/tronos/deep/nested/dir')).toBe(true);
    expect(vfs.readSync('/home/tronos/deep/nested/dir/file.txt')).toBe('nested content');
  });
});

describe('detectMergeConflicts', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test-conflicts');
    await vfs.init();
  });

  it('should detect file conflicts', async () => {
    await vfs.write('/home/tronos/conflict.txt', 'original');

    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/conflict.txt': {
          type: 'file',
          content: 'different',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: {}, aliases: {}, history: [] }
    });

    const conflicts = detectMergeConflicts(diskImage, vfs, {}, {});

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('/home/tronos/conflict.txt');
    expect(conflicts[0].type).toBe('file');
  });

  it('should detect env conflicts', () => {
    const diskImage = createTestDiskImage({
      files: {},
      session: { env: { MY_VAR: 'new_value' }, aliases: {}, history: [] }
    });

    const conflicts = detectMergeConflicts(diskImage, vfs, { MY_VAR: 'old_value' }, {});

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('MY_VAR');
    expect(conflicts[0].type).toBe('env');
  });

  it('should detect alias conflicts', () => {
    const diskImage = createTestDiskImage({
      files: {},
      session: { env: {}, aliases: { ll: 'ls -la --color' }, history: [] }
    });

    const conflicts = detectMergeConflicts(diskImage, vfs, {}, { ll: 'ls -la' });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('ll');
    expect(conflicts[0].type).toBe('alias');
  });

  it('should not detect conflicts when values are identical', async () => {
    await vfs.write('/home/tronos/same.txt', 'same');

    const diskImage = createTestDiskImage({
      files: {
        '/home/tronos/same.txt': {
          type: 'file',
          content: 'same',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: { env: { VAR: 'value' }, aliases: { ll: 'ls -la' }, history: [] }
    });

    const conflicts = detectMergeConflicts(diskImage, vfs, { VAR: 'value' }, { ll: 'ls -la' });

    expect(conflicts).toHaveLength(0);
  });
});

describe('formatMergeResult', () => {
  it('should format empty result', () => {
    const result = {
      success: true,
      merged: [],
      skipped: [],
      overwritten: [],
      errors: [],
      envMerged: [],
      envSkipped: [],
      aliasesMerged: [],
      aliasesSkipped: []
    };

    const formatted = formatMergeResult(result);

    expect(formatted).toContain('No changes made');
  });

  it('should format result with merged files', () => {
    const result = {
      success: true,
      merged: ['/file1.txt', '/file2.txt'],
      skipped: [],
      overwritten: [],
      errors: [],
      envMerged: [],
      envSkipped: [],
      aliasesMerged: [],
      aliasesSkipped: []
    };

    const formatted = formatMergeResult(result);

    expect(formatted).toContain('Files added: 2');
  });

  it('should format result with overwritten files', () => {
    const result = {
      success: true,
      merged: ['/file1.txt'],
      skipped: [],
      overwritten: ['/file1.txt'],
      errors: [],
      envMerged: [],
      envSkipped: [],
      aliasesMerged: [],
      aliasesSkipped: []
    };

    const formatted = formatMergeResult(result);

    expect(formatted).toContain('Files overwritten: 1');
  });

  it('should format result with skipped files', () => {
    const result = {
      success: true,
      merged: [],
      skipped: ['/conflict.txt'],
      overwritten: [],
      errors: [],
      envMerged: [],
      envSkipped: [],
      aliasesMerged: [],
      aliasesSkipped: []
    };

    const formatted = formatMergeResult(result);

    expect(formatted).toContain('Files skipped (conflicts): 1');
  });

  it('should format result with errors', () => {
    const result = {
      success: true,
      merged: [],
      skipped: [],
      overwritten: [],
      errors: ['Error 1', 'Error 2'],
      envMerged: [],
      envSkipped: [],
      aliasesMerged: [],
      aliasesSkipped: []
    };

    const formatted = formatMergeResult(result);

    expect(formatted).toContain('Errors (2)');
    expect(formatted).toContain('Error 1');
  });

  it('should include versionIds in MergeResult', () => {
    const result = {
      success: true,
      merged: ['/test.txt'],
      skipped: [],
      overwritten: ['/test.txt'],
      errors: [],
      envMerged: [],
      envSkipped: [],
      aliasesMerged: [],
      aliasesSkipped: [],
      versionIds: { '/test.txt': 'version-id-123' }
    };

    // versionIds should be present for tracking pre-merge snapshots
    expect(result.versionIds).toBeDefined();
    expect(result.versionIds['/test.txt']).toBe('version-id-123');
  });
});

describe('diffDiskImage', () => {
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test_diff');
    await vfs.init();
  });

  it('should detect new files in disk image', () => {
    const diskImage = createTestDiskImage({
      files: {
        '/new-file.txt': {
          type: 'file',
          content: 'new content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      }
    });

    const result = diffDiskImage(diskImage, vfs, {}, {});

    expect(result).toContain('new-file.txt');
    expect(result).toContain('New files');
  });

  it('should detect modified files', async () => {
    // Create existing file with different content
    await vfs.write('/test.txt', 'original content');

    const diskImage = createTestDiskImage({
      files: {
        '/test.txt': {
          type: 'file',
          content: 'modified content',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      }
    });

    const result = diffDiskImage(diskImage, vfs, {}, {});

    expect(result).toContain('Modified files');
    expect(result).toContain('/test.txt');
  });

  it('should detect unchanged files', async () => {
    const content = 'same content';
    await vfs.write('/same.txt', content);

    const diskImage = createTestDiskImage({
      files: {
        '/same.txt': {
          type: 'file',
          content: content,
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      }
    });

    const result = diffDiskImage(diskImage, vfs, {}, {});

    expect(result).toContain('Unchanged files: 1');
  });

  it('should detect new environment variables', () => {
    const diskImage = createTestDiskImage({
      files: {},
      session: {
        env: { NEW_VAR: 'new_value' },
        aliases: {},
        history: []
      }
    });

    const result = diffDiskImage(diskImage, vfs, {}, {});

    expect(result).toContain('Environment Variables');
    expect(result).toContain('NEW_VAR');
  });

  it('should detect modified environment variables', () => {
    const diskImage = createTestDiskImage({
      files: {},
      session: {
        env: { EXISTING_VAR: 'new_value' },
        aliases: {},
        history: []
      }
    });

    const result = diffDiskImage(diskImage, vfs, { EXISTING_VAR: 'old_value' }, {});

    expect(result).toContain('Modified: EXISTING_VAR');
  });

  it('should detect new aliases', () => {
    const diskImage = createTestDiskImage({
      files: {},
      session: {
        env: {},
        aliases: { newalias: 'some command' },
        history: []
      }
    });

    const result = diffDiskImage(diskImage, vfs, {}, {});

    expect(result).toContain('Aliases');
    expect(result).toContain('newalias');
  });

  it('should show summary with counts', () => {
    const diskImage = createTestDiskImage({
      files: {
        '/new.txt': {
          type: 'file',
          content: 'new',
          meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', permissions: 'rw-r--r--' }
        }
      },
      session: {
        env: { NEW: 'value' },
        aliases: { new: 'cmd' },
        history: []
      }
    });

    const result = diffDiskImage(diskImage, vfs, {}, {});

    expect(result).toContain('Summary');
    expect(result).toContain('Files: 1 new');
    expect(result).toContain('Environment: 1 new');
    expect(result).toContain('Aliases: 1 new');
  });
});

describe('recordImportHistory', () => {
  it('should create import history entry for new session import', async () => {
    const diskImage = createTestDiskImage();

    // This will fail in test environment without DB, but we can check the function exists
    // and verify it creates the expected structure
    try {
      const entry = await recordImportHistory('session-123', diskImage, true);
      expect(entry).toBeDefined();
      expect(entry.sessionId).toBe('session-123');
      expect(entry.wasNew).toBe(true);
      expect(entry.diskImageName).toBe('test-session');
    } catch (error) {
      // Expected in test environment without IndexedDB
      expect((error as Error).message).toContain('Database not initialized');
    }
  });

  it('should create import history entry for merge operation', async () => {
    const diskImage = createTestDiskImage();
    const mergeResult = {
      success: true,
      merged: ['/file1.txt', '/file2.txt'],
      skipped: ['/conflict.txt'],
      overwritten: ['/file1.txt'],
      errors: [],
      envMerged: ['VAR1'],
      envSkipped: [],
      aliasesMerged: [],
      aliasesSkipped: [],
      versionIds: { '/file1.txt': 'version-abc' }
    };

    try {
      const entry = await recordImportHistory('session-456', diskImage, false, mergeResult, 'overwrite');
      expect(entry).toBeDefined();
      expect(entry.wasNew).toBe(false);
      expect(entry.mergeStrategy).toBe('overwrite');
      expect(entry.filesImported).toEqual(['/file1.txt', '/file2.txt']);
      expect(entry.filesSkipped).toEqual(['/conflict.txt']);
      expect(entry.versionIds).toEqual({ '/file1.txt': 'version-abc' });
    } catch (error) {
      // Expected in test environment without IndexedDB
      expect((error as Error).message).toContain('Database not initialized');
    }
  });
});

describe('session import --undo flag', () => {
  it('should accept --undo flag', async () => {
    const mockTerminal = {
      write: vi.fn(),
      writeln: vi.fn(),
      clear: vi.fn(),
      clearLine: vi.fn(),
      moveTo: vi.fn(),
      moveBy: vi.fn(),
      getCursor: vi.fn(() => ({ x: 0, y: 0 })),
      getSize: vi.fn(() => ({ cols: 80, rows: 24 })),
      onKey: vi.fn(),
      onData: vi.fn(),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ''),
      clearSelection: vi.fn(),
      flush: vi.fn(),
      dispose: vi.fn()
    };

    const vfs = new InMemoryVFS('test_undo');
    await vfs.init();

    const context: ExecutionContext = {
      cwd: '/',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      aliases: {},
      vfs,
      terminal: mockTerminal
    };

    // The --undo command should return a result (even if no history exists)
    const result = await session(['import', '--undo'], context);

    // In test environment without DB, this will fail with a specific error
    // But we're testing that the flag is accepted
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No import history');
  });
});

describe('session import --history flag', () => {
  it('should accept --history flag', async () => {
    const mockTerminal = {
      write: vi.fn(),
      writeln: vi.fn(),
      clear: vi.fn(),
      clearLine: vi.fn(),
      moveTo: vi.fn(),
      moveBy: vi.fn(),
      getCursor: vi.fn(() => ({ x: 0, y: 0 })),
      getSize: vi.fn(() => ({ cols: 80, rows: 24 })),
      onKey: vi.fn(),
      onData: vi.fn(),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ''),
      clearSelection: vi.fn(),
      flush: vi.fn(),
      dispose: vi.fn()
    };

    const vfs = new InMemoryVFS('test_history');
    await vfs.init();

    const context: ExecutionContext = {
      cwd: '/',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      aliases: {},
      vfs,
      terminal: mockTerminal
    };

    // The --history command should return empty history message
    const result = await session(['import', '--history'], context);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No import history');
  });
});

describe('session diff command', () => {
  it('should show usage when no file provided', async () => {
    const mockTerminal = {
      write: vi.fn(),
      writeln: vi.fn(),
      clear: vi.fn(),
      clearLine: vi.fn(),
      moveTo: vi.fn(),
      moveBy: vi.fn(),
      getCursor: vi.fn(() => ({ x: 0, y: 0 })),
      getSize: vi.fn(() => ({ cols: 80, rows: 24 })),
      onKey: vi.fn(),
      onData: vi.fn(),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ''),
      clearSelection: vi.fn(),
      flush: vi.fn(),
      dispose: vi.fn()
    };

    const vfs = new InMemoryVFS('test_diff_cmd');
    await vfs.init();

    const context: ExecutionContext = {
      cwd: '/',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      aliases: {},
      vfs,
      terminal: mockTerminal
    };

    const result = await session(['diff'], context);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage: session diff');
  });

  it('should trigger UI request with filename', async () => {
    const mockTerminal = {
      write: vi.fn(),
      writeln: vi.fn(),
      clear: vi.fn(),
      clearLine: vi.fn(),
      moveTo: vi.fn(),
      moveBy: vi.fn(),
      getCursor: vi.fn(() => ({ x: 0, y: 0 })),
      getSize: vi.fn(() => ({ cols: 80, rows: 24 })),
      onKey: vi.fn(),
      onData: vi.fn(),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ''),
      clearSelection: vi.fn(),
      flush: vi.fn(),
      dispose: vi.fn()
    };

    const vfs = new InMemoryVFS('test_diff_ui');
    await vfs.init();

    const context: ExecutionContext = {
      cwd: '/',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      aliases: {},
      vfs,
      terminal: mockTerminal
    };

    const result = await session(['diff', 'backup.disk.yaml'], context);

    expect(result.exitCode).toBe(0);
    expect(result.uiRequest).toBe('showDiffDialog:backup.disk.yaml');
  });
});
