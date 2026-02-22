/**
 * Tests for the timewarp builtin command (file versioning).
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { timewarp } from "../src/engine/builtins/timewarp";
import { InMemoryVFS } from "../src/vfs/memory";
import type { ExecutionContext } from "../src/engine/types";

// Mock the persistence module
vi.mock("../src/persistence/versions", () => ({
  getFileVersions: vi.fn(),
  saveVersion: vi.fn(),
  revertToVersion: vi.fn(),
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  hasVersionHistory: vi.fn(),
}));

// Mock the sessions module
vi.mock("../src/stores/sessions", () => ({
  getActiveSession: vi.fn(() => ({
    id: "test-session",
    fsNamespace: "test_namespace",
  })),
}));

import {
  getFileVersions,
  saveVersion,
  revertToVersion,
  listBranches,
  createBranch,
  hasVersionHistory,
} from "../src/persistence/versions";

describe("timewarp builtin command", () => {
  let vfs: InMemoryVFS;
  let context: ExecutionContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    vfs = new InMemoryVFS();
    await vfs.init();
    vfs.mkdir("/home/user", true);
    vfs.chdir("/home/user");
    vfs.write("/home/user/test.txt", "Hello, World!");

    context = {
      stdin: "",
      env: { HOME: "/home/user" },
      vfs,
    };
  });

  describe("help and usage", () => {
    it("should show usage when called with no arguments", async () => {
      const result = await timewarp([], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp");
      expect(result.stderr).toContain("list");
      expect(result.stderr).toContain("show");
      expect(result.stderr).toContain("revert");
      expect(result.stderr).toContain("diff");
    });

    it("should show error for unknown subcommand", async () => {
      const result = await timewarp(["unknown"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown subcommand 'unknown'");
    });
  });

  describe("list subcommand", () => {
    it("should show usage when file not specified", async () => {
      const result = await timewarp(["list"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp list <file>");
    });

    it("should show error for non-existent file with no history", async () => {
      (hasVersionHistory as Mock).mockResolvedValue(false);
      const result = await timewarp(["list", "nonexistent.txt"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No such file");
    });

    it("should show empty message when file has no versions", async () => {
      (hasVersionHistory as Mock).mockResolvedValue(true);
      (getFileVersions as Mock).mockResolvedValue([]);
      const result = await timewarp(["list", "test.txt"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No version history");
    });

    it("should list versions with timestamps", async () => {
      (hasVersionHistory as Mock).mockResolvedValue(true);
      (getFileVersions as Mock).mockResolvedValue([
        {
          id: "abc12345-1234-5678-9abc-def012345678",
          filePath: "test_namespace:/home/user/test.txt",
          content: "version 1",
          timestamp: 1700000000000,
          parentId: null,
          branchName: "main",
          message: "Initial version",
          author: "user",
        },
      ]);

      const result = await timewarp(["list", "test.txt"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("abc12345");
      expect(result.stdout).toContain("Initial version");
      expect(result.stdout).toContain("user");
      expect(result.stdout).toContain("main");
    });
  });

  describe("show subcommand", () => {
    it("should show usage when file or version not specified", async () => {
      const result = await timewarp(["show", "test.txt"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp show");
    });

    it("should show error for non-existent version", async () => {
      (getFileVersions as Mock).mockResolvedValue([]);
      const result = await timewarp(["show", "test.txt", "abc12345"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not found");
    });

    it("should display version content", async () => {
      (getFileVersions as Mock).mockResolvedValue([
        {
          id: "abc12345-1234-5678-9abc-def012345678",
          filePath: "test_namespace:/home/user/test.txt",
          content: "This is version 1",
          timestamp: 1700000000000,
          parentId: null,
          branchName: "main",
          message: "Initial version",
          author: "user",
        },
      ]);

      const result = await timewarp(["show", "test.txt", "abc12345"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Version: abc12345");
      expect(result.stdout).toContain("This is version 1");
      expect(result.stdout).toContain("Initial version");
    });
  });

  describe("save subcommand", () => {
    it("should show usage when file not specified", async () => {
      const result = await timewarp(["save"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp save");
    });

    it("should show error for non-existent file", async () => {
      const result = await timewarp(["save", "nonexistent.txt"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No such file");
    });

    it("should save a version", async () => {
      (saveVersion as Mock).mockResolvedValue({
        id: "new-version-id-12345678",
        filePath: "test_namespace:/home/user/test.txt",
        content: "Hello, World!",
        timestamp: Date.now(),
        parentId: null,
        branchName: "main",
        author: "user",
      });

      const result = await timewarp(["save", "test.txt", "My", "commit", "message"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Saved version");
      expect(saveVersion).toHaveBeenCalledWith(
        "test_namespace",
        "/home/user/test.txt",
        "Hello, World!",
        { message: "My commit message", author: "user" }
      );
    });
  });

  describe("revert subcommand", () => {
    it("should show usage when file or version not specified", async () => {
      const result = await timewarp(["revert", "test.txt"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp revert");
    });

    it("should show error for non-existent version", async () => {
      (getFileVersions as Mock).mockResolvedValue([]);
      const result = await timewarp(["revert", "test.txt", "abc12345"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not found");
    });

    it("should revert file to specified version", async () => {
      (getFileVersions as Mock).mockResolvedValue([
        {
          id: "abc12345-1234-5678-9abc-def012345678",
          filePath: "test_namespace:/home/user/test.txt",
          content: "Old content",
          timestamp: 1700000000000,
          parentId: null,
          branchName: "main",
        },
      ]);

      (revertToVersion as Mock).mockResolvedValue({
        version: {
          id: "new-version-id",
          filePath: "test_namespace:/home/user/test.txt",
          content: "Old content",
          timestamp: Date.now(),
          parentId: "abc12345-1234-5678-9abc-def012345678",
          branchName: "main",
        },
        content: "Old content",
      });

      const result = await timewarp(["revert", "test.txt", "abc12345"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Reverted");
      expect(vfs.readSync("/home/user/test.txt")).toBe("Old content");
    });
  });

  describe("diff subcommand", () => {
    it("should show usage when file not specified", async () => {
      const result = await timewarp(["diff"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp diff");
    });

    it("should show message when no version history", async () => {
      (getFileVersions as Mock).mockResolvedValue([]);
      const result = await timewarp(["diff", "test.txt"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No version history");
    });

    it("should show diff between version and current", async () => {
      (getFileVersions as Mock).mockResolvedValue([
        {
          id: "abc12345-1234-5678-9abc-def012345678",
          filePath: "test_namespace:/home/user/test.txt",
          content: "Hello, World!",
          timestamp: 1700000000000,
          parentId: null,
          branchName: "main",
        },
      ]);

      // Current file has different content
      vfs.write("/home/user/test.txt", "Hello, New World!");

      const result = await timewarp(["diff", "test.txt", "abc12345"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("---");
      expect(result.stdout).toContain("+++");
    });

    it("should show no differences when content is same", async () => {
      (getFileVersions as Mock).mockResolvedValue([
        {
          id: "abc12345-1234-5678-9abc-def012345678",
          filePath: "test_namespace:/home/user/test.txt",
          content: "Hello, World!",
          timestamp: 1700000000000,
          parentId: null,
          branchName: "main",
        },
      ]);

      const result = await timewarp(["diff", "test.txt", "abc12345"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No differences");
    });
  });

  describe("branches subcommand", () => {
    it("should show usage when file not specified", async () => {
      const result = await timewarp(["branches"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp branches");
    });

    it("should show empty message when no branches", async () => {
      (listBranches as Mock).mockResolvedValue({});
      const result = await timewarp(["branches", "test.txt"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No branches");
    });

    it("should list branches", async () => {
      (listBranches as Mock).mockResolvedValue({
        main: "abc12345",
        feature: "def67890",
      });

      const result = await timewarp(["branches", "test.txt"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("main");
      expect(result.stdout).toContain("feature");
    });
  });

  describe("branch subcommand", () => {
    it("should show usage when file or name not specified", async () => {
      const result = await timewarp(["branch", "test.txt"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: timewarp branch");
    });

    it("should create a new branch", async () => {
      (createBranch as Mock).mockResolvedValue({
        id: "new-branch-version-id",
        filePath: "test_namespace:/home/user/test.txt",
        content: "Hello, World!",
        timestamp: Date.now(),
        parentId: "abc12345",
        branchName: "feature",
      });

      const result = await timewarp(["branch", "test.txt", "feature"], context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Created branch 'feature'");
    });

    it("should show error when file has no version history", async () => {
      (createBranch as Mock).mockResolvedValue(null);
      const result = await timewarp(["branch", "test.txt", "feature"], context);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no version history");
    });
  });

  describe("VFS unavailable", () => {
    it("should show error when VFS is not available", async () => {
      const noVfsContext: ExecutionContext = {
        stdin: "",
        env: {},
      };
      const result = await timewarp(["list", "test.txt"], noVfsContext);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("VFS not available");
    });
  });
});
