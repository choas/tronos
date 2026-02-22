/**
 * @fileoverview Timewarp command for file version control.
 *
 * This module provides the `timewarp` builtin command which allows users
 * to manage file version history, view past versions, revert files to
 * previous states, and compare differences between versions.
 *
 * Subcommands:
 * - list <file>        - Show version history with timestamps
 * - show <file> <ver>  - Display specific version content
 * - revert <file> <ver>- Restore file to previous version
 * - diff <file> [v1] [v2] - Show differences between versions
 * - save <file> [msg]  - Manually save a version with optional message
 * - branches <file>    - List all branches for a file
 * - branch <file> <name> - Create a new branch
 *
 * @module engine/builtins/timewarp
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import type { FileVersion } from "../../types";
import { getActiveSession } from "../../stores/sessions";
import {
  getFileVersions,
  getVersionHistory,
  saveVersion,
  revertToVersion,
  listBranches,
  createBranch,
  hasVersionHistory,
} from "../../persistence/versions";

/**
 * Format a timestamp as a human-readable date/time string.
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Calculate a simple unified diff between two strings.
 * Returns a colorized diff string.
 */
function simpleDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: string[] = [];

  // Track which lines are added, removed, or unchanged
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i >= oldLines.length) {
      // All remaining lines are additions
      result.push(`\x1b[32m+ ${newLines[j]}\x1b[0m`);
      j++;
    } else if (j >= newLines.length) {
      // All remaining lines are deletions
      result.push(`\x1b[31m- ${oldLines[i]}\x1b[0m`);
      i++;
    } else if (oldLines[i] === newLines[j]) {
      // Lines match - context
      result.push(`  ${oldLines[i]}`);
      i++;
      j++;
    } else {
      // Lines differ - check for modification vs add/delete
      // Look ahead to see if we can find a match
      let foundOld = -1;
      let foundNew = -1;

      // Look for oldLines[i] in upcoming newLines
      for (let k = j; k < Math.min(j + 5, newLines.length); k++) {
        if (oldLines[i] === newLines[k]) {
          foundNew = k;
          break;
        }
      }

      // Look for newLines[j] in upcoming oldLines
      for (let k = i; k < Math.min(i + 5, oldLines.length); k++) {
        if (newLines[j] === oldLines[k]) {
          foundOld = k;
          break;
        }
      }

      if (foundNew !== -1 && (foundOld === -1 || foundNew - j <= foundOld - i)) {
        // New lines were added
        while (j < foundNew) {
          result.push(`\x1b[32m+ ${newLines[j]}\x1b[0m`);
          j++;
        }
      } else if (foundOld !== -1) {
        // Old lines were deleted
        while (i < foundOld) {
          result.push(`\x1b[31m- ${oldLines[i]}\x1b[0m`);
          i++;
        }
      } else {
        // Simple modification
        result.push(`\x1b[31m- ${oldLines[i]}\x1b[0m`);
        result.push(`\x1b[32m+ ${newLines[j]}\x1b[0m`);
        i++;
        j++;
      }
    }
  }

  return result.join("\n");
}

/**
 * Truncate version ID for display (show first 8 chars).
 */
function shortId(id: string): string {
  return id.substring(0, 8);
}

/**
 * Resolve a version identifier to a FileVersion.
 * Tries matching by UUID prefix first, then by branch name.
 */
async function resolveVersion(
  namespace: string,
  filePath: string,
  versionId: string,
  versions: FileVersion[]
): Promise<FileVersion | null> {
  // Try UUID prefix match first
  const byId = versions.find((v) => v.id.startsWith(versionId));
  if (byId) return byId;

  // Try branch name resolution
  try {
    const history = await getVersionHistory(namespace, filePath);
    if (history?.branches[versionId]) {
      const branchVersionId = history.branches[versionId];
      return versions.find((v) => v.id === branchVersionId) || null;
    }
  } catch {
    // DB may not be available in some environments
  }

  return null;
}

/**
 * The timewarp builtin command for file version control.
 */
