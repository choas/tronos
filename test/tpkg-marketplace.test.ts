import { describe, it, expect, beforeEach } from 'vitest';
import { tpkg } from '../src/engine/builtins/tpkg';
import type { ExecutionContext } from '../src/engine/types';
import { InMemoryVFS } from '../src/vfs/memory';

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

describe('tpkg marketplace subcommand', () => {
  // In CLI/test mode (non-browser), marketplace renders text listing
  it('should render text marketplace for "marketplace"', async () => {
    const result = await tpkg(['marketplace'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('TronOS Marketplace');
    expect(result.stdout).toContain('Games');
    expect(result.stdout).toContain('tpkg install');
  });

  it('should render text marketplace for "market" alias', async () => {
    const result = await tpkg(['market'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('TronOS Marketplace');
  });

  it('should render text marketplace for "store" alias', async () => {
    const result = await tpkg(['store'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('TronOS Marketplace');
  });

  it('should filter by collection name', async () => {
    const result = await tpkg(['marketplace', 'games'], context);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Games');
    expect(result.stdout).toContain('2048');
    // Should not contain other collections' headers
    expect(result.stdout).not.toContain('Editors');
  });

  it('should show marketplace in help text', async () => {
    const result = await tpkg(['help'], context);
    expect(result.stdout).toContain('marketplace');
    expect(result.stdout).toContain('market');
    expect(result.stdout).toContain('store');
  });
});
