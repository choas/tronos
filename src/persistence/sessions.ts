import { getDB } from "./db";
import type { Session } from "../types";

/**
 * Convert a session object (possibly a Solid.js Proxy) to a plain JavaScript object.
 * This is necessary because IndexedDB cannot clone Proxy objects and will throw
 * a DataCloneError. This function creates a deep copy with all nested objects
 * and arrays converted to plain JavaScript equivalents.
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
    aliases: { ...session.aliases }
  };
}

/**
 * Load all sessions from IndexedDB
 */
export async function loadSessions(): Promise<Record<string, Session>> {
  try {
    const db = getDB();
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

/**
 * Save a single session to IndexedDB.
 * The session is converted to a plain object to avoid DataCloneError
 * when the session comes from a Solid.js reactive store (Proxy object).
 */
export async function saveSession(session: Session): Promise<void> {
  try {
    const db = getDB();
    await db.put("sessions", toPlainSession(session));
  } catch (error) {
    console.error("Failed to save session:", error);
  }
}

/**
 * Delete a session from IndexedDB
 */
export async function deleteSessionFromDB(id: string): Promise<void> {
  try {
    const db = getDB();
    await db.delete("sessions", id);
  } catch (error) {
    console.error("Failed to delete session:", error);
  }
}

/**
 * Save all sessions to IndexedDB.
 * Each session is converted to a plain object to avoid DataCloneError
 * when sessions come from a Solid.js reactive store (Proxy objects).
 */
export async function syncSessions(sessions: Record<string, Session>): Promise<void> {
  try {
    const db = getDB();
    const tx = db.transaction("sessions", "readwrite");

    // Clear existing sessions and save new ones
    await tx.store.clear();

    for (const session of Object.values(sessions)) {
      await tx.store.put(toPlainSession(session));
    }

    await tx.done;
  } catch (error) {
    console.error("Failed to sync sessions:", error);
  }
}
