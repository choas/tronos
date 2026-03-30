/**
 * @fileoverview Shared Context Bus state management.
 *
 * Manages the /proc/context/ subsystem:
 * - workspace: read/write JSON, current session context blob
 * - focus: read-only, auto-updated, describes what the user is doing
 * - history: read-only, append-only JSONL action log
 *
 * Data is persisted to IndexedDB under the key `tronos:context:{sessionId}`.
 *
 * @module context/state
 */

/**
 * Workspace data — free-form JSON, read/write by user and agents.
 */
export interface ContextWorkspace {
  description?: string;
  files?: string[];
  notes?: string;
  updated?: string;
  [key: string]: unknown;
}

/**
 * Focus data — auto-updated by the shell on each command.
 */
export interface ContextFocus {
  last_command: string;
  cwd: string;
  recent_files: string[];
  session: string;
  updated: string;
}

/**
 * History entry — one per shell command or @ai invocation.
 */
export interface ContextHistoryEntry {
  ts: string;
  type: "shell" | "ai" | "ai-pipeline-step";
  cmd?: string;
  prompt?: string;
  cwd: string;
  context_snapshot?: string;
}

/**
 * Full context state for a session.
 */
export interface ContextState {
  workspace: ContextWorkspace;
  focus: ContextFocus;
  history: ContextHistoryEntry[];
}

const MAX_HISTORY_ENTRIES = 500;
const MAX_RECENT_FILES = 10;

/**
 * Per-session context stores.
 */
const sessionContexts: Map<string, ContextState> = new Map();

/** The currently active session ID. */
let activeSessionId = "default";

/**
 * Get or create the context state for a session.
 */
function getSessionContext(sessionId: string): ContextState {
  let ctx = sessionContexts.get(sessionId);
  if (!ctx) {
    ctx = {
      workspace: { updated: new Date().toISOString() },
      focus: {
        last_command: "",
        cwd: "/home/tronos",
        recent_files: [],
        session: sessionId,
        updated: new Date().toISOString(),
      },
      history: [],
    };
    sessionContexts.set(sessionId, ctx);
  }
  return ctx;
}

/**
 * Set the active session ID.
 */
export function setActiveSession(sessionId: string): void {
  activeSessionId = sessionId;
}

/**
 * Get the current active session ID.
 */
export function getActiveSession(): string {
  return activeSessionId;
}

// ─── Workspace ──────────────────────────────────────────────────────────────

/**
 * Read the current workspace as JSON string.
 */
export function readWorkspace(sessionId: string): string {
  const ctx = getSessionContext(sessionId);
  return JSON.stringify(ctx.workspace, null, 2);
}

/**
 * Write to the workspace (full replace from JSON string).
 */
export function writeWorkspace(data: string, sessionId: string): void {
  const ctx = getSessionContext(sessionId);
  try {
    const parsed = JSON.parse(data);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      ctx.workspace = { ...parsed, updated: new Date().toISOString() };
    } else {
      // Primitive or array JSON — store as description
      ctx.workspace = {
        description: data.trim(),
        updated: new Date().toISOString(),
      };
    }
  } catch {
    // If not valid JSON, store as description
    ctx.workspace = {
      description: data.trim(),
      updated: new Date().toISOString(),
    };
  }
  persistContextAsync(sessionId);
}

// ─── Focus ──────────────────────────────────────────────────────────────────

/**
 * Read the current focus as JSON string.
 */
export function readFocus(sessionId: string): string {
  const ctx = getSessionContext(sessionId);
  return JSON.stringify(ctx.focus, null, 2);
}

/**
 * Update focus after a command execution.
 * Called from the shell engine post-execution hook.
 */
export function updateFocus(
  command: string,
  cwd: string,
  touchedFiles: string[] | undefined,
  sessionId: string,
): void {
  const ctx = getSessionContext(sessionId);
  ctx.focus.last_command = command;
  ctx.focus.cwd = cwd;
  ctx.focus.updated = new Date().toISOString();

  if (touchedFiles && touchedFiles.length > 0) {
    // Prepend new files, deduplicate, and keep the sliding window
    const combined = [...touchedFiles, ...ctx.focus.recent_files];
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const f of combined) {
      if (!seen.has(f)) {
        seen.add(f);
        deduped.push(f);
      }
      if (deduped.length >= MAX_RECENT_FILES) break;
    }
    ctx.focus.recent_files = deduped;
  }

  persistContextAsync(sessionId);
}

// ─── History ────────────────────────────────────────────────────────────────

/**
 * Read history as JSONL string.
 */
export function readHistory(sessionId: string): string {
  const ctx = getSessionContext(sessionId);
  return ctx.history.map((e) => JSON.stringify(e)).join("\n");
}

/**
 * Append a shell command to history.
 */
export function appendShellHistory(
  cmd: string,
  cwd: string,
  sessionId: string,
): void {
  const ctx = getSessionContext(sessionId);
  ctx.history.push({
    ts: new Date().toISOString(),
    type: "shell",
    cmd,
    cwd,
  });
  trimHistory(ctx);
  persistContextAsync(sessionId);
}

/**
 * Append an AI invocation to history.
 */
export function appendAIHistory(
  prompt: string,
  cwd: string,
  contextSnapshot: string | undefined,
  sessionId: string,
): void {
  const ctx = getSessionContext(sessionId);
  ctx.history.push({
    ts: new Date().toISOString(),
    type: "ai",
    prompt,
    cwd,
    context_snapshot: contextSnapshot,
  });
  trimHistory(ctx);
  persistContextAsync(sessionId);
}

