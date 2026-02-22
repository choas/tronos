/**
 * @fileoverview Session snapshot management for TronOS.
 *
 * This module provides snapshot (checkpoint) functionality for sessions,
 * allowing users to save and restore named session states.
 *
 * Snapshots are stored:
 * 1. In IndexedDB for persistence
 * 2. In /var/snapshots/ directory for visibility
 *
 * @module persistence/snapshots
 */

import { getDB } from "./db";
import type { SessionSnapshot, DiskImage } from "../types";

/** Default maximum number of snapshots per session */
export const DEFAULT_MAX_SNAPSHOTS = 10;

/**
 * Generate a UUID v4 for snapshot IDs
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Save a snapshot to the database
 * @param snapshot - The snapshot to save (id will be generated if not provided)
 * @returns The saved snapshot with its ID
 */
export async function saveSnapshot(
  snapshot: Omit<SessionSnapshot, "id"> & { id?: string }
): Promise<SessionSnapshot> {
  const db = getDB();
  const fullSnapshot: SessionSnapshot = {
    ...snapshot,
    id: snapshot.id || generateId(),
  };
  await db.put("snapshots", fullSnapshot);
  return fullSnapshot;
}

/**
 * Get all snapshots for a session
 * @param sessionId - The session ID to get snapshots for
 * @returns Array of snapshots sorted by timestamp (newest first)
 */
export async function getSessionSnapshots(
  sessionId: string
): Promise<SessionSnapshot[]> {
  const db = getDB();
  const snapshots = await db.getAllFromIndex("snapshots", "by-sessionId", sessionId);
  return snapshots.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get a specific snapshot by ID
 * @param snapshotId - The snapshot ID
 * @returns The snapshot or null if not found
 */
export async function getSnapshot(
  snapshotId: string
): Promise<SessionSnapshot | null> {
  const db = getDB();
  const snapshot = await db.get("snapshots", snapshotId);
  return snapshot || null;
}

/**
 * Get a snapshot by name for a specific session
 * @param sessionId - The session ID
 * @param name - The snapshot name
 * @returns The snapshot or null if not found
 */
export async function getSnapshotByName(
  sessionId: string,
  name: string
): Promise<SessionSnapshot | null> {
  const snapshots = await getSessionSnapshots(sessionId);
  return snapshots.find(s => s.name === name) || null;
}

/**
 * Delete a snapshot by ID
 * @param snapshotId - The snapshot ID to delete
 */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const db = getDB();
  await db.delete("snapshots", snapshotId);
}

/**
 * Delete all snapshots for a session
 * @param sessionId - The session ID
 */
export async function clearSessionSnapshots(sessionId: string): Promise<void> {
  const db = getDB();
  const snapshots = await db.getAllFromIndex("snapshots", "by-sessionId", sessionId);
  const tx = db.transaction("snapshots", "readwrite");
  for (const snapshot of snapshots) {
    await tx.store.delete(snapshot.id);
  }
  await tx.done;
}

/**
 * Count snapshots for a session
 * @param sessionId - The session ID
 * @returns Number of snapshots
 */
export async function countSessionSnapshots(sessionId: string): Promise<number> {
  const db = getDB();
  const snapshots = await db.getAllFromIndex("snapshots", "by-sessionId", sessionId);
  return snapshots.length;
}

/**
 * Enforce snapshot limit by deleting oldest snapshots
 * @param sessionId - The session ID
 * @param maxSnapshots - Maximum number of snapshots to keep (default: 10)
 * @returns Number of snapshots deleted
 */
export async function enforceSnapshotLimit(
  sessionId: string,
  maxSnapshots: number = DEFAULT_MAX_SNAPSHOTS
): Promise<number> {
  const snapshots = await getSessionSnapshots(sessionId);

  // Separate auto and manual snapshots
  const autoSnapshots = snapshots.filter(s => s.isAuto);
  const manualSnapshots = snapshots.filter(s => !s.isAuto);

  // Keep up to maxSnapshots total, prioritizing manual over auto
  const toKeep = new Set<string>();

  // Add all manual snapshots first (up to limit)
  for (const s of manualSnapshots.slice(0, maxSnapshots)) {
    toKeep.add(s.id);
  }

  // Fill remaining slots with auto snapshots
  const remaining = maxSnapshots - toKeep.size;
  for (const s of autoSnapshots.slice(0, remaining)) {
    toKeep.add(s.id);
  }

  // Delete any snapshots not in toKeep
  let deleted = 0;
  for (const snapshot of snapshots) {
    if (!toKeep.has(snapshot.id)) {
      await deleteSnapshot(snapshot.id);
      deleted++;
    }
  }

  return deleted;
}

/**
 * Get the most recent snapshot for a session
 * @param sessionId - The session ID
 * @returns The most recent snapshot or null if none exist
 */
export async function getLatestSnapshot(
  sessionId: string
): Promise<SessionSnapshot | null> {
  const snapshots = await getSessionSnapshots(sessionId);
  return snapshots[0] || null;
}

/**
 * Get all snapshots across all sessions
 * @returns Array of all snapshots sorted by timestamp (newest first)
 */
export async function getAllSnapshots(): Promise<SessionSnapshot[]> {
  const db = getDB();
  const snapshots = await db.getAll("snapshots");
  return snapshots.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Create a snapshot from a DiskImage
 * This is a helper function that constructs a SessionSnapshot from session data
 * @param sessionId - The session ID
 * @param name - Snapshot name
 * @param diskImage - The disk image containing session state
 * @param options - Optional parameters
 * @returns The created snapshot
 */
export async function createSnapshot(
  sessionId: string,
  name: string,
  diskImage: DiskImage,
  options: {
    description?: string;
    isAuto?: boolean;
  } = {}
): Promise<SessionSnapshot> {
  const snapshot: Omit<SessionSnapshot, "id"> = {
    sessionId,
    name,
    timestamp: Date.now(),
    description: options.description,
    isAuto: options.isAuto ?? false,
    diskImage,
  };

  return await saveSnapshot(snapshot);
}
