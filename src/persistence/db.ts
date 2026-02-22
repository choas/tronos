import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { FSNode, Session, FileVersion, FileVersionHistory, ImportHistoryEntry, SessionSnapshot } from "../types";

interface TronOSDBSchema extends DBSchema {
  files: {
    key: string;                       // Full path with namespace prefix
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
    key: string;                       // Session ID
    value: Session;
  };
  config: {
    key: string;
    value: any;
  };
  fileVersions: {
    key: string;                       // version ID
    value: FileVersion;
    indexes: {
      "by-filePath": string;           // index by file path for lookup
    };
  };
  fileVersionHistory: {
    key: string;                       // file path (with namespace prefix)
    value: FileVersionHistory;
  };
  importHistory: {
    key: string;                       // import ID
    value: ImportHistoryEntry;
    indexes: {
      "by-sessionId": string;          // index by session ID for lookup
      "by-timestamp": number;          // index by timestamp for chronological listing
    };
  };
  snapshots: {
    key: string;                       // snapshot ID
    value: SessionSnapshot;
    indexes: {
      "by-sessionId": string;          // index by session ID for lookup
      "by-timestamp": number;          // index by timestamp for chronological listing
      "by-name": string;               // index by name for lookup
    };
  };
}

let db: IDBPDatabase<TronOSDBSchema> | null = null;

export async function initDB(): Promise<void> {
  db = await openDB<TronOSDBSchema>("tronos", 4, {
    upgrade(db, oldVersion) {
      // Version 1: Original stores
      if (oldVersion < 1) {
        // Files store
        const filesStore = db.createObjectStore("files", { keyPath: "path" });
        filesStore.createIndex("by-parent", "parent");

        // Sessions store
        db.createObjectStore("sessions", { keyPath: "id" });

        // Config store
        db.createObjectStore("config");
      }

      // Version 2: Add version history stores
      if (oldVersion < 2) {
        // File versions store - stores each version's content
        const versionsStore = db.createObjectStore("fileVersions", { keyPath: "id" });
        versionsStore.createIndex("by-filePath", "filePath");

        // File version history store - tracks current version and branches per file
        db.createObjectStore("fileVersionHistory", { keyPath: "filePath" });
      }

      // Version 3: Add import history store
      if (oldVersion < 3) {
        // Import history store - tracks all import operations for undo/history
        const importStore = db.createObjectStore("importHistory", { keyPath: "id" });
        importStore.createIndex("by-sessionId", "sessionId");
        importStore.createIndex("by-timestamp", "timestamp");
      }

      // Version 4: Add snapshots store
      if (oldVersion < 4) {
        // Snapshots store - stores named session checkpoints
        const snapshotsStore = db.createObjectStore("snapshots", { keyPath: "id" });
        snapshotsStore.createIndex("by-sessionId", "sessionId");
        snapshotsStore.createIndex("by-timestamp", "timestamp");
        snapshotsStore.createIndex("by-name", "name");
      }
    }
  });
}

export function getDB(): IDBPDatabase<TronOSDBSchema> {
  if (!db) {
    throw new Error("Database not initialized. Call initDB() first.");
  }
  return db;
}
