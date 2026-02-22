import { getDB } from "./db";
import type { FSNode } from "../types";

/**
 * Pending operation types for the batch manager
 */
type PendingOperation =
  | { type: "save"; path: string; node: FSNode }
  | { type: "delete"; path: string };

/**
 * BatchManager handles debounced, batched IndexedDB writes for filesystem persistence.
 *
 * Instead of writing each change immediately, operations are collected into a pending
 * queue and flushed together in a single transaction after a short debounce period.
 * This significantly reduces IndexedDB write overhead for rapid sequential operations.
 */
export class BatchManager {
  private pending: Map<string, PendingOperation> = new Map();
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private namespace: string;
  private debounceMs: number;

  /**
   * Create a new BatchManager
   * @param namespace - The filesystem namespace (typically session ID)
   * @param debounceMs - Milliseconds to wait before flushing (default: 50ms)
   */
  constructor(namespace: string, debounceMs = 50) {
    this.namespace = namespace;
    this.debounceMs = debounceMs;
  }

  /**
   * Queue a save operation for a node
   * @param path - The absolute path of the file/directory
   * @param node - The FSNode to save
   */
  public save(path: string, node: FSNode): void {
    const key = `${this.namespace}:${path}`;
    // If there's already a pending operation for this path, replace it
    // (latest state wins for saves)
    this.pending.set(key, { type: "save", path, node: { ...node } });
    this.scheduleFlush();
  }

  /**
   * Queue a delete operation for a path
   * @param path - The absolute path to delete
   */
  public delete(path: string): void {
    const key = `${this.namespace}:${path}`;
    // Delete overrides any pending save for the same path
    this.pending.set(key, { type: "delete", path });
    this.scheduleFlush();
  }

  /**
   * Schedule a flush after the debounce period
   */
  private scheduleFlush(): void {
    // Clear any existing timeout
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    // Schedule a new flush
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      this.flush().catch(err => {
        console.error("BatchManager flush failed:", err);
      });
    }, this.debounceMs);
  }

  /**
   * Flush all pending operations to IndexedDB in a single transaction
   * Returns a promise that resolves when the flush is complete
   */
  public async flush(): Promise<void> {
    // If there's already a flush in progress, wait for it and then flush again
    // (in case more operations were queued during the flush)
    if (this.flushPromise) {
      await this.flushPromise;
      // If no new operations were queued, we're done
      if (this.pending.size === 0) return;
    }

    // Clear the timeout if there is one
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    // No operations to flush
    if (this.pending.size === 0) return;

    // Take a snapshot of pending operations and clear the queue
    const operations = new Map(this.pending);
    this.pending.clear();

    // Perform the batch write
    this.flushPromise = this.performBatchWrite(operations);

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  /**
   * Perform the actual batch write to IndexedDB
   */
  private async performBatchWrite(operations: Map<string, PendingOperation>): Promise<void> {
    // Skip if IndexedDB is not available
    if (typeof indexedDB === "undefined") return;

    try {
      const db = getDB();
      const tx = db.transaction("files", "readwrite");

      // Process all operations in a single transaction
      for (const [key, op] of operations.entries()) {
        if (op.type === "save") {
          await tx.store.put({
            path: key,
            node: op.node,
            parent: op.node.parent || "/",
          });
        } else if (op.type === "delete") {
          await tx.store.delete(key);
        }
      }

      await tx.done;
    } catch (err) {
      // Log but don't throw - persistence errors shouldn't crash the app
      console.error("BatchManager: Failed to write to IndexedDB:", err);
      // Re-queue failed operations for retry
      for (const [key, op] of operations.entries()) {
        if (!this.pending.has(key)) {
          this.pending.set(key, op);
        }
      }
      // Schedule a retry
      this.scheduleFlush();
    }
  }

  /**
   * Get the count of pending operations (useful for testing)
   */
  public getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * Check if there are pending operations
   */
  public hasPending(): boolean {
    return this.pending.size > 0 || this.flushPromise !== null;
  }

  /**
   * Wait for any pending operations to complete
   * Useful for ensuring data integrity before session export
   */
  public async waitForPending(): Promise<void> {
    // Flush any pending operations immediately
    await this.flush();
    // Wait for any in-progress flush to complete
    if (this.flushPromise) {
      await this.flushPromise;
    }
  }

  /**
   * Update the namespace (e.g., when switching sessions)
   * This will flush any pending operations first
   */
  public async setNamespace(namespace: string): Promise<void> {
    await this.waitForPending();
    this.namespace = namespace;
  }

  /**
   * Cancel any pending operations and clear the queue
   * Useful for cleanup when switching sessions
   */
  public cancel(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    this.pending.clear();
  }
}

// Global batch manager instances per namespace
const managers: Map<string, BatchManager> = new Map();

/**
 * Get or create a BatchManager for a given namespace
 */
export function getBatchManager(namespace: string, debounceMs = 50): BatchManager {
  let manager = managers.get(namespace);
  if (!manager) {
    manager = new BatchManager(namespace, debounceMs);
    managers.set(namespace, manager);
  }
  return manager;
}

/**
 * Remove a BatchManager instance (cleanup when session is deleted)
 */
export async function removeBatchManager(namespace: string): Promise<void> {
  const manager = managers.get(namespace);
  if (manager) {
    await manager.waitForPending();
    managers.delete(namespace);
  }
}

/**
 * Flush all batch managers (useful before app exit)
 */
export async function flushAllManagers(): Promise<void> {
  const flushPromises = Array.from(managers.values()).map(m => m.flush());
  await Promise.all(flushPromises);
}
