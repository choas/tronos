/**
 * @fileoverview Import history management for TronOS.
 *
 * This module provides tracking of disk image import operations,
 * enabling undo functionality and import history viewing.
 *
 * @module persistence/import-history
 */

import { getDB } from "./db";
import type { ImportHistoryEntry } from "../types";

/**
 * Generate a UUID v4 for import IDs
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Save an import history entry
 * @param entry - The import entry to save (id will be generated if not provided)
 * @returns The saved entry with its ID
 */
export async function saveImportEntry(
  entry: Omit<ImportHistoryEntry, "id"> & { id?: string }
): Promise<ImportHistoryEntry> {
  const db = getDB();
  const fullEntry: ImportHistoryEntry = {
    ...entry,
    id: entry.id || generateId(),
  };
  await db.put("importHistory", fullEntry);
  return fullEntry;
}

/**
 * Get all import history entries for a session
 * @param sessionId - The session ID to get history for
 * @returns Array of import entries sorted by timestamp (newest first)
 */
export async function getSessionImportHistory(
  sessionId: string
): Promise<ImportHistoryEntry[]> {
  const db = getDB();
  const entries = await db.getAllFromIndex("importHistory", "by-sessionId", sessionId);
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get a specific import entry by ID
 * @param importId - The import entry ID
 * @returns The import entry or null if not found
 */
export async function getImportEntry(
  importId: string
): Promise<ImportHistoryEntry | null> {
  const db = getDB();
  const entry = await db.get("importHistory", importId);
  return entry || null;
}

/**
 * Get the most recent import entry for a session
 * @param sessionId - The session ID
 * @returns The most recent import entry or null if no imports
 */
export async function getLatestImportEntry(
  sessionId: string
): Promise<ImportHistoryEntry | null> {
  const entries = await getSessionImportHistory(sessionId);
  return entries[0] || null;
}

/**
 * Delete an import history entry
 * @param importId - The import entry ID to delete
 */
export async function deleteImportEntry(importId: string): Promise<void> {
  const db = getDB();
  await db.delete("importHistory", importId);
}

/**
 * Delete all import history entries for a session
 * @param sessionId - The session ID
 */
export async function clearSessionImportHistory(sessionId: string): Promise<void> {
  const db = getDB();
  const entries = await db.getAllFromIndex("importHistory", "by-sessionId", sessionId);
  const tx = db.transaction("importHistory", "readwrite");
  for (const entry of entries) {
    await tx.store.delete(entry.id);
  }
  await tx.done;
}

/**
 * Get all import history entries across all sessions
 * @returns Array of all import entries sorted by timestamp (newest first)
 */
export async function getAllImportHistory(): Promise<ImportHistoryEntry[]> {
  const db = getDB();
  const entries = await db.getAll("importHistory");
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}