/**
 * Trim history to MAX_HISTORY_ENTRIES.
 */
function trimHistory(ctx: ContextState): void {
  if (ctx.history.length > MAX_HISTORY_ENTRIES) {
    ctx.history = ctx.history.slice(ctx.history.length - MAX_HISTORY_ENTRIES);
  }
}

// ─── Full Context ───────────────────────────────────────────────────────────

/**
 * Get the full context state (for AI prompt building).
 */
export function getContextState(sessionId: string): ContextState {
  return getSessionContext(sessionId);
}

// ─── Persistence ────────────────────────────────────────────────────────────

const persistTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Schedule an async flush to IndexedDB (debounced 2s per session).
 */
function persistContextAsync(sessionId: string): void {
  const existing = persistTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    sessionId,
    setTimeout(() => {
      persistTimers.delete(sessionId);
      persistContextNow(sessionId).catch((err) => {
        console.warn("Failed to persist context:", err);
      });
    }, 2000),
  );
}

/**
 * Immediately persist context to IndexedDB.
 */
async function persistContextNow(sessionId: string): Promise<void> {
  const ctx = sessionContexts.get(sessionId);
  if (!ctx) return;

  try {
    if (typeof indexedDB !== "undefined") {
      const { getDB } = await import("../persistence/db");
      const db = getDB();
      const key = `tronos:context:${sessionId}`;
      await db.put(
        "config",
        {
          workspace: ctx.workspace,
          focus: ctx.focus,
          history: ctx.history,
        },
        key,
      );
    }
  } catch (err) {
    // Non-critical: context persistence failing shouldn't crash anything,
    // but log in development for debugging.
    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV === "development"
    ) {
      console.warn("Context persistence error:", err);
    }
  }
}

/**
 * Load persisted context from IndexedDB.
 */
export async function loadPersistedContext(sessionId: string): Promise<void> {
  try {
    if (typeof indexedDB !== "undefined") {
      const { getDB } = await import("../persistence/db");
      const db = getDB();
      const key = `tronos:context:${sessionId}`;
      const data = await db.get("config", key);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const persisted = data as Record<string, unknown>;
        const ctx = getSessionContext(sessionId);

        // Validate workspace: must be a plain object
        if (
          persisted.workspace &&
          typeof persisted.workspace === "object" &&
          !Array.isArray(persisted.workspace)
        ) {
          ctx.workspace = persisted.workspace as ContextWorkspace;
        }

        // Validate focus: must be an object with expected fields
        if (
          persisted.focus &&
          typeof persisted.focus === "object" &&
          !Array.isArray(persisted.focus)
        ) {
          const f = persisted.focus as Record<string, unknown>;
          ctx.focus = {
            last_command:
              typeof f.last_command === "string" ? f.last_command : "",
            cwd: typeof f.cwd === "string" ? f.cwd : "/home/tronos",
            recent_files: Array.isArray(f.recent_files)
              ? (
                  f.recent_files.filter(
                    (x: unknown) => typeof x === "string",
                  ) as string[]
                ).slice(0, MAX_RECENT_FILES)
              : [],
            session: sessionId,
            updated:
              typeof f.updated === "string"
                ? f.updated
                : new Date().toISOString(),
          };
        }

        // Validate history: must be an array
        if (Array.isArray(persisted.history)) {
          ctx.history = (persisted.history as unknown[]).filter(
            (e): e is ContextHistoryEntry =>
              e !== null &&
              typeof e === "object" &&
              typeof (e as Record<string, unknown>).ts === "string" &&
              typeof (e as Record<string, unknown>).cwd === "string" &&
              ["shell", "ai", "ai-pipeline-step"].includes(
                (e as Record<string, unknown>).type as string,
              ),
          );
          trimHistory(ctx);
        }
      }
    }
  } catch (err) {
    // Non-critical: context loading failing shouldn't crash anything,
    // but log in development for debugging.
    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV === "development"
    ) {
      console.warn("Context load error:", err);
    }
  }
}

/**
 * Extract file paths from a command string for recent_files tracking.
 * Detects arguments that look like file paths.
 */
export function extractFilesFromCommand(cmd: string, cwd: string): string[] {
  const files: string[] = [];
  // Split by whitespace, skip the command itself
  const parts = cmd.trim().split(/\s+/);
  if (parts.length <= 1) return files;

  for (let i = 1; i < parts.length; i++) {
    const arg = parts[i];
    // Skip flags
    if (arg.startsWith("-")) continue;
    // Stop on pipe — piped commands are separate contexts
    if (arg === "|") break;
    // Chain operators — skip and keep scanning
    if (arg === "&&" || arg === "||") continue;
    // Redirection operators — grab the next token as a file path
    if (arg === ">" || arg === ">>" || arg === "<") {
      if (i + 1 < parts.length) {
        const target = parts[++i];
        if (!target.startsWith("-")) {
          const resolved = target.startsWith("/")
            ? target
            : target.startsWith("~")
              ? target.replace("~", "/home/tronos")
              : cwd === "/"
                ? "/" + target
                : cwd + "/" + target;
          files.push(resolved);
        }
      }
      continue;
    }
    // Looks like a path if it contains / or . or ends with common extensions
    if (arg.includes("/") || arg.includes(".") || arg.startsWith("~")) {
      const resolved = arg.startsWith("/")
        ? arg
        : arg.startsWith("~")
          ? arg.replace("~", "/home/tronos")
          : cwd === "/"
            ? "/" + arg
            : cwd + "/" + arg;
      files.push(resolved);
    }
  }
  return files;
}
