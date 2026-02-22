/**
 * @fileoverview Filesystem storage backend for CLI environments (Node.js/Bun).
 *
 * This module implements the StorageBackend interface using the local filesystem
 * for all data storage. Data is stored in ~/.aios/ by default.
 *
 * Directory structure:
 * ~/.aios/
 *   fs/
 *     <session-id>.json    # VFS data for each session
 *   sessions.json          # All sessions data
 *   config.json            # AI configuration
 *   theme.json             # Theme configuration
 *   boot.json              # Boot configuration
 *
 * @module persistence/filesystem-storage
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { FSNode, Session } from "../types";
import type { AIConfig } from "../stores/ai";
import type { StorageBackend, BootConfig, ThemeConfig } from "./storage";

/**
 * Get the AIOS data directory path.
 * Uses ~/.aios/ or AIOS_DATA_DIR environment variable if set.
 */
function getDataDir(): string {
  const envDir = process.env.AIOS_DATA_DIR;
  if (envDir) {
    return envDir;
  }
  return path.join(os.homedir(), ".aios");
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
    conversationHistory: session.conversationHistory ? [...session.conversationHistory] : undefined
  };
}

/**
 * Filesystem-based storage backend for CLI environments.
 */
export class FilesystemStorage implements StorageBackend {
  private dataDir: string;
  private fsDir: string;
  private sessionsFile: string;
  private configFile: string;
  private themeFile: string;
  private bootFile: string;
  /** Per-file write locks to serialize read-modify-write cycles */
  private fileLocks: Map<string, Promise<void>> = new Map();

  constructor(dataDir?: string) {
    this.dataDir = dataDir || getDataDir();
    this.fsDir = path.join(this.dataDir, "fs");
    this.sessionsFile = path.join(this.dataDir, "sessions.json");
    this.configFile = path.join(this.dataDir, "config.json");
    this.themeFile = path.join(this.dataDir, "theme.json");
    this.bootFile = path.join(this.dataDir, "boot.json");
  }

  async init(): Promise<void> {
    // Create directory structure if it doesn't exist
    await this.ensureDir(this.dataDir);
    await this.ensureDir(this.fsDir);
  }

  private async ensureDir(dir: string): Promise<void> {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory already exists or other error
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  private async readJSON<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      console.error(`Failed to read ${filePath}:`, error);
      return null;
    }
  }

  private async writeJSON(filePath: string, data: unknown): Promise<void> {
    const tmpPath = filePath + ".tmp";
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      // Clean up temp file on failure
      try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
      console.error(`Failed to write ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Serialize access to a file so read-modify-write cycles don't interleave.
   * Concurrent calls for the same file are queued and executed in order.
   */
  private async withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.fileLocks.get(filePath) ?? Promise.resolve();
    let resolve: () => void;
    const current = new Promise<void>(r => { resolve = r; });
    this.fileLocks.set(filePath, current);

    await previous;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }

  private async deleteJSON(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`Failed to delete ${filePath}:`, error);
      }
      // File doesn't exist, that's fine
    }
  }

  private getFsFilePath(namespace: string): string {
    // Sanitize namespace for use as filename
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9-_]/g, "_");
    return path.join(this.fsDir, `${safeNamespace}.json`);
  }

  // Filesystem operations
  async loadFilesystem(namespace: string): Promise<Map<string, FSNode>> {
    const filePath = this.getFsFilePath(namespace);
    const data = await this.readJSON<Record<string, FSNode>>(filePath);

    if (!data) {
      return new Map();
    }

    return new Map(Object.entries(data));
  }

  async saveFile(namespace: string, path: string, node: FSNode): Promise<void> {
    const filePath = this.getFsFilePath(namespace);

    await this.withFileLock(filePath, async () => {
      const existing = await this.readJSON<Record<string, FSNode>>(filePath) || {};
      existing[path] = node;
      await this.writeJSON(filePath, existing);
    });
  }

  async deleteFile(namespace: string, path: string): Promise<void> {
    const filePath = this.getFsFilePath(namespace);

    await this.withFileLock(filePath, async () => {
      const existing = await this.readJSON<Record<string, FSNode>>(filePath);
      if (existing && existing[path]) {
        delete existing[path];
        await this.writeJSON(filePath, existing);
      }
    });
  }

  async syncFilesystem(namespace: string, nodes: Map<string, FSNode>): Promise<void> {
    const filePath = this.getFsFilePath(namespace);

    await this.withFileLock(filePath, async () => {
      // Convert Map to plain object and save
      const data: Record<string, FSNode> = {};
      for (const [path, node] of nodes.entries()) {
        data[path] = node;
      }

      await this.writeJSON(filePath, data);
    });
  }

  // Session operations
  async loadSessions(): Promise<Record<string, Session>> {
    const data = await this.readJSON<Record<string, Session>>(this.sessionsFile);
    return data || {};
  }

  async saveSession(session: Session): Promise<void> {
    await this.withFileLock(this.sessionsFile, async () => {
      const existing = await this.loadSessions();
      existing[session.id] = toPlainSession(session);
      await this.writeJSON(this.sessionsFile, existing);
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.withFileLock(this.sessionsFile, async () => {
      const existing = await this.loadSessions();
      if (existing[id]) {
        delete existing[id];
        await this.writeJSON(this.sessionsFile, existing);

        // Also delete the filesystem data for this session
        const fsFilePath = this.getFsFilePath(id);
        await this.deleteJSON(fsFilePath);
      }
    });
  }

  async syncSessions(sessions: Record<string, Session>): Promise<void> {
    await this.withFileLock(this.sessionsFile, async () => {
      const plainSessions: Record<string, Session> = {};
      for (const [id, session] of Object.entries(sessions)) {
        plainSessions[id] = toPlainSession(session);
      }
      await this.writeJSON(this.sessionsFile, plainSessions);
    });
  }

  // AI Config operations
  async loadAIConfig(): Promise<AIConfig | null> {
    const config = await this.readJSON<AIConfig>(this.configFile);

    if (!config) {
      return null;
    }

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
  }

  async saveAIConfig(config: AIConfig): Promise<void> {
    await this.writeJSON(this.configFile, config);
  }

  async clearAIConfig(): Promise<void> {
    await this.deleteJSON(this.configFile);
  }

  // Theme operations
  async loadTheme(): Promise<ThemeConfig | null> {
    const config = await this.readJSON<ThemeConfig>(this.themeFile);

    if (!config) {
      return null;
    }

    if (config.theme) {
      return config;
    }

    return null;
  }

  async saveTheme(config: ThemeConfig): Promise<void> {
    await this.writeJSON(this.themeFile, config);
  }

  async clearTheme(): Promise<void> {
    await this.deleteJSON(this.themeFile);
  }

  // Boot config operations
  async loadBootConfig(): Promise<BootConfig | null> {
    const config = await this.readJSON<BootConfig>(this.bootFile);

    if (!config) {
      return null;
    }

    if (typeof config.skipAnimation === "boolean") {
      return config;
    }

    return null;
  }

  async saveBootConfig(config: BootConfig): Promise<void> {
    await this.writeJSON(this.bootFile, config);
  }

  async clearBootConfig(): Promise<void> {
    await this.deleteJSON(this.bootFile);
  }
}
