/**
 * @fileoverview Storage abstraction layer for AIOS persistence.
 *
 * This module provides a unified interface for storage operations that works
 * across different environments:
 * - Browser: Uses IndexedDB for file system and localStorage for config
 * - CLI (Node.js/Bun): Uses the local file system (~/.aios/ directory)
 *
 * @module persistence/storage
 */

import type { FSNode, Session } from "../types";
import type { AIConfig } from "../stores/ai";

/**
 * Boot configuration interface
 */
export interface BootConfig {
  skipAnimation: boolean;
}

/**
 * Theme configuration interface
 */
export interface ThemeConfig {
  theme: string;
  colors?: Record<string, string>;
}

/**
 * Storage backend interface that all storage implementations must follow.
 * This provides a unified API for both IndexedDB and file system storage.
 */
export interface StorageBackend {
  /**
   * Initialize the storage backend.
   * For IndexedDB: Opens the database
   * For filesystem: Creates the ~/.aios/ directory structure
   */
  init(): Promise<void>;

  // Filesystem operations
  /**
   * Load all files for a given namespace (session)
   * @param namespace - The filesystem namespace (typically session ID)
   * @returns Map of paths to FSNodes
   */
  loadFilesystem(namespace: string): Promise<Map<string, FSNode>>;

  /**
   * Save a single file
   * @param namespace - The filesystem namespace
   * @param path - The absolute path of the file/directory
   * @param node - The FSNode to save
   */
  saveFile(namespace: string, path: string, node: FSNode): Promise<void>;

  /**
   * Delete a single file
   * @param namespace - The filesystem namespace
   * @param path - The absolute path of the file/directory
   */
  deleteFile(namespace: string, path: string): Promise<void>;

  /**
   * Sync entire filesystem to storage
   * @param namespace - The filesystem namespace
   * @param nodes - Map of all nodes in the VFS
   */
  syncFilesystem(namespace: string, nodes: Map<string, FSNode>): Promise<void>;

  // Session operations
  /**
   * Load all sessions from storage
   */
  loadSessions(): Promise<Record<string, Session>>;

  /**
   * Save a single session
   * @param session - The session to save
   */
  saveSession(session: Session): Promise<void>;

  /**
   * Delete a session from storage
   * @param id - The session ID
   */
  deleteSession(id: string): Promise<void>;

  /**
   * Sync all sessions to storage
   * @param sessions - Record of all sessions
   */
  syncSessions(sessions: Record<string, Session>): Promise<void>;

  // Config operations
  /**
   * Load AI configuration
   */
  loadAIConfig(): Promise<AIConfig | null>;

  /**
   * Save AI configuration
   * @param config - The AI config to save
   */
  saveAIConfig(config: AIConfig): Promise<void>;

  /**
   * Clear AI configuration
   */
  clearAIConfig(): Promise<void>;

  // Theme operations
  /**
   * Load theme configuration
   */
  loadTheme(): Promise<ThemeConfig | null>;

  /**
   * Save theme configuration
   * @param config - The theme config to save
   */
  saveTheme(config: ThemeConfig): Promise<void>;

  /**
   * Clear theme configuration
   */
  clearTheme(): Promise<void>;

  // Boot config operations
  /**
   * Load boot configuration
   */
  loadBootConfig(): Promise<BootConfig | null>;

  /**
   * Save boot configuration
   * @param config - The boot config to save
   */
  saveBootConfig(config: BootConfig): Promise<void>;

  /**
   * Clear boot configuration
   */
  clearBootConfig(): Promise<void>;
}

/**
 * Global storage backend instance.
 * Set by initStorage() based on environment detection.
 */
let storageBackend: StorageBackend | null = null;

/**
 * Get the current storage backend.
 * @throws Error if storage has not been initialized
 */
export function getStorage(): StorageBackend {
  if (!storageBackend) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return storageBackend;
}

/**
 * Set the storage backend (used for testing or manual configuration)
 * @param backend - The storage backend to use
 */
export function setStorage(backend: StorageBackend): void {
  storageBackend = backend;
}

/**
 * Check if storage has been initialized
 */
export function isStorageInitialized(): boolean {
  return storageBackend !== null;
}

/**
 * Initialize storage with appropriate backend based on environment.
 * This should be called once at application startup.
 *
 * @param forceBackend - Optional: force a specific backend type
 */
export async function initStorage(forceBackend?: "indexeddb" | "filesystem"): Promise<void> {
  // Lazy import to avoid loading unnecessary code
  const { isCLI } = await import("../utils/environment");

  const useCLI = forceBackend === "filesystem" || (forceBackend !== "indexeddb" && isCLI());

  if (useCLI) {
    const { FilesystemStorage } = await import("./filesystem-storage");
    storageBackend = new FilesystemStorage();
  } else {
    const { IndexedDBStorage } = await import("./indexeddb-storage");
    storageBackend = new IndexedDBStorage();
  }

  await storageBackend.init();
}
