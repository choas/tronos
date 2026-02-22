/**
 * @fileoverview IndexedDB storage backend for browser environments.
 *
 * This module implements the StorageBackend interface using IndexedDB
 * for filesystem and session data, and localStorage for configuration.
 *
 * @module persistence/indexeddb-storage
 */

import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { FSNode, Session, FileVersion, FileVersionHistory, ImportHistoryEntry, SessionSnapshot } from "../types";
import type { AIConfig } from "../stores/ai";
import type { StorageBackend, BootConfig, ThemeConfig } from "./storage";

// localStorage keys
const AI_CONFIG_KEY = "tronos:ai-config";
const THEME_CONFIG_KEY = "tronos:theme";
const BOOT_CONFIG_KEY = "tronos:boot";

interface TronOSDBSchema extends DBSchema {
  files: {
    key: string;
    value: {
      path: string;
      node: FSNode;
      parent: string;
    };
    indexes: {
      "by-parent": string;
    };
  };
  sessions: {
    key: string;
    value: Session;
  };
  config: {
    key: string;
    value: unknown;
  };
  fileVersions: {
    key: string;
    value: FileVersion;
    indexes: {
      "by-filePath": string;
    };
  };
  fileVersionHistory: {
    key: string;
    value: FileVersionHistory;
  };
  importHistory: {
    key: string;
    value: ImportHistoryEntry;
    indexes: {
      "by-sessionId": string;
      "by-timestamp": number;
    };
  };
  snapshots: {
    key: string;
    value: SessionSnapshot;
    indexes: {
      "by-sessionId": string;
      "by-timestamp": number;
      "by-name": string;
    };
  };
}

/**
 * Convert a session object (possibly a Solid.js Proxy) to a plain JavaScript object.
 */
function toPlainSession(session: Session): Session {
  return {
    id: session.id,
    name: session.name,
    created: session.created,
    lastAccess: session.lastAccess,
    fsNamespace: session.fsNamespace,
    env: { ...session.env },
    history: [...session.history],
    aliases: { ...session.aliases },
    conversationHistory: session.conversationHistory
      ? session.conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          mode: msg.mode,
        }))
      : undefined
  };
}

/**
 * IndexedDB-based storage backend for browser environments.
 */
export class IndexedDBStorage implements StorageBackend {
  private db: IDBPDatabase<TronOSDBSchema> | null = null;

