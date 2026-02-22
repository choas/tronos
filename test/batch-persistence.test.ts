import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BatchManager } from '../src/persistence/batch';
import type { FSNode, FileNode, DirectoryNode } from '../src/types';

// Mock IndexedDB and getDB
vi.mock('../src/persistence/db', () => {
  const mockStore = new Map<string, unknown>();
  const mockTransaction = {
    store: {
      put: vi.fn((value: unknown) => {
        const v = value as { path: string };
        mockStore.set(v.path, value);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string) => {
        mockStore.delete(key);
        return Promise.resolve();
      }),
    },
    done: Promise.resolve(),
  };

  return {
    getDB: () => ({
      transaction: () => mockTransaction,
    }),
    initDB: vi.fn(),
    _mockStore: mockStore,
    _mockTransaction: mockTransaction,
    _resetMockStore: () => mockStore.clear(),
  };
});

// Helper to create test nodes
function createFileNode(name: string, content: string, parent: string): FileNode {
  return {
    name,
    type: 'file',
    parent,
    content,
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function createDirNode(name: string, parent: string | null, children: string[]): DirectoryNode {
  return {
    name,
    type: 'directory',
    parent,
    children,
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

describe('BatchManager', () => {
  let manager: BatchManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new BatchManager('test-namespace', 50);
  });

  afterEach(() => {
    manager.cancel();
    vi.useRealTimers();
  });

  describe('save()', () => {
    it('should queue a save operation', () => {
      const node = createFileNode('test.txt', 'content', '/');
      manager.save('/test.txt', node);

      expect(manager.getPendingCount()).toBe(1);
    });

    it('should replace duplicate paths with latest state', () => {
      const node1 = createFileNode('test.txt', 'content1', '/');
      const node2 = createFileNode('test.txt', 'content2', '/');

      manager.save('/test.txt', node1);
      manager.save('/test.txt', node2);

      // Should only have one pending operation
      expect(manager.getPendingCount()).toBe(1);
    });

    it('should batch multiple different paths', () => {
      manager.save('/file1.txt', createFileNode('file1.txt', 'content1', '/'));
      manager.save('/file2.txt', createFileNode('file2.txt', 'content2', '/'));
      manager.save('/file3.txt', createFileNode('file3.txt', 'content3', '/'));

      expect(manager.getPendingCount()).toBe(3);
    });
  });

  describe('delete()', () => {
    it('should queue a delete operation', () => {
      manager.delete('/test.txt');

      expect(manager.getPendingCount()).toBe(1);
    });

    it('should override pending save for same path', () => {
      const node = createFileNode('test.txt', 'content', '/');
      manager.save('/test.txt', node);
      manager.delete('/test.txt');

      // Should still have one operation, but it's now a delete
      expect(manager.getPendingCount()).toBe(1);
    });
  });

  describe('debouncing', () => {
    it('should not flush immediately', () => {
      const node = createFileNode('test.txt', 'content', '/');
      manager.save('/test.txt', node);

      expect(manager.hasPending()).toBe(true);
    });

    it('should flush after debounce timeout', async () => {
      const node = createFileNode('test.txt', 'content', '/');
      manager.save('/test.txt', node);

      // Fast-forward past debounce timeout
      vi.advanceTimersByTime(60);
      // Allow microtasks to run
      await Promise.resolve();

      expect(manager.getPendingCount()).toBe(0);
    });

    it('should reset debounce timer on new operations', async () => {
      const node1 = createFileNode('test1.txt', 'content1', '/');
      const node2 = createFileNode('test2.txt', 'content2', '/');

      manager.save('/test1.txt', node1);

      // Advance part of the way
      vi.advanceTimersByTime(30);
      await Promise.resolve();

      // Add another operation - should reset timer
      manager.save('/test2.txt', node2);

      // Advance another 30ms - original would have fired, but timer was reset
      vi.advanceTimersByTime(30);
      await Promise.resolve();

      // Should still be pending
      expect(manager.getPendingCount()).toBe(2);

      // Advance past the reset timer
      vi.advanceTimersByTime(30);
      await Promise.resolve();

      // Now it should have flushed
      expect(manager.getPendingCount()).toBe(0);
    });
  });

  describe('flush()', () => {
    it('should immediately flush all pending operations', async () => {
      manager.save('/file1.txt', createFileNode('file1.txt', 'c1', '/'));
      manager.save('/file2.txt', createFileNode('file2.txt', 'c2', '/'));
      manager.delete('/file3.txt');

      expect(manager.getPendingCount()).toBe(3);

      await manager.flush();

      expect(manager.getPendingCount()).toBe(0);
    });

    it('should do nothing when no pending operations', async () => {
      await manager.flush(); // Should not throw
      expect(manager.getPendingCount()).toBe(0);
    });
  });

  describe('waitForPending()', () => {
    it('should wait for flush to complete', async () => {
      manager.save('/test.txt', createFileNode('test.txt', 'content', '/'));

      await manager.waitForPending();

      expect(manager.getPendingCount()).toBe(0);
      expect(manager.hasPending()).toBe(false);
    });
  });

  describe('cancel()', () => {
    it('should clear all pending operations', () => {
      manager.save('/file1.txt', createFileNode('file1.txt', 'c1', '/'));
      manager.save('/file2.txt', createFileNode('file2.txt', 'c2', '/'));

      manager.cancel();

      expect(manager.getPendingCount()).toBe(0);
    });

    it('should clear debounce timer', async () => {
      manager.save('/test.txt', createFileNode('test.txt', 'content', '/'));
      manager.cancel();

      // Advance past debounce timeout
      vi.advanceTimersByTime(100);
      await Promise.resolve();

      // Should still be 0 because we cancelled
      expect(manager.getPendingCount()).toBe(0);
    });
  });

  describe('setNamespace()', () => {
    it('should flush pending before changing namespace', async () => {
      manager.save('/test.txt', createFileNode('test.txt', 'content', '/'));

      await manager.setNamespace('new-namespace');

      expect(manager.getPendingCount()).toBe(0);
    });
  });
});

describe('BatchManager batching behavior', () => {
  let manager: BatchManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new BatchManager('test', 50);
  });

  afterEach(() => {
    manager.cancel();
    vi.useRealTimers();
  });

  it('should batch rapid successive writes to same file', async () => {
    // Simulate rapid writes (like multiple appends)
    for (let i = 0; i < 10; i++) {
      manager.save('/test.txt', createFileNode('test.txt', `content${i}`, '/'));
    }

    // Should have coalesced to 1 operation
    expect(manager.getPendingCount()).toBe(1);
  });

  it('should batch writes to parent directory after children', async () => {
    // Simulate creating multiple files in a directory
    // Each file write would also update the parent directory
    manager.save('/dir', createDirNode('dir', '/', ['file1.txt']));
    manager.save('/dir/file1.txt', createFileNode('file1.txt', 'c1', '/dir'));
    manager.save('/dir', createDirNode('dir', '/', ['file1.txt', 'file2.txt']));
    manager.save('/dir/file2.txt', createFileNode('file2.txt', 'c2', '/dir'));
    manager.save('/dir', createDirNode('dir', '/', ['file1.txt', 'file2.txt', 'file3.txt']));
    manager.save('/dir/file3.txt', createFileNode('file3.txt', 'c3', '/dir'));

    // Should have 4 operations: 3 files + 1 directory (coalesced)
    expect(manager.getPendingCount()).toBe(4);
  });

  it('should process delete after save for same path as delete', async () => {
    manager.save('/test.txt', createFileNode('test.txt', 'content', '/'));
    manager.delete('/test.txt');

    // Should be delete operation
    expect(manager.getPendingCount()).toBe(1);
  });

  it('should efficiently handle bulk file creation', async () => {
    // Simulate creating 100 files
    for (let i = 0; i < 100; i++) {
      manager.save(`/file${i}.txt`, createFileNode(`file${i}.txt`, `content${i}`, '/'));
    }

    // All 100 files should be queued
    expect(manager.getPendingCount()).toBe(100);

    // Flush and verify it completes
    await manager.flush();

    expect(manager.getPendingCount()).toBe(0);
  });
});

describe('BatchManager integration scenarios', () => {
  let manager: BatchManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new BatchManager('integration-test', 50);
  });

  afterEach(() => {
    manager.cancel();
    vi.useRealTimers();
  });

  it('should handle mixed save and delete operations', async () => {
    manager.save('/keep1.txt', createFileNode('keep1.txt', 'keep', '/'));
    manager.delete('/remove1.txt');
    manager.save('/keep2.txt', createFileNode('keep2.txt', 'keep', '/'));
    manager.delete('/remove2.txt');

    expect(manager.getPendingCount()).toBe(4);

    await manager.flush();

    expect(manager.getPendingCount()).toBe(0);
  });

  it('should handle operations during flush', async () => {
    manager.save('/file1.txt', createFileNode('file1.txt', 'c1', '/'));

    // Start flush but don't await yet
    const flushPromise = manager.flush();

    // Add more operations while flushing
    manager.save('/file2.txt', createFileNode('file2.txt', 'c2', '/'));

    await flushPromise;

    // The new operation should be pending
    expect(manager.getPendingCount()).toBe(1);

    await manager.flush();
    expect(manager.getPendingCount()).toBe(0);
  });
});
