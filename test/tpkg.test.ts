import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  tpkg,
  getPackageConfigValue,
  setPackageConfigValue,
  parseVersion,
  compareVersions,
  satisfiesVersion,
  validateConfigInput,
  BUNDLED_PACKAGE_INDEX,
  BUNDLED_PACKAGE_MANIFESTS,
  BUNDLED_PACKAGE_FILES
} from '../src/engine/builtins/tpkg';
import type { ExecutionContext } from '../src/engine/types';
import { InMemoryVFS } from '../src/vfs/memory';
import { encryptSecret, decryptSecret, isEncryptedSecret } from '../src/persistence/crypto';

describe('tpkg builtin', () => {
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

  describe('help subcommand', () => {
    it('should show help with no arguments', async () => {
      const result = await tpkg([], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tpkg - TronOS Package Manager');
      expect(result.stdout).toContain('install');
      expect(result.stdout).toContain('uninstall');
      expect(result.stdout).toContain('marketplace');
      expect(result.stdout).toContain('search');
      expect(result.stdout).toContain('list');
    });

    it('should show help with help subcommand', async () => {
      const result = await tpkg(['help'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tpkg - TronOS Package Manager');
    });

    it('should show help with --help flag', async () => {
      const result = await tpkg(['--help'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tpkg - TronOS Package Manager');
    });

    it('should show help with -h flag', async () => {
      const result = await tpkg(['-h'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tpkg - TronOS Package Manager');
    });
  });

  describe('list subcommand', () => {
    it('should show no packages when nothing installed', async () => {
      const result = await tpkg(['list'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No packages installed');
    });

    it('should work with ls alias', async () => {
      const result = await tpkg(['ls'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No packages installed');
    });
  });

  describe('install subcommand', () => {
    it('should error when no package name provided', async () => {
      const result = await tpkg(['install'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg install');
    });

    it('should error when package not found', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

      const result = await tpkg(['install', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("package 'nonexistent' not found");
    });

    it('should install a package from repository', async () => {
      const manifest = {
        name: 'test-package',
        version: '1.0.0',
        description: 'A test package',
        files: ['test.trx']
      };

      const mockResponses: Record<string, Response> = {
        'packages.json': new Response(JSON.stringify([
          { name: 'test-package', version: '1.0.0', description: 'A test package' }
        ]), { status: 200 }),
        'packages/test-package/package.tronos.json': new Response(JSON.stringify(manifest), { status: 200 }),
        'packages/test-package/test.trx': new Response('#!/tronos\n// @name: test\nasync function(t) { t.writeln("Hello"); }', { status: 200 })
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        for (const [path, response] of Object.entries(mockResponses)) {
          if (url.includes(path)) {
            return Promise.resolve(response.clone());
          }
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });

      const result = await tpkg(['install', 'test-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Installing test-package');
      expect(result.stdout).toContain('Successfully installed');

      // Verify file was installed
      expect(vfs.exists('/bin/test.trx')).toBe(true);

      // Verify package was recorded as installed
      expect(vfs.exists('/etc/tpkg/installed.json')).toBe(true);
    });

    it('should error when package is already installed', async () => {
      // Pre-install the package
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      const result = await tpkg(['install', 'test-package'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'test-package' is already installed");
    });

    it('should work with i alias', async () => {
      const result = await tpkg(['i'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg install');
    });

    it('should install bundled package when repository unavailable', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

      const result = await tpkg(['install', 'weather'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Installing weather');
      expect(result.stdout).toContain('Successfully installed');

      // Verify file was installed with bundled content
      expect(vfs.exists('/bin/weather.trx')).toBe(true);
      const content = vfs.read('/bin/weather.trx');
      expect(content).toContain('#!/tronos');
      expect(content).toContain('@name: weather');
    });

    it('should install package with config from bundled manifest', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

      const result = await tpkg(['install', 'translator'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('requires configuration');
      expect(result.stdout).toContain('apiKey');

      // Verify config directory was created
      expect(vfs.exists('/etc/tpkg/translator/config.json')).toBe(true);
    });
  });

  describe('uninstall subcommand', () => {
    it('should error when no package name provided', async () => {
      const result = await tpkg(['uninstall'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg uninstall');
    });

    it('should error when package not installed', async () => {
      const result = await tpkg(['uninstall', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'nonexistent' is not installed");
    });

    it('should uninstall an installed package', async () => {
      // Pre-install the package
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/bin/test.trx', 'test content');
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      const result = await tpkg(['uninstall', 'test-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Removing test-package');
      expect(result.stdout).toContain('Successfully removed');

      // Verify file was removed
      expect(vfs.exists('/bin/test.trx')).toBe(false);
    });

    it('should work with rm alias', async () => {
      const result = await tpkg(['rm', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'nonexistent' is not installed");
    });

    it('should work with remove alias', async () => {
      const result = await tpkg(['remove', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'nonexistent' is not installed");
    });
  });

  describe('update subcommand', () => {
    it('should update the package index', async () => {
      const packageList = [
        { name: 'package1', version: '1.0.0', description: 'Package 1' },
        { name: 'package2', version: '2.0.0', description: 'Package 2' }
      ];

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('packages.json')) {
          return Promise.resolve(new Response(JSON.stringify(packageList), { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });

      const result = await tpkg(['update'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Updating package index');
      expect(result.stdout).toContain('Found 2 package(s)');

      // Verify index was saved
      expect(vfs.exists('/var/cache/tpkg/index.json')).toBe(true);
    });

    it('should handle repository unavailability with bundled fallback', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));

      const result = await tpkg(['update'], context);
      expect(result.exitCode).toBe(0);
      // Default repository falls back to bundled index
      expect(result.stdout).toContain('Found 6 package(s)');
    });

    it('should handle unavailability for non-default repository', async () => {
      // First add a custom repo
      await tpkg(['repo', 'add', 'https://custom.example.com/repo'], context);

      // Mock fetch to return error for custom repo only
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('custom.example.com')) {
          return Promise.resolve(new Response('', { status: 500 }));
        }
        // Default repo would return bundled, but we're testing custom
        return Promise.resolve(new Response('', { status: 500 }));
      });

      const result = await tpkg(['update'], context);
      expect(result.exitCode).toBe(0);
      // One repo returns packages (bundled), one fails
      expect(result.stdout).toContain('No packages found or repository unavailable');
    });
  });

  describe('search subcommand', () => {
    it('should error when no search term provided', async () => {
      const result = await tpkg(['search'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg search');
    });

    it('should search marketplace packages by name', async () => {
      const result = await tpkg(['search', 'weather'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('weather');
      expect(result.stdout).toContain('Weather forecast');
    });

    it('should search by description', async () => {
      const result = await tpkg(['search', 'dungeon'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('roguelike');
    });

    it('should search by collection', async () => {
      const result = await tpkg(['search', 'games'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('2048');
    });

    it('should show no results message', async () => {
      const result = await tpkg(['search', 'xyznonexistent'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No packages found matching 'xyznonexistent'");
    });

    it('should work with s alias', async () => {
      const result = await tpkg(['s'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg search');
    });
  });

  describe('info subcommand', () => {
    it('should error when no package name provided', async () => {
      const result = await tpkg(['info'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg info');
    });

    it('should show package info from manifest', async () => {
      const manifest = {
        name: 'test-package',
        version: '1.0.0',
        description: 'A test package',
        author: 'Test Author',
        license: 'MIT',
        files: ['test.trx'],
        config: [
          { key: 'apiKey', type: 'string', description: 'API Key', required: true, secret: true }
        ]
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('package.tronos.json')) {
          return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });

      const result = await tpkg(['info', 'test-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Package: test-package');
      expect(result.stdout).toContain('Version: 1.0.0');
      expect(result.stdout).toContain('Author: Test Author');
      expect(result.stdout).toContain('Configuration options:');
      expect(result.stdout).toContain('apiKey');
    });

    it('should show installed status', async () => {
      // Pre-install the package
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      const manifest = {
        name: 'test-package',
        version: '1.0.0',
        description: 'A test package',
        files: ['test.trx']
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('package.tronos.json')) {
          return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });

      const result = await tpkg(['info', 'test-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Status: Installed');
    });

    it('should error when package not found', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

      const result = await tpkg(['info', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'nonexistent' not found");
    });

    it('should work with show alias', async () => {
      const result = await tpkg(['show'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg info');
    });
  });

  describe('upgrade subcommand', () => {
    it('should error when no package name provided', async () => {
      const result = await tpkg(['upgrade'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg upgrade');
    });

    it('should error when package not installed', async () => {
      const result = await tpkg(['upgrade', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'nonexistent' is not installed");
    });

    it('should work with up alias', async () => {
      const result = await tpkg(['up', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'nonexistent' is not installed");
    });

    it('should report when package is already at latest version', async () => {
      // Pre-install at current version
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/bin/weather.trx', 'test content');
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'weather', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/weather.trx'] }
      ]));

      // Bundled fallback provides 1.0.0
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

      const result = await tpkg(['upgrade', 'weather'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('already at version 1.0.0');
    });

    it('should upgrade when newer version is available', async () => {
      // Pre-install at older version
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/bin/weather.trx', 'old content');
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'weather', version: '0.9.0', installedAt: '2024-01-01', files: ['/bin/weather.trx'] }
      ]));

      // Bundled fallback provides 1.0.0
      global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

      const result = await tpkg(['upgrade', 'weather'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Upgrading weather from 0.9.0 to 1.0.0');
    });
  });

  describe('available subcommand', () => {
    it('should list marketplace packages', async () => {
      const result = await tpkg(['available'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('TronOS Marketplace');
      expect(result.stdout).toContain('weather');
      expect(result.stdout).toContain('Games');
    });

    it('should work with avail alias', async () => {
      const result = await tpkg(['avail'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('TronOS Marketplace');
    });

    it('should show installed status for packages', async () => {
      // Pre-install weather
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'weather', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/weather.trx'] }
      ]));

      const result = await tpkg(['available'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[installed]');
    });
  });

  describe('repo subcommand', () => {
    it('should list default repository', async () => {
      const result = await tpkg(['repo', 'list'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Configured repositories');
      expect(result.stdout).toContain('(default)');
    });

    it('should list repositories without subcommand', async () => {
      const result = await tpkg(['repo'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Configured repositories');
    });

    it('should add a repository', async () => {
      const result = await tpkg(['repo', 'add', 'https://example.com/repo'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Added repository');

      // Verify it was saved
      const listResult = await tpkg(['repo', 'list'], context);
      expect(listResult.stdout).toContain('https://example.com/repo');
    });

    it('should error when adding duplicate repository', async () => {
      await tpkg(['repo', 'add', 'https://example.com/repo'], context);
      const result = await tpkg(['repo', 'add', 'https://example.com/repo'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already configured');
    });

    it('should error when add has no URL', async () => {
      const result = await tpkg(['repo', 'add'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg repo add');
    });

    it('should remove a repository', async () => {
      await tpkg(['repo', 'add', 'https://example.com/repo'], context);
      const result = await tpkg(['repo', 'remove', 'https://example.com/repo'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Removed repository');
    });

    it('should error when removing non-existent repository', async () => {
      const result = await tpkg(['repo', 'remove', 'https://nonexistent.com'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not configured');
    });

    it('should error when remove has no URL', async () => {
      const result = await tpkg(['repo', 'remove'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg repo remove');
    });
  });

  describe('config subcommand', () => {
    it('should error when no package name provided', async () => {
      const result = await tpkg(['config'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg config');
    });

    it('should error when package not installed', async () => {
      const result = await tpkg(['config', 'nonexistent'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'nonexistent' is not installed");
    });

    it('should show package configuration', async () => {
      // Pre-install the package
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      const manifest = {
        name: 'test-package',
        version: '1.0.0',
        description: 'A test package',
        files: ['test.trx'],
        config: [
          { key: 'apiKey', type: 'string', description: 'API Key', required: true, secret: true }
        ]
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('package.tronos.json')) {
          return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });

      const result = await tpkg(['config', 'test-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Configuration for test-package');
      expect(result.stdout).toContain('apiKey');
    });

    it('should set a config value', async () => {
      // Pre-install the package
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      const result = await tpkg(['config', 'set', 'test-package', 'apiKey', 'my-secret-key'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set test-package.apiKey');

      // Verify it was saved
      const configContent = vfs.read('/etc/tpkg/test-package/config.json');
      expect(configContent).toContain('my-secret-key');
    });

    it('should error when config set has missing arguments', async () => {
      const result = await tpkg(['config', 'set', 'test-package'], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: tpkg config set');
    });

    it('should parse numeric config values', async () => {
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      await tpkg(['config', 'set', 'test-package', 'port', '8080'], context);

      const configContent = vfs.read('/etc/tpkg/test-package/config.json');
      if (typeof configContent === 'string') {
        const config = JSON.parse(configContent);
        expect(config.port).toBe(8080);
      }
    });

    it('should parse boolean config values', async () => {
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      await tpkg(['config', 'set', 'test-package', 'enabled', 'true'], context);

      const configContent = vfs.read('/etc/tpkg/test-package/config.json');
      if (typeof configContent === 'string') {
        const config = JSON.parse(configContent);
        expect(config.enabled).toBe(true);
      }
    });
  });

  describe('install with config', () => {
    it('should create config directory for packages with config options', async () => {
      const manifest = {
        name: 'test-package',
        version: '1.0.0',
        description: 'A test package',
        files: ['test.trx'],
        config: [
          { key: 'apiKey', type: 'string', description: 'API Key', required: true, secret: true },
          { key: 'timeout', type: 'number', description: 'Timeout', default: 30 }
        ]
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('package.tronos.json')) {
          return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }));
        }
        if (url.includes('test.trx')) {
          return Promise.resolve(new Response('test content', { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });

      const result = await tpkg(['install', 'test-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Configuration directory');
      expect(result.stdout).toContain('requires configuration');
      expect(result.stdout).toContain('apiKey');

      // Verify config directory was created with defaults
      expect(vfs.exists('/etc/tpkg/test-package/config.json')).toBe(true);
      const configContent = vfs.read('/etc/tpkg/test-package/config.json');
      if (typeof configContent === 'string') {
        const config = JSON.parse(configContent);
        expect(config.timeout).toBe(30);
      }
    });
  });

  describe('install with dependencies', () => {
    it('should install package dependencies first', async () => {
      const parentManifest = {
        name: 'parent-package',
        version: '1.0.0',
        description: 'Parent package',
        files: ['parent.trx'],
        dependencies: ['dep-package']
      };

      const depManifest = {
        name: 'dep-package',
        version: '1.0.0',
        description: 'Dependency package',
        files: ['dep.trx']
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('parent-package/package.tronos.json')) {
          return Promise.resolve(new Response(JSON.stringify(parentManifest), { status: 200 }));
        }
        if (url.includes('dep-package/package.tronos.json')) {
          return Promise.resolve(new Response(JSON.stringify(depManifest), { status: 200 }));
        }
        if (url.includes('parent.trx')) {
          return Promise.resolve(new Response('parent content', { status: 200 }));
        }
        if (url.includes('dep.trx')) {
          return Promise.resolve(new Response('dep content', { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });

      const result = await tpkg(['install', 'parent-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Installing dependency: dep-package');

      // Verify both packages were installed
      expect(vfs.exists('/bin/parent.trx')).toBe(true);
      expect(vfs.exists('/bin/dep.trx')).toBe(true);
    });
  });

  describe('uninstall with config', () => {
    it('should remove package config directory when uninstalling', async () => {
      // Pre-install with config
      vfs.mkdir('/etc/tpkg/test-package', true);
      vfs.write('/etc/tpkg/test-package/config.json', JSON.stringify({ apiKey: 'secret' }));
      vfs.write('/bin/test.trx', 'test content');
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/test.trx'] }
      ]));

      const result = await tpkg(['uninstall', 'test-package'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Removed config');

      // Verify config directory was removed
      expect(vfs.exists('/etc/tpkg/test-package')).toBe(false);
    });
  });

  describe('search with installed indicator', () => {
    it('should show [installed] for installed packages', async () => {
      // Pre-install the package
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'weather', version: '1.0.0', installedAt: '2024-01-01', files: ['/bin/weather.trx'] }
      ]));

      const result = await tpkg(['search', 'weather'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[installed]');
    });
  });

  describe('secret config encryption', () => {
    it('should encrypt secret config values when setting', async () => {
      // Pre-install package with secret config
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        {
          name: 'test-package',
          version: '1.0.0',
          installedAt: '2024-01-01',
          files: ['/bin/test.trx'],
          config: [
            { key: 'apiKey', type: 'string', description: 'API Key', required: true, secret: true }
          ]
        }
      ]));

      const result = await tpkg(['config', 'set', 'test-package', 'apiKey', 'my-secret-api-key'], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('********'); // Should mask in output

      // Verify the stored value is encrypted (not plaintext)
      const configContent = vfs.read('/etc/tpkg/test-package/config.json');
      if (typeof configContent === 'string') {
        const config = JSON.parse(configContent);
        expect(config.apiKey).not.toBe('my-secret-api-key');
        expect(isEncryptedSecret(config.apiKey)).toBe(true);
      }
    });

    it('should not encrypt non-secret config values', async () => {
      // Pre-install package with non-secret config
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        {
          name: 'test-package',
          version: '1.0.0',
          installedAt: '2024-01-01',
          files: ['/bin/test.trx'],
          config: [
            { key: 'timeout', type: 'number', description: 'Timeout', required: false }
          ]
        }
      ]));

      const result = await tpkg(['config', 'set', 'test-package', 'timeout', '60'], context);
      expect(result.exitCode).toBe(0);

      // Verify the stored value is not encrypted
      const configContent = vfs.read('/etc/tpkg/test-package/config.json');
      if (typeof configContent === 'string') {
        const config = JSON.parse(configContent);
        expect(config.timeout).toBe(60);
      }
    });

    it('should decrypt secret values when reading via getPackageConfigValue', async () => {
      const secretValue = 'my-super-secret-key';
      const encrypted = encryptSecret(secretValue, 'test-package');

      // Pre-install package with encrypted config
      vfs.mkdir('/etc/tpkg/test-package', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        {
          name: 'test-package',
          version: '1.0.0',
          installedAt: '2024-01-01',
          files: ['/bin/test.trx'],
          config: [
            { key: 'apiKey', type: 'string', description: 'API Key', secret: true }
          ]
        }
      ]));
      vfs.write('/etc/tpkg/test-package/config.json', JSON.stringify({ apiKey: encrypted }));

      const value = getPackageConfigValue('test-package', 'apiKey', context);
      expect(value).toBe(secretValue);
    });

    it('should return non-secret values as-is via getPackageConfigValue', async () => {
      vfs.mkdir('/etc/tpkg/test-package', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        {
          name: 'test-package',
          version: '1.0.0',
          installedAt: '2024-01-01',
          files: ['/bin/test.trx']
        }
      ]));
      vfs.write('/etc/tpkg/test-package/config.json', JSON.stringify({
        timeout: 30,
        enabled: true
      }));

      expect(getPackageConfigValue('test-package', 'timeout', context)).toBe(30);
      expect(getPackageConfigValue('test-package', 'enabled', context)).toBe(true);
    });

    it('should return undefined for non-existent config keys', async () => {
      vfs.mkdir('/etc/tpkg/test-package', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        { name: 'test-package', version: '1.0.0', installedAt: '2024-01-01', files: [] }
      ]));
      vfs.write('/etc/tpkg/test-package/config.json', JSON.stringify({}));

      const value = getPackageConfigValue('test-package', 'nonexistent', context);
      expect(value).toBeUndefined();
    });

    it('should encrypt via setPackageConfigValue for secret fields', async () => {
      vfs.mkdir('/etc/tpkg', true);
      vfs.write('/etc/tpkg/installed.json', JSON.stringify([
        {
          name: 'test-package',
          version: '1.0.0',
          installedAt: '2024-01-01',
          files: [],
          config: [
            { key: 'apiKey', type: 'string', description: 'API Key', secret: true }
          ]
        }
      ]));

      const success = setPackageConfigValue('test-package', 'apiKey', 'secret-value', context);
      expect(success).toBe(true);

      // Verify it's encrypted
      const configContent = vfs.read('/etc/tpkg/test-package/config.json');
      if (typeof configContent === 'string') {
        const config = JSON.parse(configContent);
        expect(config.apiKey).not.toBe('secret-value');
        expect(isEncryptedSecret(config.apiKey)).toBe(true);

        // And can be decrypted
        const decrypted = decryptSecret(config.apiKey, 'test-package');
        expect(decrypted).toBe('secret-value');
      }
    });
  });
});

describe('semver module', () => {
  describe('parseVersion', () => {
    it('should parse valid semver versions', () => {
      expect(parseVersion('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 });
      expect(parseVersion('2.3.4')).toEqual({ major: 2, minor: 3, patch: 4 });
      expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
    });

    it('should return null for invalid versions', () => {
      expect(parseVersion('')).toBeNull();
      expect(parseVersion('1.0')).toBeNull();
      expect(parseVersion('abc')).toBeNull();
      expect(parseVersion('1.2.x')).toBeNull();
    });

    it('should handle versions with extra content', () => {
      expect(parseVersion('1.0.0-beta')).toEqual({ major: 1, minor: 0, patch: 0 });
      expect(parseVersion('1.0.0+build123')).toEqual({ major: 1, minor: 0, patch: 0 });
    });
  });

  describe('compareVersions', () => {
    it('should compare equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
    });

    it('should compare major versions', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    });

    it('should compare minor versions', () => {
      expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
      expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    });

    it('should compare patch versions', () => {
      expect(compareVersions('1.0.1', '1.0.2')).toBe(-1);
      expect(compareVersions('1.0.2', '1.0.1')).toBe(1);
    });

    it('should handle invalid versions', () => {
      expect(compareVersions('invalid', 'also-invalid')).toBe(0);
      expect(compareVersions('1.0.0', 'invalid')).toBe(1);
      expect(compareVersions('invalid', '1.0.0')).toBe(-1);
    });
  });

  describe('satisfiesVersion', () => {
    it('should match exact versions', () => {
      expect(satisfiesVersion('1.0.0', '1.0.0')).toBe(true);
      expect(satisfiesVersion('1.0.0', '1.0.1')).toBe(false);
    });

    it('should handle wildcard constraint', () => {
      expect(satisfiesVersion('1.0.0', '*')).toBe(true);
      expect(satisfiesVersion('2.0.0', '*')).toBe(true);
    });

    it('should handle caret ranges', () => {
      expect(satisfiesVersion('1.0.0', '^1.0.0')).toBe(true);
      expect(satisfiesVersion('1.1.0', '^1.0.0')).toBe(true);
      expect(satisfiesVersion('1.9.9', '^1.0.0')).toBe(true);
      expect(satisfiesVersion('2.0.0', '^1.0.0')).toBe(false);
      expect(satisfiesVersion('0.9.0', '^1.0.0')).toBe(false);
    });

    it('should handle tilde ranges', () => {
      expect(satisfiesVersion('1.0.0', '~1.0.0')).toBe(true);
      expect(satisfiesVersion('1.0.5', '~1.0.0')).toBe(true);
      expect(satisfiesVersion('1.1.0', '~1.0.0')).toBe(false);
    });

    it('should handle greater than or equal', () => {
      expect(satisfiesVersion('1.0.0', '>=1.0.0')).toBe(true);
      expect(satisfiesVersion('1.1.0', '>=1.0.0')).toBe(true);
      expect(satisfiesVersion('0.9.0', '>=1.0.0')).toBe(false);
    });

    it('should handle greater than', () => {
      expect(satisfiesVersion('1.0.0', '>1.0.0')).toBe(false);
      expect(satisfiesVersion('1.0.1', '>1.0.0')).toBe(true);
    });

    it('should handle less than or equal', () => {
      expect(satisfiesVersion('1.0.0', '<=1.0.0')).toBe(true);
      expect(satisfiesVersion('0.9.0', '<=1.0.0')).toBe(true);
      expect(satisfiesVersion('1.0.1', '<=1.0.0')).toBe(false);
    });

    it('should handle less than', () => {
      expect(satisfiesVersion('1.0.0', '<1.0.0')).toBe(false);
      expect(satisfiesVersion('0.9.9', '<1.0.0')).toBe(true);
    });
  });
});

describe('bundled packages', () => {
  it('should have bundled package index', () => {
    expect(BUNDLED_PACKAGE_INDEX).toBeDefined();
    expect(BUNDLED_PACKAGE_INDEX.length).toBeGreaterThan(0);
  });

  it('should have weather package in bundled index', () => {
    const weather = BUNDLED_PACKAGE_INDEX.find(p => p.name === 'weather');
    expect(weather).toBeDefined();
    expect(weather?.version).toBe('1.0.0');
  });

  it('should have bundled manifests for all indexed packages', () => {
    for (const pkg of BUNDLED_PACKAGE_INDEX) {
      expect(BUNDLED_PACKAGE_MANIFESTS[pkg.name]).toBeDefined();
      expect(BUNDLED_PACKAGE_MANIFESTS[pkg.name].name).toBe(pkg.name);
    }
  });

  it('should have bundled files for all indexed packages', () => {
    for (const pkg of BUNDLED_PACKAGE_INDEX) {
      const manifest = BUNDLED_PACKAGE_MANIFESTS[pkg.name];
      expect(BUNDLED_PACKAGE_FILES[pkg.name]).toBeDefined();
      for (const file of manifest.files) {
        expect(BUNDLED_PACKAGE_FILES[pkg.name][file]).toBeDefined();
      }
    }
  });

  it('should have valid executable format in bundled files', () => {
    for (const pkgName of Object.keys(BUNDLED_PACKAGE_FILES)) {
      for (const [fileName, content] of Object.entries(BUNDLED_PACKAGE_FILES[pkgName])) {
        expect(content).toContain('#!/tronos');
        expect(content).toContain('@name:');
        expect(content).toContain('async function');
      }
    }
  });
});

describe('crypto module', () => {
  it('should encrypt and decrypt strings correctly', () => {
    const plaintext = 'my-secret-api-key';
    const salt = 'test-package';

    const encrypted = encryptSecret(plaintext, salt);
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decryptSecret(encrypted, salt);
    expect(decrypted).toBe(plaintext);
  });

  it('should return null for wrong salt', () => {
    const encrypted = encryptSecret('secret', 'correct-salt');
    const decrypted = decryptSecret(encrypted, 'wrong-salt');
    expect(decrypted).toBeNull();
  });

  it('should identify encrypted values', () => {
    const encrypted = encryptSecret('secret', 'package');
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(isEncryptedSecret('plain-text')).toBe(false);
    expect(isEncryptedSecret('not:base64:valid!!!')).toBe(false);
  });

  it('should handle special characters in plaintext', () => {
    const plaintext = 'key!@#$%^&*()_+-=[]{}|;:,.<>?';
    const salt = 'test';

    const encrypted = encryptSecret(plaintext, salt);
    const decrypted = decryptSecret(encrypted, salt);
    expect(decrypted).toBe(plaintext);
  });

  it('should handle unicode characters', () => {
    const plaintext = 'ключ-密钥-مفتاح';
    const salt = 'test';

    const encrypted = encryptSecret(plaintext, salt);
    const decrypted = decryptSecret(encrypted, salt);
    expect(decrypted).toBe(plaintext);
  });
});

describe('validateConfigInput', () => {
  it('should validate string input', () => {
    const param = { key: 'name', type: 'string' as const, description: 'Name' };
    const [valid, value, error] = validateConfigInput('hello', param);
    expect(valid).toBe(true);
    expect(value).toBe('hello');
    expect(error).toBeUndefined();
  });

  it('should validate number input', () => {
    const param = { key: 'count', type: 'number' as const, description: 'Count' };
    const [valid, value, error] = validateConfigInput('42', param);
    expect(valid).toBe(true);
    expect(value).toBe(42);
    expect(error).toBeUndefined();
  });

  it('should reject invalid number input', () => {
    const param = { key: 'count', type: 'number' as const, description: 'Count' };
    const [valid, value, error] = validateConfigInput('not-a-number', param);
    expect(valid).toBe(false);
    expect(value).toBeUndefined();
    expect(error).toContain('number');
  });

  it('should validate boolean input (true variants)', () => {
    const param = { key: 'enabled', type: 'boolean' as const, description: 'Enabled' };

    for (const input of ['true', 'yes', 'y', '1', 'TRUE', 'Yes', 'Y']) {
      const [valid, value] = validateConfigInput(input, param);
      expect(valid).toBe(true);
      expect(value).toBe(true);
    }
  });

  it('should validate boolean input (false variants)', () => {
    const param = { key: 'enabled', type: 'boolean' as const, description: 'Enabled' };

    for (const input of ['false', 'no', 'n', '0', 'FALSE', 'No', 'N']) {
      const [valid, value] = validateConfigInput(input, param);
      expect(valid).toBe(true);
      expect(value).toBe(false);
    }
  });

  it('should reject invalid boolean input', () => {
    const param = { key: 'enabled', type: 'boolean' as const, description: 'Enabled' };
    const [valid, value, error] = validateConfigInput('maybe', param);
    expect(valid).toBe(false);
    expect(value).toBeUndefined();
    expect(error).toContain('true/false');
  });

  it('should validate choice input', () => {
    const param = {
      key: 'units',
      type: 'choice' as const,
      description: 'Units',
      choices: ['metric', 'imperial']
    };

    const [valid, value] = validateConfigInput('metric', param);
    expect(valid).toBe(true);
    expect(value).toBe('metric');
  });

  it('should validate choice input case-insensitively', () => {
    const param = {
      key: 'units',
      type: 'choice' as const,
      description: 'Units',
      choices: ['metric', 'imperial']
    };

    const [valid, value] = validateConfigInput('METRIC', param);
    expect(valid).toBe(true);
    expect(value).toBe('metric');
  });

  it('should reject invalid choice input', () => {
    const param = {
      key: 'units',
      type: 'choice' as const,
      description: 'Units',
      choices: ['metric', 'imperial']
    };

    const [valid, value, error] = validateConfigInput('kelvin', param);
    expect(valid).toBe(false);
    expect(value).toBeUndefined();
    expect(error).toContain('metric');
    expect(error).toContain('imperial');
  });

  it('should use default value for empty input', () => {
    const param = {
      key: 'count',
      type: 'number' as const,
      description: 'Count',
      default: 10
    };

    const [valid, value] = validateConfigInput('', param);
    expect(valid).toBe(true);
    expect(value).toBe(10);
  });

  it('should fail for required param with no default and empty input', () => {
    const param = {
      key: 'apiKey',
      type: 'string' as const,
      description: 'API Key',
      required: true
    };

    const [valid, value, error] = validateConfigInput('', param);
    expect(valid).toBe(false);
    expect(value).toBeUndefined();
    expect(error).toContain('required');
  });

  it('should succeed for optional param with empty input', () => {
    const param = {
      key: 'name',
      type: 'string' as const,
      description: 'Name',
      required: false
    };

    const [valid, value] = validateConfigInput('', param);
    expect(valid).toBe(true);
    expect(value).toBeUndefined();
  });

  it('should trim whitespace from input', () => {
    const param = { key: 'name', type: 'string' as const, description: 'Name' };
    const [valid, value] = validateConfigInput('  hello  ', param);
    expect(valid).toBe(true);
    expect(value).toBe('hello');
  });
});

describe('interactive config during install', () => {
  let context: ExecutionContext;
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
    context = {
      stdin: '',
      env: { HOME: '/home/tronos', PWD: '/home/tronos' },
      vfs,
    };
  });

  it('should store default config values during non-interactive install', async () => {
    // Install weather package (has config with defaults)
    const result = await tpkg(['install', 'weather'], context);
    expect(result.exitCode).toBe(0);

    // Check config file was created with defaults
    const configPath = '/etc/tpkg/weather/config.json';
    expect(vfs.exists(configPath)).toBe(true);

    const configContent = vfs.read(configPath);
    expect(typeof configContent).toBe('string');
    const config = JSON.parse(configContent as string);
    expect(config.units).toBe('metric');
  });

  it('should warn about missing required config in non-interactive mode', async () => {
    // Install translator package (has required apiKey with no default)
    const result = await tpkg(['install', 'translator'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('requires configuration');
    expect(result.stdout).toContain('apiKey');
    expect(result.stdout).toContain('tpkg config translator');
  });

  it('should create config directory during install', async () => {
    const result = await tpkg(['install', 'pomodoro'], context);
    expect(result.exitCode).toBe(0);

    const configDir = '/etc/tpkg/pomodoro';
    expect(vfs.exists(configDir)).toBe(true);
    expect(vfs.exists(`${configDir}/config.json`)).toBe(true);
  });
});

describe('tpkg config command', () => {
  let context: ExecutionContext;
  let vfs: InMemoryVFS;

  beforeEach(async () => {
    vfs = new InMemoryVFS();
    await vfs.init();
    context = {
      stdin: '',
      env: { HOME: '/home/tronos', PWD: '/home/tronos' },
      vfs,
    };
  });

  it('should show current config values', async () => {
    // First install a package
    await tpkg(['install', 'weather'], context);

    // Show config
    const result = await tpkg(['config', 'weather'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Configuration for weather');
    expect(result.stdout).toContain('location');
    expect(result.stdout).toContain('units');
    expect(result.stdout).toContain('metric');
  });

  it('should show not set for values without defaults', async () => {
    // Install translator (has required apiKey with no default)
    await tpkg(['install', 'translator'], context);

    const result = await tpkg(['config', 'translator'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('apiKey');
    expect(result.stdout).toContain('(not set)');
    expect(result.stdout).toContain('required');
  });

  it('should mask secret values in config display', async () => {
    // Install translator and set secret
    await tpkg(['install', 'translator'], context);
    await tpkg(['config', 'set', 'translator', 'apiKey', 'my-secret-key'], context);

    const result = await tpkg(['config', 'translator'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('apiKey');
    expect(result.stdout).toContain('********');
    expect(result.stdout).not.toContain('my-secret-key');
  });

  it('should error for non-installed package', async () => {
    const result = await tpkg(['config', 'nonexistent'], context);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not installed');
  });

  it('should show message for package with no config', async () => {
    // Install notes (has no config options)
    await tpkg(['install', 'notes'], context);

    const result = await tpkg(['config', 'notes'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No configuration options');
  });

  it('should show instruction for setting values', async () => {
    await tpkg(['install', 'weather'], context);

    const result = await tpkg(['config', 'weather'], context);
    expect(result.stdout).toContain('tpkg config set');
  });
});