export const timewarp: BuiltinCommand = async (
  args: string[],
  context: ExecutionContext
): Promise<CommandResult> => {
  const subcommand = args[0];

  if (!subcommand) {
    return {
      stdout: "",
      stderr: `Usage: timewarp <subcommand> [args...]

Subcommands:
  list <file>              Show version history with timestamps
  show <file> <version>    Display content of a specific version
  revert <file> <version>  Restore file to a previous version
  diff <file> [v1] [v2]    Show differences between versions
  save <file> [message]    Manually save current version
  branches <file>          List all branches for a file
  branch <file> <name>     Create a new branch from current version

Examples:
  timewarp list myfile.txt
  timewarp show myfile.txt abc12345
  timewarp revert myfile.txt abc12345
  timewarp diff myfile.txt abc12345 def67890
  timewarp diff myfile.txt abc12345  # Compare version to current
  timewarp save myfile.txt "Added new feature"
`,
      exitCode: 1,
    };
  }

  if (!context.vfs) {
    return { stdout: "", stderr: "Error: VFS not available\n", exitCode: 1 };
  }

  const namespace = getActiveSession().fsNamespace;

  switch (subcommand) {
    case "list": {
      const filePath = args[1];
      if (!filePath) {
        return {
          stdout: "",
          stderr: "Usage: timewarp list <file>\n",
          exitCode: 1,
        };
      }

      const resolvedPath = context.vfs.resolve(filePath);

      // Check if file exists or has history
      const hasHistory = await hasVersionHistory(namespace, resolvedPath);
      if (!hasHistory && !context.vfs.exists(resolvedPath)) {
        return {
          stdout: "",
          stderr: `timewarp: ${filePath}: No such file\n`,
          exitCode: 1,
        };
      }

      const versions = await getFileVersions(namespace, resolvedPath);

      if (versions.length === 0) {
        return {
          stdout: `No version history for ${filePath}\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      const output: string[] = [];
      output.push(`Version history for ${filePath}:\n`);
      output.push("ID        Date                    Author   Branch  Message");
      output.push("--------  ----------------------  -------  ------  -------");

      for (const v of versions) {
        const id = shortId(v.id);
        const date = formatTimestamp(v.timestamp);
        const author = (v.author || "user").padEnd(7);
        const branch = (v.branchName || "main").padEnd(6);
        const msg = v.message || "";
        output.push(`${id}  ${date}  ${author}  ${branch}  ${msg}`);
      }

      return { stdout: output.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "show": {
      const filePath = args[1];
      const versionId = args[2];

      if (!filePath || !versionId) {
        return {
          stdout: "",
          stderr: "Usage: timewarp show <file> <version>\n",
          exitCode: 1,
        };
      }

      const resolvedPath = context.vfs.resolve(filePath);
      const versions = await getFileVersions(namespace, resolvedPath);

      // Find version by ID prefix or branch name
      const version = await resolveVersion(namespace, resolvedPath, versionId, versions);

      if (!version) {
        return {
          stdout: "",
          stderr: `timewarp: version '${versionId}' not found for ${filePath}\n`,
          exitCode: 1,
        };
      }

      const output: string[] = [];
      output.push(`Version: ${version.id}`);
      output.push(`Date: ${formatTimestamp(version.timestamp)}`);
      output.push(`Author: ${version.author || "user"}`);
      output.push(`Branch: ${version.branchName || "main"}`);
      if (version.message) {
        output.push(`Message: ${version.message}`);
      }
      output.push("");
      output.push("--- Content ---");
      output.push(version.content);

      return { stdout: output.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "revert": {
      const filePath = args[1];
      const versionId = args[2];
      const branchFlag = args[3] === "--branch" ? args[4] : undefined;

      if (!filePath || !versionId) {
        return {
          stdout: "",
          stderr:
            "Usage: timewarp revert <file> <version> [--branch <name>]\n",
          exitCode: 1,
        };
      }

      const resolvedPath = context.vfs.resolve(filePath);
      const versions = await getFileVersions(namespace, resolvedPath);

      // Find version by ID prefix or branch name
      const version = await resolveVersion(namespace, resolvedPath, versionId, versions);

      if (!version) {
        return {
          stdout: "",
          stderr: `timewarp: version '${versionId}' not found for ${filePath}\n`,
          exitCode: 1,
        };
      }

      // Revert to the version
      const result = await revertToVersion(
        namespace,
        resolvedPath,
        version.id,
        { createBranch: branchFlag }
      );

      if (!result) {
        return {
          stdout: "",
          stderr: `timewarp: failed to revert ${filePath}\n`,
          exitCode: 1,
        };
      }

      // Update the actual file in VFS
      await context.vfs.write(resolvedPath, result.content);

      const output = branchFlag
        ? `Reverted ${filePath} to version ${shortId(version.id)} on new branch '${branchFlag}'\n`
        : `Reverted ${filePath} to version ${shortId(version.id)}\n`;

      return { stdout: output, stderr: "", exitCode: 0 };
    }

    case "diff": {
      const filePath = args[1];
      const version1 = args[2];
      const version2 = args[3];

      if (!filePath) {
        return {
          stdout: "",
          stderr: "Usage: timewarp diff <file> [version1] [version2]\n",
          exitCode: 1,
        };
      }

      const resolvedPath = context.vfs.resolve(filePath);
      const versions = await getFileVersions(namespace, resolvedPath);

      let oldContent: string;
      let newContent: string;
      let oldLabel: string;
      let newLabel: string;

      if (!version1) {
        // No versions specified - show diff between latest version and current
        if (versions.length === 0) {
          return {
            stdout: "No version history to compare\n",
            stderr: "",
            exitCode: 0,
          };
        }

        const latestVersion = versions[0];
        oldContent = latestVersion.content;
        oldLabel = `version ${shortId(latestVersion.id)}`;

        if (!context.vfs.exists(resolvedPath)) {
          return {
            stdout: "",
            stderr: `timewarp: ${filePath}: No such file\n`,
            exitCode: 1,
          };
        }

        const currentContent = context.vfs.readSync(resolvedPath);
        newContent = currentContent;
        newLabel = "current";
      } else if (!version2) {
        // One version specified - compare to current
        const v1 = await resolveVersion(namespace, resolvedPath, version1, versions);
        if (!v1) {
          return {
            stdout: "",
            stderr: `timewarp: version '${version1}' not found\n`,
            exitCode: 1,
          };
        }

        oldContent = v1.content;
        oldLabel = `version ${shortId(v1.id)}`;

        if (!context.vfs.exists(resolvedPath)) {
          return {
            stdout: "",
            stderr: `timewarp: ${filePath}: No such file\n`,
            exitCode: 1,
          };
        }

        const currentContent = context.vfs.readSync(resolvedPath);
        newContent = currentContent;
        newLabel = "current";
      } else {
        // Two versions specified - compare them
        const v1 = await resolveVersion(namespace, resolvedPath, version1, versions);
        const v2 = await resolveVersion(namespace, resolvedPath, version2, versions);

        if (!v1) {
          return {
            stdout: "",
            stderr: `timewarp: version '${version1}' not found\n`,
            exitCode: 1,
          };
        }
        if (!v2) {
          return {
            stdout: "",
            stderr: `timewarp: version '${version2}' not found\n`,
            exitCode: 1,
          };
        }

        oldContent = v1.content;
        oldLabel = `version ${shortId(v1.id)}`;
        newContent = v2.content;
        newLabel = `version ${shortId(v2.id)}`;
      }

      if (oldContent === newContent) {
        return {
          stdout: "No differences\n",
          stderr: "",
          exitCode: 0,
        };
      }

      const output: string[] = [];
      output.push(`--- ${oldLabel}`);
      output.push(`+++ ${newLabel}`);
      output.push("");
      output.push(simpleDiff(oldContent, newContent));

      return { stdout: output.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "save": {
      const filePath = args[1];
      const message = args.slice(2).join(" ") || undefined;

      if (!filePath) {
        return {
          stdout: "",
          stderr: "Usage: timewarp save <file> [message]\n",
          exitCode: 1,
        };
      }

      const resolvedPath = context.vfs.resolve(filePath);

      if (!context.vfs.exists(resolvedPath)) {
        return {
          stdout: "",
          stderr: `timewarp: ${filePath}: No such file\n`,
          exitCode: 1,
        };
      }

      if (context.vfs.isDirectory(resolvedPath)) {
        return {
          stdout: "",
          stderr: `timewarp: ${filePath}: Is a directory\n`,
          exitCode: 1,
        };
      }

      const content = context.vfs.readSync(resolvedPath);
      const version = await saveVersion(namespace, resolvedPath, content, {
        message,
        author: "user",
      });

      return {
        stdout: `Saved version ${shortId(version.id)} of ${filePath}\n`,
        stderr: "",
        exitCode: 0,
      };
    }

    case "branches": {
      const filePath = args[1];

      if (!filePath) {
        return {
          stdout: "",
          stderr: "Usage: timewarp branches <file>\n",
          exitCode: 1,
        };
      }

      const resolvedPath = context.vfs.resolve(filePath);
      const branches = await listBranches(namespace, resolvedPath);

      if (Object.keys(branches).length === 0) {
        return {
          stdout: `No branches for ${filePath}\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      const output: string[] = [];
      output.push(`Branches for ${filePath}:`);
      for (const [name, versionId] of Object.entries(branches)) {
        output.push(`  ${name} -> ${shortId(versionId)}`);
      }

      return { stdout: output.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "branch": {
      const filePath = args[1];
      const branchName = args[2];

      if (!filePath || !branchName) {
        return {
          stdout: "",
          stderr: "Usage: timewarp branch <file> <name>\n",
          exitCode: 1,
        };
      }

      const resolvedPath = context.vfs.resolve(filePath);

      try {
        const version = await createBranch(namespace, resolvedPath, branchName);

        if (!version) {
          return {
            stdout: "",
            stderr: `timewarp: ${filePath} has no version history\n`,
            exitCode: 1,
          };
        }

        return {
          stdout: `Created branch '${branchName}' for ${filePath}\n`,
          stderr: "",
          exitCode: 0,
        };
      } catch (error) {
        return {
          stdout: "",
          stderr: `timewarp: ${(error as Error).message}\n`,
          exitCode: 1,
        };
      }
    }

    default:
      return {
        stdout: "",
        stderr: `timewarp: unknown subcommand '${subcommand}'\n`,
        exitCode: 1,
      };
  }
};