  async init(): Promise<void> {
    // Reuse the DB connection from db.ts if already initialized (avoids version conflict)
    try {
      const { getDB: getLegacyDB } = await import("./db");
      this.db = getLegacyDB() as unknown as IDBPDatabase<TronOSDBSchema>;
      return;
    } catch {
      // Legacy DB not initialized, open our own connection
    }

    this.db = await openDB<TronOSDBSchema>("tronos", 4, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const filesStore = db.createObjectStore("files", { keyPath: "path" });
          filesStore.createIndex("by-parent", "parent");
          db.createObjectStore("sessions", { keyPath: "id" });
          db.createObjectStore("config");
        }
        if (oldVersion < 2) {
          const versionsStore = db.createObjectStore("fileVersions", { keyPath: "id" });
          versionsStore.createIndex("by-filePath", "filePath");
          db.createObjectStore("fileVersionHistory", { keyPath: "filePath" });
        }
        if (oldVersion < 3) {
          const importStore = db.createObjectStore("importHistory", { keyPath: "id" });
          importStore.createIndex("by-sessionId", "sessionId");
          importStore.createIndex("by-timestamp", "timestamp");
        }
        if (oldVersion < 4) {
          const snapshotsStore = db.createObjectStore("snapshots", { keyPath: "id" });
          snapshotsStore.createIndex("by-sessionId", "sessionId");
          snapshotsStore.createIndex("by-timestamp", "timestamp");
          snapshotsStore.createIndex("by-name", "name");
        }
      }
    });
  }

  private getDB(): IDBPDatabase<TronOSDBSchema> {
    if (!this.db) {
      throw new Error("IndexedDB not initialized. Call init() first.");
    }
    return this.db;
  }

  // Filesystem operations
  async loadFilesystem(namespace: string): Promise<Map<string, FSNode>> {
    const db = this.getDB();
    const nodes = new Map<string, FSNode>();
    const allFiles = await db.getAllFromIndex("files", "by-parent");

    for (const file of allFiles) {
      if (file.path.startsWith(`${namespace}:`)) {
        const actualPath = file.path.substring(namespace.length + 1);
        nodes.set(actualPath, file.node);
      }
    }

    return nodes;
  }

  async saveFile(namespace: string, path: string, node: FSNode): Promise<void> {
    const db = this.getDB();
    const key = `${namespace}:${path}`;

    await db.put("files", {
      path: key,
      node,
      parent: node.parent || "/",
    });
  }

  async deleteFile(namespace: string, path: string): Promise<void> {
    const db = this.getDB();
    const key = `${namespace}:${path}`;
    await db.delete("files", key);
  }

  async syncFilesystem(namespace: string, nodes: Map<string, FSNode>): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction("files", "readwrite");
    const prefix = `${namespace}:`;

    // Delete all existing files for this namespace
    const allKeys = await tx.store.getAllKeys();
    for (const key of allKeys) {
      if (key.startsWith(prefix)) {
        await tx.store.delete(key);
      }
    }

    // Save all current nodes
    for (const [path, node] of nodes.entries()) {
      const key = `${namespace}:${path}`;
      await tx.store.put({
        path: key,
        node,
        parent: node.parent || "/",
      });
    }

    await tx.done;
  }

  // Session operations
  async loadSessions(): Promise<Record<string, Session>> {
    try {
      const db = this.getDB();
      const sessions = await db.getAll("sessions");

      const sessionsRecord: Record<string, Session> = {};
      for (const session of sessions) {
        sessionsRecord[session.id] = session;
      }

      return sessionsRecord;
    } catch (error) {
      console.error("Failed to load sessions:", error);
      return {};
    }
  }

  async saveSession(session: Session): Promise<void> {
    try {
      const db = this.getDB();
      await db.put("sessions", toPlainSession(session));
    } catch (error) {
      console.error("Failed to save session:", error);
    }
  }

  async deleteSession(id: string): Promise<void> {
    try {
      const db = this.getDB();
      await db.delete("sessions", id);
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  }

  async syncSessions(sessions: Record<string, Session>): Promise<void> {
    try {
      const db = this.getDB();
      const tx = db.transaction("sessions", "readwrite");

      await tx.store.clear();

      for (const session of Object.values(sessions)) {
        await tx.store.put(toPlainSession(session));
      }

      await tx.done;
    } catch (error) {
      console.error("Failed to sync sessions:", error);
    }
  }

  // AI Config operations (localStorage)
  async loadAIConfig(): Promise<AIConfig | null> {
    try {
      const stored = localStorage.getItem(AI_CONFIG_KEY);
      if (!stored) {
        return null;
      }
      const config = JSON.parse(stored) as AIConfig;
      // Validate required fields
      if (
        typeof config.provider === "string" &&
        typeof config.apiKey === "string" &&
        typeof config.model === "string" &&
        typeof config.baseURL === "string" &&
        typeof config.temperature === "number" &&
        typeof config.maxTokens === "number"
      ) {
        return config;
      }
      return null;
    } catch {
      return null;
    }
  }

  async saveAIConfig(config: AIConfig): Promise<void> {
    try {
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    } catch {
      console.warn("Failed to save AI config to localStorage");
    }
  }

  async clearAIConfig(): Promise<void> {
    try {
      localStorage.removeItem(AI_CONFIG_KEY);
    } catch {
      // Ignore errors
    }
  }

  // Theme operations (localStorage)
  async loadTheme(): Promise<ThemeConfig | null> {
    try {
      const stored = localStorage.getItem(THEME_CONFIG_KEY);
      if (!stored) {
        return null;
      }
      const config = JSON.parse(stored) as ThemeConfig;
      if (config.theme) {
        return config;
      }
      return null;
    } catch {
      return null;
    }
  }

  async saveTheme(config: ThemeConfig): Promise<void> {
    try {
      localStorage.setItem(THEME_CONFIG_KEY, JSON.stringify(config));
    } catch {
      console.warn("Failed to save theme to localStorage");
    }
  }

  async clearTheme(): Promise<void> {
    try {
      localStorage.removeItem(THEME_CONFIG_KEY);
    } catch {
      // Ignore errors
    }
  }

  // Boot config operations (localStorage)
  async loadBootConfig(): Promise<BootConfig | null> {
    try {
      const stored = localStorage.getItem(BOOT_CONFIG_KEY);
      if (!stored) {
        return null;
      }
      const config = JSON.parse(stored) as BootConfig;
      if (typeof config.skipAnimation === "boolean") {
        return config;
      }
      return null;
    } catch {
      return null;
    }
  }

  async saveBootConfig(config: BootConfig): Promise<void> {
    try {
      localStorage.setItem(BOOT_CONFIG_KEY, JSON.stringify(config));
    } catch {
      console.warn("Failed to save boot config to localStorage");
    }
  }

  async clearBootConfig(): Promise<void> {
    try {
      localStorage.removeItem(BOOT_CONFIG_KEY);
    } catch {
      // Ignore errors
    }
  }
}
