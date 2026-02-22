import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { reset, factoryReset, performFactoryReset } from '../src/engine/builtins/reset';
import { InMemoryVFS } from '../src/vfs/memory';
import type { ExecutionContext } from '../src/engine/types';

// Mock the persistence modules
vi.mock('../src/persistence/db', () => ({
  getDB: vi.fn(() => ({
    transaction: vi.fn(() => ({
      store: {
        clear: vi.fn(() => Promise.resolve()),
        getAllKeys: vi.fn(() => Promise.resolve([])),
        delete: vi.fn(() => Promise.resolve())
      },
      done: Promise.resolve()
    }))
  }))
}));

vi.mock('../src/persistence/config', () => ({
  clearAIConfig: vi.fn()
}));

vi.mock('../src/persistence/theme', () => ({
  clearTheme: vi.fn()
}));

vi.mock('../src/persistence/batch', () => ({
  removeBatchManager: vi.fn()
}));

// Save original window
const originalWindow = globalThis.window;

// ============================================================================
// reset builtin command tests
// ============================================================================
describe('reset builtin command', () => {
  let vfs: InMemoryVFS;
  let context: ExecutionContext;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test-namespace');
    await vfs.init();
    context = {
      stdin: '',
      env: {},
      vfs
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore original window
    (globalThis as any).window = originalWindow;
  });

  describe('argument parsing', () => {
    it('should prompt for confirmation without --force flag', async () => {
      const result = await reset([], context);

      expect(result.exitCode).toBe(0);
      expect(result.uiRequest).toBe('showFactoryResetDialog');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it('should accept --force flag to skip confirmation', async () => {
      // Mock window.location.reload
      const reloadMock = vi.fn();
      (globalThis as any).window = { location: { reload: reloadMock } };

      const result = await reset(['--force'], context);

      expect(result.exitCode).toBe(0);
      expect(result.uiRequest).toBeUndefined();
      expect(result.stdout).toContain('Factory reset complete');
    });

    it('should accept -f flag as shorthand for --force', async () => {
      const reloadMock = vi.fn();
      (globalThis as any).window = { location: { reload: reloadMock } };

      const result = await reset(['-f'], context);

      expect(result.exitCode).toBe(0);
      expect(result.uiRequest).toBeUndefined();
      expect(result.stdout).toContain('Factory reset complete');
    });

    it('should reject invalid options', async () => {
      const result = await reset(['--invalid'], context);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid option '--invalid'");
      expect(result.stderr).toContain('Usage:');
    });

    it('should reject unknown short options', async () => {
      const result = await reset(['-x'], context);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid option '-x'");
    });
  });

  describe('factoryReset alias', () => {
    it('should be an alias for reset command', async () => {
      const resetResult = await reset([], context);
      const factoryResetResult = await factoryReset([], context);

      expect(resetResult).toEqual(factoryResetResult);
    });

    it('should accept --force flag like reset', async () => {
      const reloadMock = vi.fn();
      (globalThis as any).window = { location: { reload: reloadMock } };

      const result = await factoryReset(['--force'], context);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Factory reset complete');
    });
  });
});

// ============================================================================
// performFactoryReset tests
// ============================================================================
describe('performFactoryReset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original window
    (globalThis as any).window = originalWindow;
  });

  it('should return success message', async () => {
    const reloadMock = vi.fn();
    (globalThis as any).window = { location: { reload: reloadMock } };

    const result = await performFactoryReset();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Factory reset complete');
    expect(result.stderr).toBe('');
  });

  it('should call database clear methods', async () => {
    const { getDB } = await import('../src/persistence/db');
    const reloadMock = vi.fn();
    (globalThis as any).window = { location: { reload: reloadMock } };

    await performFactoryReset();

    expect(getDB).toHaveBeenCalled();
  });

  it('should clear localStorage config', async () => {
    const { clearAIConfig } = await import('../src/persistence/config');
    const { clearTheme } = await import('../src/persistence/theme');
    const reloadMock = vi.fn();
    (globalThis as any).window = { location: { reload: reloadMock } };

    await performFactoryReset();

    expect(clearAIConfig).toHaveBeenCalled();
    expect(clearTheme).toHaveBeenCalled();
  });

  it('should remove batch manager for VFS namespace', async () => {
    const { removeBatchManager } = await import('../src/persistence/batch');
    const reloadMock = vi.fn();
    (globalThis as any).window = { location: { reload: reloadMock } };
    const vfs = new InMemoryVFS('test-ns');

    await performFactoryReset({ vfs });

    expect(removeBatchManager).toHaveBeenCalledWith('test-ns');
  });

  it('should handle missing window gracefully', async () => {
    // Set window to undefined
    (globalThis as any).window = undefined;

    const result = await performFactoryReset();

    // Should still succeed, just won't reload
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Factory reset complete');
  });

  it('should trigger page reload after delay', async () => {
    vi.useFakeTimers();
    const reloadMock = vi.fn();
    (globalThis as any).window = { location: { reload: reloadMock } };

    await performFactoryReset();

    // Reload should not have been called yet
    expect(reloadMock).not.toHaveBeenCalled();

    // Fast-forward time
    vi.advanceTimersByTime(500);

    // Now reload should be called
    expect(reloadMock).toHaveBeenCalled();

    vi.useRealTimers();
  });

  // Note: Database error handling is implemented in the code via try/catch
  // but is difficult to test with bun's mock system. The error handling
  // ensures graceful degradation when IndexedDB is unavailable.
});

// ============================================================================
// Integration tests
// ============================================================================
describe('reset command integration', () => {
  it('should be registered as builtin command', async () => {
    const { BUILTIN_COMMANDS } = await import('../src/engine/builtins');

    expect(BUILTIN_COMMANDS.reset).toBeDefined();
    expect(BUILTIN_COMMANDS['factory-reset']).toBeDefined();
  });

  it('reset and factory-reset should reference same handler', async () => {
    const { BUILTIN_COMMANDS } = await import('../src/engine/builtins');

    // They should both be the same function (reset === factoryReset)
    expect(BUILTIN_COMMANDS.reset).toBe(BUILTIN_COMMANDS['factory-reset']);
  });
});
