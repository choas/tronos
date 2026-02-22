/**
 * @fileoverview File version history management for TronOS.
 *
 * This module provides versioning capabilities for files, allowing users
 * to revert to previous versions and create branches when editing.
 *
 * @module persistence/versions
 */

import { getDB } from "./db";
import type { FileVersion, FileVersionHistory } from "../types";

/**
 * Generate a UUID v4 for version IDs
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get the version history for a file
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @returns The version history or null if no history exists
 */
export async function getVersionHistory(
  namespace: string,
  filePath: string
): Promise<FileVersionHistory | null> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;
  const history = await db.get("fileVersionHistory", key);
  return history || null;
}

/**
 * Get all versions for a file
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @returns Array of all versions, sorted by timestamp (newest first)
 */
export async function getFileVersions(
  namespace: string,
  filePath: string
): Promise<FileVersion[]> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;
  const versions = await db.getAllFromIndex("fileVersions", "by-filePath", key);
  // Sort by timestamp, newest first
  return versions.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get a specific version by ID
 * @param versionId - The version ID
 * @returns The version or null if not found
 */
export async function getVersion(versionId: string): Promise<FileVersion | null> {
  const db = getDB();
  const version = await db.get("fileVersions", versionId);
  return version || null;
}

/**
 * Save a new version of a file
 * This should be called before overwriting a file to preserve its current state.
 *
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @param content - The file content to save
 * @param options - Optional version metadata
 * @returns The created version
 */
export async function saveVersion(
  namespace: string,
  filePath: string,
  content: string,
  options: {
    message?: string;
    author?: string;
    branchName?: string;
  } = {}
): Promise<FileVersion> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;

  // Get existing history to determine parent version
  let history = await db.get("fileVersionHistory", key);
  let parentId: string | null = null;
  let branchName = options.branchName || "main";

  if (history) {
    // Use current version as parent
    parentId = history.currentVersionId;
  }

  // Create the new version
  const version: FileVersion = {
    id: generateId(),
    filePath: key,
    content,
    timestamp: Date.now(),
    parentId,
    branchName,
    message: options.message,
    author: options.author,
  };

  // Save the version
  await db.put("fileVersions", version);

  // Update or create history
  if (history) {
    history.currentVersionId = version.id;
    history.branches[branchName] = version.id;
  } else {
    history = {
      filePath: key,
      currentVersionId: version.id,
      branches: { [branchName]: version.id },
    };
  }

  await db.put("fileVersionHistory", history);

  return version;
}

/**
 * Revert a file to a specific version.
 * This creates a new version that contains the content of the target version,
 * maintaining the version history.
 *
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @param targetVersionId - The version ID to revert to
 * @param options - Optional options for the revert
 * @returns The new version created by the revert, or null if target version not found
 */
export async function revertToVersion(
  namespace: string,
  filePath: string,
  targetVersionId: string,
  options: {
    createBranch?: string;  // If set, creates a new branch instead of continuing on current
  } = {}
): Promise<{ version: FileVersion; content: string } | null> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;

  // Get the target version
  const targetVersion = await db.get("fileVersions", targetVersionId);
  if (!targetVersion) {
    return null;
  }

  // Verify the version belongs to this file
  if (targetVersion.filePath !== key) {
    return null;
  }

  // Get existing history
  const history = await db.get("fileVersionHistory", key);
  if (!history) {
    return null;
  }

  // Determine branch name
  const branchName = options.createBranch || targetVersion.branchName;

  // Create a new version with the reverted content
  const newVersion: FileVersion = {
    id: generateId(),
    filePath: key,
    content: targetVersion.content,
    timestamp: Date.now(),
    parentId: history.currentVersionId,  // Link to current version as parent
    branchName,
    message: `Reverted to version from ${new Date(targetVersion.timestamp).toISOString()}`,
    author: "timewarp",
  };

  // Save the new version
  await db.put("fileVersions", newVersion);

  // Update history
  history.currentVersionId = newVersion.id;
  history.branches[branchName] = newVersion.id;
  await db.put("fileVersionHistory", history);

  return {
    version: newVersion,
    content: targetVersion.content,
  };
}

/**
 * List all branches for a file
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @returns Record of branch names to their latest version IDs
 */
export async function listBranches(
  namespace: string,
  filePath: string
): Promise<Record<string, string>> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;
  const history = await db.get("fileVersionHistory", key);
  return history?.branches || {};
}

/**
 * Switch to a different branch
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @param branchName - The branch to switch to
 * @returns The content of the branch's latest version, or null if branch not found
 */
export async function switchBranch(
  namespace: string,
  filePath: string,
  branchName: string
): Promise<{ version: FileVersion; content: string } | null> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;

  const history = await db.get("fileVersionHistory", key);
  if (!history || !history.branches[branchName]) {
    return null;
  }

  const versionId = history.branches[branchName];
  const version = await db.get("fileVersions", versionId);
  if (!version) {
    return null;
  }

  // Update current version to the branch's latest
  history.currentVersionId = versionId;
  await db.put("fileVersionHistory", history);

  return {
    version,
    content: version.content,
  };
}

/**
 * Create a new branch from the current version
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @param branchName - Name for the new branch
 * @returns The new branch's version, or null if file has no version history
 */
export async function createBranch(
  namespace: string,
  filePath: string,
  branchName: string
): Promise<FileVersion | null> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;

  const history = await db.get("fileVersionHistory", key);
  if (!history) {
    return null;
  }

  // Check if branch already exists
  if (history.branches[branchName]) {
    throw new Error(`Branch '${branchName}' already exists`);
  }

  // Get current version
  const currentVersion = await db.get("fileVersions", history.currentVersionId);
  if (!currentVersion) {
    return null;
  }

  // Create a new version on the new branch with the same content
  const newVersion: FileVersion = {
    id: generateId(),
    filePath: key,
    content: currentVersion.content,
    timestamp: Date.now(),
    parentId: currentVersion.id,
    branchName,
    message: `Created branch '${branchName}'`,
    author: "timewarp",
  };

  await db.put("fileVersions", newVersion);

  // Update history to include new branch
  history.branches[branchName] = newVersion.id;
  history.currentVersionId = newVersion.id;
  await db.put("fileVersionHistory", history);

  return newVersion;
}

/**
 * Delete all version history for a file
 * Called when a file is deleted from the VFS
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 */
export async function deleteVersionHistory(
  namespace: string,
  filePath: string
): Promise<void> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;

  // Get all versions for this file
  const versions = await db.getAllFromIndex("fileVersions", "by-filePath", key);

  // Delete all versions
  const tx = db.transaction(["fileVersions", "fileVersionHistory"], "readwrite");
  for (const version of versions) {
    await tx.objectStore("fileVersions").delete(version.id);
  }

  // Delete history
  await tx.objectStore("fileVersionHistory").delete(key);
  await tx.done;
}

/**
 * Check if a file has version history
 * @param namespace - The filesystem namespace (session ID)
 * @param filePath - The absolute path to the file
 * @returns true if the file has version history
 */
export async function hasVersionHistory(
  namespace: string,
  filePath: string
): Promise<boolean> {
  const db = getDB();
  const key = `${namespace}:${filePath}`;
  const history = await db.get("fileVersionHistory", key);
  return history !== undefined;
}
