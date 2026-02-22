/**
 * @fileoverview Tests for filesystem-based storage backend.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FilesystemStorage } from "../src/persistence/filesystem-storage";
import type { FSNode, Session } from "../src/types";
import type { AIConfig } from "../src/stores/ai";

describe("FilesystemStorage", () => {
  let storage: FilesystemStorage;
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = path.join(os.tmpdir(), `aios-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    storage = new FilesystemStorage(testDir);
    await storage.init();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("init()", () => {
    it("should create the data directory structure", async () => {
      expect(fs.existsSync(testDir)).toBe(true);
      expect(fs.existsSync(path.join(testDir, "fs"))).toBe(true);
    });

    it("should handle being called multiple times", async () => {
      await storage.init();
      await storage.init();
      expect(fs.existsSync(testDir)).toBe(true);
    });
  });

  describe("filesystem operations", () => {
    const testNode: FSNode = {
      name: "test.txt",
      type: "file",
      parent: "/home/tronos",
      meta: { createdAt: 1000, updatedAt: 2000 }
    };

    it("should save and load a file", async () => {
      await storage.saveFile("session1", "/home/tronos/test.txt", testNode);
      const nodes = await storage.loadFilesystem("session1");

      expect(nodes.size).toBe(1);
      expect(nodes.get("/home/tronos/test.txt")).toEqual(testNode);
    });

    it("should handle empty namespace", async () => {
      const nodes = await storage.loadFilesystem("nonexistent");
      expect(nodes.size).toBe(0);
    });

    it("should delete a file", async () => {
      await storage.saveFile("session1", "/home/tronos/test.txt", testNode);
      await storage.deleteFile("session1", "/home/tronos/test.txt");

      const nodes = await storage.loadFilesystem("session1");
      expect(nodes.size).toBe(0);
    });

    it("should sync entire filesystem", async () => {
      const nodes = new Map<string, FSNode>();
      nodes.set("/", { name: "/", type: "directory", parent: null, meta: { createdAt: 1000, updatedAt: 1000 } } as FSNode);
      nodes.set("/home", { name: "home", type: "directory", parent: "/", meta: { createdAt: 1000, updatedAt: 1000 } } as FSNode);
      nodes.set("/home/tronos", { name: "aios", type: "directory", parent: "/home", meta: { createdAt: 1000, updatedAt: 1000 } } as FSNode);

      await storage.syncFilesystem("session1", nodes);

      const loaded = await storage.loadFilesystem("session1");
      expect(loaded.size).toBe(3);
      expect(loaded.get("/")).toBeDefined();
      expect(loaded.get("/home")).toBeDefined();
      expect(loaded.get("/home/tronos")).toBeDefined();
    });

    it("should handle multiple namespaces independently", async () => {
      await storage.saveFile("session1", "/file1.txt", testNode);
      await storage.saveFile("session2", "/file2.txt", { ...testNode, name: "file2.txt" });

      const nodes1 = await storage.loadFilesystem("session1");
      const nodes2 = await storage.loadFilesystem("session2");

      expect(nodes1.size).toBe(1);
      expect(nodes1.has("/file1.txt")).toBe(true);

      expect(nodes2.size).toBe(1);
      expect(nodes2.has("/file2.txt")).toBe(true);
    });
  });

  describe("session operations", () => {
    const testSession: Session = {
      id: "test-session-1",
      name: "Test Session",
      created: 1000,
      lastAccess: 2000,
      fsNamespace: "test-ns",
      env: { HOME: "/home/tronos" },
      history: ["ls", "pwd"],
      aliases: { ll: "ls -l" }
    };

    it("should save and load sessions", async () => {
      await storage.saveSession(testSession);
      const sessions = await storage.loadSessions();

      expect(Object.keys(sessions).length).toBe(1);
      expect(sessions["test-session-1"]).toEqual(testSession);
    });

    it("should handle empty sessions", async () => {
      const sessions = await storage.loadSessions();
      expect(Object.keys(sessions).length).toBe(0);
    });

    it("should delete a session", async () => {
      await storage.saveSession(testSession);
      await storage.deleteSession("test-session-1");

      const sessions = await storage.loadSessions();
      expect(Object.keys(sessions).length).toBe(0);
    });

    it("should sync all sessions", async () => {
      const sessions: Record<string, Session> = {
        "s1": { ...testSession, id: "s1", name: "Session 1" },
        "s2": { ...testSession, id: "s2", name: "Session 2" }
      };

      await storage.syncSessions(sessions);

      const loaded = await storage.loadSessions();
      expect(Object.keys(loaded).length).toBe(2);
      expect(loaded["s1"].name).toBe("Session 1");
      expect(loaded["s2"].name).toBe("Session 2");
    });

    it("should delete filesystem data when deleting session", async () => {
      // Save some filesystem data for the session
      await storage.saveFile("test-session-1", "/test.txt", {
        name: "test.txt",
        type: "file",
        parent: "/",
        meta: { createdAt: 1000, updatedAt: 1000 }
      } as FSNode);

      await storage.saveSession(testSession);
      await storage.deleteSession("test-session-1");

      // Both session and filesystem data should be gone
      const sessions = await storage.loadSessions();
      const fsNodes = await storage.loadFilesystem("test-session-1");

      expect(Object.keys(sessions).length).toBe(0);
      expect(fsNodes.size).toBe(0);
    });
  });

  describe("AI config operations", () => {
    const testConfig: AIConfig = {
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-3-opus",
      baseURL: "https://api.anthropic.com",
      temperature: 0.7,
      maxTokens: 4096
    };

    it("should save and load AI config", async () => {
      await storage.saveAIConfig(testConfig);
      const loaded = await storage.loadAIConfig();

      expect(loaded).toEqual(testConfig);
    });

    it("should return null for missing config", async () => {
      const loaded = await storage.loadAIConfig();
      expect(loaded).toBeNull();
    });

    it("should clear AI config", async () => {
      await storage.saveAIConfig(testConfig);
      await storage.clearAIConfig();

      const loaded = await storage.loadAIConfig();
      expect(loaded).toBeNull();
    });

    it("should validate config fields", async () => {
      // Write invalid config directly
      const configPath = path.join(testDir, "config.json");
      fs.writeFileSync(configPath, JSON.stringify({ provider: "anthropic" }));

      const loaded = await storage.loadAIConfig();
      expect(loaded).toBeNull();
    });
  });

  describe("theme operations", () => {
    it("should save and load theme", async () => {
      await storage.saveTheme({ theme: "dark" });
      const loaded = await storage.loadTheme();

      expect(loaded).toEqual({ theme: "dark" });
    });

    it("should return null for missing theme", async () => {
      const loaded = await storage.loadTheme();
      expect(loaded).toBeNull();
    });

    it("should clear theme", async () => {
      await storage.saveTheme({ theme: "light" });
      await storage.clearTheme();

      const loaded = await storage.loadTheme();
      expect(loaded).toBeNull();
    });

    it("should validate theme value", async () => {
      // Write invalid theme directly (missing theme key entirely)
      const themePath = path.join(testDir, "theme.json");
      fs.writeFileSync(themePath, JSON.stringify({ notTheme: "invalid" }));

      const loaded = await storage.loadTheme();
      expect(loaded).toBeNull();
    });
  });

  describe("boot config operations", () => {
    it("should save and load boot config", async () => {
      await storage.saveBootConfig({ skipAnimation: true });
      const loaded = await storage.loadBootConfig();

      expect(loaded).toEqual({ skipAnimation: true });
    });

    it("should return null for missing boot config", async () => {
      const loaded = await storage.loadBootConfig();
      expect(loaded).toBeNull();
    });

    it("should clear boot config", async () => {
      await storage.saveBootConfig({ skipAnimation: false });
      await storage.clearBootConfig();

      const loaded = await storage.loadBootConfig();
      expect(loaded).toBeNull();
    });
  });
});
