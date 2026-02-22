import { createStore } from "solid-js/store";
import type { Session, ConversationMessage } from "../types";
import { getStorage } from "../persistence/storage";

/** Maximum number of conversation exchanges to keep in history */
const MAX_CONVERSATION_HISTORY = 10;

interface SessionState {
  active: string;                      // Active session ID
  sessions: Record<string, Session>;   // All sessions by ID
}

export const [sessionState, setSessionState] = createStore<SessionState>({
  active: "default",
  sessions: {
    default: {
      id: "default",
      name: "default",
      created: Date.now(),
      lastAccess: Date.now(),
      fsNamespace: "tronos_fs_default",
      env: { HOME: "/home/tronos", PATH: "/bin", USER: "tronos" },
      history: [],
      aliases: { ll: "ls -la" },
      conversationHistory: []
    }
  }
});

export function getActiveSession(): Session {
  return sessionState.sessions[sessionState.active];
}

/**
 * Initialize sessions from IndexedDB on app startup
 */
export async function initSessions(): Promise<void> {
  try {
    const loadedSessions = await getStorage().loadSessions();

    // If we have stored sessions, load them
    if (Object.keys(loadedSessions).length > 0) {
      // Ensure default session exists
      if (!loadedSessions.default) {
        loadedSessions.default = {
          id: "default",
          name: "default",
          created: Date.now(),
          lastAccess: Date.now(),
          fsNamespace: "tronos_fs_default",
          env: { HOME: "/home/tronos", PATH: "/bin", USER: "tronos" },
          history: [],
          aliases: { ll: "ls -la" },
          conversationHistory: []
        };
      }

      // Ensure all loaded sessions have conversationHistory initialized
      for (const id of Object.keys(loadedSessions)) {
        if (loadedSessions[id] && !loadedSessions[id].conversationHistory) {
          loadedSessions[id].conversationHistory = [];
        }
      }

      setSessionState("sessions", loadedSessions);

      // Set active session (use default if previous active doesn't exist)
      if (loadedSessions[sessionState.active]) {
        setSessionState("active", sessionState.active);
      } else {
        setSessionState("active", "default");
      }
    } else {
      // No stored sessions, persist the default session
      await getStorage().saveSession(sessionState.sessions.default);
    }
  } catch (error) {
    console.error("Failed to initialize sessions:", error);
  }
}

export function createSession(name: string): Session {
  const id = crypto.randomUUID();
  const session: Session = {
    id,
    name,
    created: Date.now(),
    lastAccess: Date.now(),
    fsNamespace: `tronos_fs_${id}`,
    env: { HOME: "/home/tronos", PATH: "/bin", USER: "tronos" },
    history: [],
    aliases: { ll: "ls -la" },
    conversationHistory: []
  };

  setSessionState("sessions", id, session);

  // Persist to IndexedDB (fire-and-forget)
  getStorage().saveSession(session).catch(err => console.error("Failed to persist session:", err));

  return session;
}

export function switchSession(id: string): void {
  if (!sessionState.sessions[id]) {
    throw new Error(`Session ${id} not found`);
  }
  setSessionState("active", id);
  setSessionState("sessions", id, "lastAccess", Date.now());

  // Persist updated session (fire-and-forget)
  const session = sessionState.sessions[id];
  getStorage().saveSession(session).catch(err => console.error("Failed to persist session:", err));
}

export function deleteSession(id: string): void {
  if (id === "default") {
    throw new Error("Cannot delete default session");
  }
  if (sessionState.active === id) {
    switchSession("default");
  }

  // Remove from store
  setSessionState("sessions", { ...sessionState.sessions, [id]: undefined });

  // Delete from IndexedDB (fire-and-forget)
  getStorage().deleteSession(id).catch(err => console.error("Failed to delete session from DB:", err));
}

/**
 * Update a session and persist changes to IndexedDB
 */
export function updateSession(id: string, updates: Partial<Omit<Session, "id">>): void {
  if (!sessionState.sessions[id]) {
    throw new Error(`Session ${id} not found`);
  }

  // Update store
  setSessionState("sessions", id, updates);

  // Persist to IndexedDB (fire-and-forget)
  const session = sessionState.sessions[id];
  getStorage().saveSession(session).catch(err => console.error("Failed to persist session:", err));
}

/**
 * Add a message to the active session's conversation history
 * Limits history to MAX_CONVERSATION_HISTORY exchanges (user+assistant pairs)
 */
export function addConversationMessage(
  message: ConversationMessage
): void {
  const activeId = sessionState.active;
  const session = sessionState.sessions[activeId];
  if (!session) return;

  const history = session.conversationHistory || [];
  const newHistory = [...history, message];

  // Limit to MAX_CONVERSATION_HISTORY exchanges (pairs of user + assistant messages)
  // Each exchange = 2 messages, so max messages = MAX_CONVERSATION_HISTORY * 2
  const maxMessages = MAX_CONVERSATION_HISTORY * 2;
  const trimmedHistory = newHistory.length > maxMessages
    ? newHistory.slice(-maxMessages)
    : newHistory;

  setSessionState("sessions", activeId, "conversationHistory", trimmedHistory);

  // Persist to IndexedDB (fire-and-forget)
  const updatedSession = sessionState.sessions[activeId];
  getStorage().saveSession(updatedSession).catch(err => console.error("Failed to persist conversation:", err));
}

/**
 * Get the conversation history for the active session
 * Returns the last N exchanges (up to MAX_CONVERSATION_HISTORY)
 */
export function getConversationHistory(): ConversationMessage[] {
  const session = sessionState.sessions[sessionState.active];
  return session?.conversationHistory || [];
}

/**
 * Clear the conversation history for the active session
 */
export function clearConversationHistory(): void {
  const activeId = sessionState.active;
  const session = sessionState.sessions[activeId];
  if (!session) return;

  setSessionState("sessions", activeId, "conversationHistory", []);

  // Persist to IndexedDB (fire-and-forget)
  const updatedSession = sessionState.sessions[activeId];
  getStorage().saveSession(updatedSession).catch(err => console.error("Failed to persist cleared conversation:", err));
}
