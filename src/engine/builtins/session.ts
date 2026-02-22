import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import type { DiskImage, DiskFile, ImportHistoryEntry, SessionSnapshot } from "../../types";
import { InMemoryVFS } from "../../vfs/memory";
import { sessionState, createSession, switchSession, deleteSession, updateSession, getActiveSession } from "../../stores";
import { saveVersion, revertToVersion } from "../../persistence/versions";
import { saveImportEntry, getSessionImportHistory, getLatestImportEntry } from "../../persistence/import-history";
import {
  createSnapshot,
  getSessionSnapshots,
  getSnapshotByName,
  enforceSnapshotLimit,
  DEFAULT_MAX_SNAPSHOTS,
} from "../../persistence/snapshots";
import yaml from "js-yaml";

/**
 * Conflict resolution strategy for merge operations
 */
export type ConflictStrategy = 'overwrite' | 'skip' | 'interactive';

/**
 * Result of a merge operation
 */
export interface MergeResult {
  success: boolean;
  merged: string[];       // Files that were successfully merged (new or overwritten)
  skipped: string[];      // Files that were skipped due to conflicts
  overwritten: string[];  // Files that were overwritten (subset of merged when overwrite strategy)
  errors: string[];       // Any errors that occurred
  envMerged: string[];    // Environment variables that were merged
  envSkipped: string[];   // Environment variables that were skipped
  aliasesMerged: string[];  // Aliases that were merged
  aliasesSkipped: string[]; // Aliases that were skipped
  versionIds: Record<string, string>;  // filePath -> versionId of pre-merge snapshot
}

/**
 * Information about a conflict during merge
 */
export interface MergeConflict {
  path: string;
  type: 'file' | 'env' | 'alias';
  currentValue?: string;
  incomingValue?: string;
}

/**
 * Validate a DiskImage structure
 */
export function isValidDiskImage(obj: unknown): obj is DiskImage {
  if (typeof obj !== "object" || obj === null) return false;
  const img = obj as Record<string, unknown>;

  // Check required top-level fields
  if (img.version !== 1) return false;
  if (typeof img.name !== "string") return false;
  if (typeof img.created !== "string") return false;
  if (typeof img.exported !== "string") return false;

  // Check session object
  if (typeof img.session !== "object" || img.session === null) return false;
  const session = img.session as Record<string, unknown>;
  if (typeof session.env !== "object" || session.env === null) return false;
  if (typeof session.aliases !== "object" || session.aliases === null) return false;
  if (!Array.isArray(session.history)) return false;

  // Check files object
  if (typeof img.files !== "object" || img.files === null) return false;

  return true;
}

/**
 * Import a session from a DiskImage
 * Returns the new session name or throws an error
 */
export async function importSession(diskImage: DiskImage): Promise<string> {
  // Generate a unique name for the imported session
  let importName = diskImage.name;
  let counter = 1;

  // Check if name already exists and generate a unique one
  while (Object.values(sessionState.sessions).some(s => s.name === importName)) {
    importName = `${diskImage.name}-${counter}`;
    counter++;
  }

  // Create a new session with the imported name
  const newSession = createSession(importName);

  // Update session with imported env, aliases, and history
  updateSession(newSession.id, {
    env: { ...diskImage.session.env },
    aliases: { ...diskImage.session.aliases },
    history: [...diskImage.session.history]
  });

  // Create a new VFS for this session's namespace
  const vfs = new InMemoryVFS(newSession.fsNamespace);

  // Initialize the VFS (creates default structure)
  await vfs.init();

  // Sort paths by depth to ensure parent directories are created first
  const sortedPaths = Object.keys(diskImage.files).sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    return depthA - depthB;
  });

  // Restore files and directories
  for (const filePath of sortedPaths) {
    const diskFile = diskImage.files[filePath];

    try {
      if (diskFile.type === "directory") {
        // Check if directory already exists (from default FS or parent creation)
        if (!vfs.exists(filePath)) {
          vfs.mkdir(filePath, true);
        }
      } else if (diskFile.type === "file" && diskFile.content !== undefined) {
        // Create parent directories if they don't exist
        const parentDir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
        if (parentDir !== "/" && !vfs.exists(parentDir)) {
          vfs.mkdir(parentDir, true);
        }
        // Write file content
        await vfs.write(filePath, diskFile.content);
      }
    } catch (error) {
      // Log but continue - don't fail entire import for one file
      console.warn(`Failed to restore ${filePath}:`, error);
    }
  }

  // Sync to ensure all changes are persisted
  await vfs.sync();

  return importName;
}

/**
 * Detect conflicts between a disk image and the current session's VFS
 * Returns a list of file paths that exist in both places with different content
 */
export function detectMergeConflicts(
  diskImage: DiskImage,
  vfs: InMemoryVFS,
  currentEnv: Record<string, string>,
  currentAliases: Record<string, string>
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];

  // Check file conflicts
  for (const [filePath, diskFile] of Object.entries(diskImage.files)) {
    if (diskFile.type === 'file' && vfs.exists(filePath)) {
      try {
        const currentContent = vfs.readSync(filePath);
        if (currentContent !== diskFile.content) {
          conflicts.push({
            path: filePath,
            type: 'file',
            currentValue: currentContent.length > 100 ? currentContent.substring(0, 100) + '...' : currentContent,
            incomingValue: diskFile.content && diskFile.content.length > 100
              ? diskFile.content.substring(0, 100) + '...'
              : diskFile.content
          });
        }
      } catch {
        // File doesn't exist or can't be read, no conflict
      }
    }
  }

  // Check environment variable conflicts
  for (const [key, value] of Object.entries(diskImage.session.env)) {
    if (key in currentEnv && currentEnv[key] !== value) {
      conflicts.push({
        path: key,
        type: 'env',
        currentValue: currentEnv[key],
        incomingValue: value
      });
    }
  }

  // Check alias conflicts
  for (const [name, command] of Object.entries(diskImage.session.aliases)) {
    if (name in currentAliases && currentAliases[name] !== command) {
      conflicts.push({
        path: name,
        type: 'alias',
        currentValue: currentAliases[name],
        incomingValue: command
      });
    }
  }

  return conflicts;
}

/**
 * Merge a disk image into the current session
 * Uses the specified conflict resolution strategy
 */
export async function mergeSession(
  diskImage: DiskImage,
  vfs: InMemoryVFS,
  strategy: ConflictStrategy,
  interactiveResolver?: (conflict: MergeConflict) => Promise<'overwrite' | 'skip'>
): Promise<MergeResult> {
  // Create auto-snapshot before merge (destructive operation)
  try {
    await createAutoSnapshot(vfs, `merge from '${diskImage.name}'`);
  } catch {
    // Auto-snapshot failure should not prevent the merge
    console.warn("Failed to create auto-snapshot before merge");
  }

  const result: MergeResult = {
    success: true,
    merged: [],
    skipped: [],
    overwritten: [],
    errors: [],
    envMerged: [],
    envSkipped: [],
    aliasesMerged: [],
    aliasesSkipped: [],
    versionIds: {}
  };

  const activeSession = getActiveSession();
  const namespace = activeSession.fsNamespace;

  // Sort paths by depth to ensure parent directories are created first
  const sortedPaths = Object.keys(diskImage.files).sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    return depthA - depthB;
  });

  // Merge files
  for (const filePath of sortedPaths) {
    const diskFile = diskImage.files[filePath];

    try {
      if (diskFile.type === "directory") {
        // Create directory if it doesn't exist
        if (!vfs.exists(filePath)) {
          vfs.mkdir(filePath, true);
          result.merged.push(filePath);
        }
      } else if (diskFile.type === "file" && diskFile.content !== undefined) {
        // Check if file exists
        const exists = vfs.exists(filePath);
        let shouldWrite = true;
        let isOverwrite = false;

        if (exists) {
          // Check for conflict
          try {
            const currentContent = vfs.readSync(filePath);
            if (currentContent !== diskFile.content) {
              // Conflict detected
              if (strategy === 'skip') {
                shouldWrite = false;
                result.skipped.push(filePath);
              } else if (strategy === 'overwrite') {
                isOverwrite = true;
              } else if (strategy === 'interactive' && interactiveResolver) {
                const decision = await interactiveResolver({
                  path: filePath,
                  type: 'file',
                  currentValue: currentContent,
                  incomingValue: diskFile.content
                });
                if (decision === 'skip') {
                  shouldWrite = false;
                  result.skipped.push(filePath);
                } else {
                  isOverwrite = true;
                }
              } else {
                // Default to skip if no interactive resolver
                shouldWrite = false;
                result.skipped.push(filePath);
              }
            } else {
              // Same content, no conflict
              shouldWrite = false;
            }
          } catch {
            // Can't read, treat as new file
          }
        }

        if (shouldWrite) {
          // Create parent directories if they don't exist
          const parentDir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
          if (parentDir !== "/" && !vfs.exists(parentDir)) {
            vfs.mkdir(parentDir, true);
          }

          // Save version snapshot before overwriting (for undo support)
          if (isOverwrite) {
            try {
              const currentContent = vfs.readSync(filePath);
              const version = await saveVersion(namespace, filePath, currentContent, {
                message: `Pre-import snapshot from ${diskImage.name}`,
                author: "disk-import"
              });
              result.versionIds[filePath] = version.id;
            } catch {
              // Could not save version, continue with merge anyway
            }
          }

          await vfs.write(filePath, diskFile.content);
          result.merged.push(filePath);
          if (isOverwrite) {
            result.overwritten.push(filePath);
          }
        }
      }
    } catch (error) {
      result.errors.push(`${filePath}: ${(error as Error).message}`);
    }
  }

  // Merge environment variables
  const envUpdates: Record<string, string> = {};
  for (const [key, value] of Object.entries(diskImage.session.env)) {
    const exists = key in activeSession.env;
    const hasConflict = exists && activeSession.env[key] !== value;

    if (!exists) {
      // New variable, always add
      envUpdates[key] = value;
      result.envMerged.push(key);
    } else if (hasConflict) {
      if (strategy === 'skip') {
        result.envSkipped.push(key);
      } else if (strategy === 'overwrite') {
        envUpdates[key] = value;
        result.envMerged.push(key);
      } else if (strategy === 'interactive' && interactiveResolver) {
        const decision = await interactiveResolver({
          path: key,
          type: 'env',
          currentValue: activeSession.env[key],
          incomingValue: value
        });
        if (decision === 'overwrite') {
          envUpdates[key] = value;
          result.envMerged.push(key);
        } else {
          result.envSkipped.push(key);
        }
      } else {
        result.envSkipped.push(key);
      }
    }
    // If exists with same value, do nothing (already have it)
  }

  // Merge aliases
  const aliasUpdates: Record<string, string> = {};
  for (const [name, command] of Object.entries(diskImage.session.aliases)) {
    const exists = name in activeSession.aliases;
    const hasConflict = exists && activeSession.aliases[name] !== command;

    if (!exists) {
      // New alias, always add
      aliasUpdates[name] = command;
      result.aliasesMerged.push(name);
    } else if (hasConflict) {
      if (strategy === 'skip') {
        result.aliasesSkipped.push(name);
      } else if (strategy === 'overwrite') {
        aliasUpdates[name] = command;
        result.aliasesMerged.push(name);
      } else if (strategy === 'interactive' && interactiveResolver) {
        const decision = await interactiveResolver({
          path: name,
          type: 'alias',
          currentValue: activeSession.aliases[name],
          incomingValue: command
        });
        if (decision === 'overwrite') {
          aliasUpdates[name] = command;
          result.aliasesMerged.push(name);
        } else {
          result.aliasesSkipped.push(name);
        }
      } else {
        result.aliasesSkipped.push(name);
      }
    }
    // If exists with same value, do nothing (already have it)
  }

  // Apply env and alias updates to session
  if (Object.keys(envUpdates).length > 0 || Object.keys(aliasUpdates).length > 0) {
    const updates: { env?: Record<string, string>; aliases?: Record<string, string> } = {};
    if (Object.keys(envUpdates).length > 0) {
      updates.env = { ...activeSession.env, ...envUpdates };
    }
    if (Object.keys(aliasUpdates).length > 0) {
      updates.aliases = { ...activeSession.aliases, ...aliasUpdates };
    }
    updateSession(activeSession.id, updates);
  }

  // Sync VFS to ensure all changes are persisted
  await vfs.sync();

  return result;
}

/**
 * Format merge result as a human-readable summary
 */
export function formatMergeResult(result: MergeResult): string {
  const lines: string[] = [];

  // Files summary
  const newFiles = result.merged.filter(f => !result.overwritten.includes(f));
  if (newFiles.length > 0) {
    lines.push(`Files added: ${newFiles.length}`);
  }
  if (result.overwritten.length > 0) {
    lines.push(`Files overwritten: ${result.overwritten.length}`);
  }
  if (result.skipped.length > 0) {
    lines.push(`Files skipped (conflicts): ${result.skipped.length}`);
  }

  // Env summary
  if (result.envMerged.length > 0) {
    lines.push(`Environment variables merged: ${result.envMerged.length}`);
  }
  if (result.envSkipped.length > 0) {
    lines.push(`Environment variables skipped: ${result.envSkipped.length}`);
  }

  // Aliases summary
  if (result.aliasesMerged.length > 0) {
    lines.push(`Aliases merged: ${result.aliasesMerged.length}`);
  }
  if (result.aliasesSkipped.length > 0) {
    lines.push(`Aliases skipped: ${result.aliasesSkipped.length}`);
  }

  // Errors
  if (result.errors.length > 0) {
    lines.push(`\nErrors (${result.errors.length}):`);
    for (const err of result.errors.slice(0, 5)) {
      lines.push(`  - ${err}`);
    }
    if (result.errors.length > 5) {
      lines.push(`  ... and ${result.errors.length - 5} more`);
    }
  }

  if (lines.length === 0) {
    return "No changes made (disk image matches current session)";
  }

  return lines.join("\n");
}

/**
 * Detect if content is YAML (starts with common YAML patterns) or JSON
 */
export function isYamlContent(content: string): boolean {
  const trimmed = content.trimStart();
  // YAML typically starts with a key: value, --- document marker, or # comment
  // JSON always starts with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }
  // Check for YAML indicators
  if (trimmed.startsWith('---') ||
      trimmed.startsWith('#') ||
      /^[a-zA-Z_][a-zA-Z0-9_]*:\s/.test(trimmed)) {
    return true;
  }
  // Default to JSON for backward compatibility
  return false;
}

/**
 * Parse and validate a disk image from JSON or YAML string
 * Automatically detects format based on content
 */
export function parseDiskImage(content: string): DiskImage {
  let parsed: unknown;

  if (isYamlContent(content)) {
    try {
      parsed = yaml.load(content);
    } catch (e) {
      throw new Error(`Invalid YAML format: ${(e as Error).message}`);
    }
  } else {
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Invalid JSON format");
    }
  }

  if (!isValidDiskImage(parsed)) {
    throw new Error("Invalid disk image format");
  }

  return parsed;
}

/**
 * Serialize a DiskImage to YAML format
 * Uses literal block scalars (|) for multi-line file content
 */
export function serializeDiskImageToYaml(diskImage: DiskImage): string {
  return yaml.dump(diskImage, {
    lineWidth: -1,  // Disable line wrapping
    noRefs: true,   // Don't use YAML anchors/aliases
    quotingType: '"',
    forceQuotes: false,
    styles: {
      '!!str': 'literal'  // Use literal block scalars for strings
    }
  });
}

/**
 * Capture current session state as a DiskImage
 * This is used by both export and snapshot commands
 */
export async function captureSessionState(
  vfs: InMemoryVFS,
  sessionName: string,
  sessionCreated: number,
  env: Record<string, string>,
  aliases: Record<string, string>,
  history: string[]
): Promise<DiskImage> {
  // Collect all files recursively, excluding /proc and /dev
  const files: Record<string, DiskFile> = {};

  async function collectFiles(dirPath: string): Promise<void> {
    // Skip /proc and /dev directories
    if (dirPath.startsWith("/proc") || dirPath.startsWith("/dev")) {
      return;
    }

    const entries = vfs.listDetailed(dirPath);
    for (const entry of entries) {
      const fullPath = dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;

      // Skip /proc and /dev at top level
      if (fullPath === "/proc" || fullPath === "/dev") {
        continue;
      }

      const diskFile: DiskFile = {
        type: entry.type,
        meta: {
          created: new Date(entry.meta.createdAt).toISOString(),
          modified: new Date(entry.meta.updatedAt).toISOString(),
          permissions: "rw-r--r--"
        }
      };

      if (entry.type === "file") {
        // Read file content
        const content = await vfs.read(fullPath);
        diskFile.content = content;
      }

      files[fullPath] = diskFile;

      // Recursively collect from subdirectories
      if (entry.type === "directory") {
        await collectFiles(fullPath);
      }
    }
  }

  // Start collecting from root
  await collectFiles("/");

  // Create the DiskImage structure
  return {
    version: 1,
    name: sessionName,
    created: new Date(sessionCreated).toISOString(),
    exported: new Date().toISOString(),
    session: {
      env: { ...env },
      aliases: { ...aliases },
      history: [...history]
    },
    files
  };
}

/**
 * Create an automatic snapshot before a destructive operation
 * Returns the snapshot if created, null if it couldn't be created
 */
export async function createAutoSnapshot(
  vfs: InMemoryVFS,
  reason: string
): Promise<SessionSnapshot | null> {
  try {
    const activeSession = getActiveSession();

    // Capture current state
    const diskImage = await captureSessionState(
      vfs,
      activeSession.name,
      activeSession.created,
      activeSession.env,
      activeSession.aliases,
      activeSession.history
    );

    // Create auto snapshot with timestamp-based name
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const snapshotName = `auto-${timestamp}`;

    const snapshot = await createSnapshot(
      activeSession.id,
      snapshotName,
      diskImage,
      {
        description: `Auto-snapshot before ${reason}`,
        isAuto: true,
      }
    );

    // Enforce snapshot limit
    await enforceSnapshotLimit(activeSession.id);

    return snapshot;
  } catch (error) {
    console.warn("Failed to create auto-snapshot:", error);
    return null;
  }
}

export const session: BuiltinCommand = async (args: string[], _context: ExecutionContext): Promise<CommandResult> => {
  const subcommand = args[0];

  if (!subcommand || subcommand === "list") {
    // List all sessions
    const sessions = Object.values(sessionState.sessions);
    sessions.sort((a, b) => a.name.localeCompare(b.name));

    let output = "";
    for (const sess of sessions) {
      const active = sess.id === sessionState.active ? " (active)" : "";
      const lastAccess = new Date(sess.lastAccess).toLocaleString();
      output += `${sess.name}${active}\n`;
      output += `  ID: ${sess.id}\n`;
      output += `  Last access: ${lastAccess}\n`;
    }

    return { stdout: output, stderr: "", exitCode: 0 };
  }

  if (subcommand === "new") {
    // Create new session
    const name = args[1];
    if (!name) {
      return {
        stdout: "",
        stderr: "Usage: session new <name>\n",
        exitCode: 1
      };
    }

    // Check if name already exists
    const existing = Object.values(sessionState.sessions).find(s => s.name === name);
    if (existing) {
      return {
        stdout: "",
        stderr: `Session '${name}' already exists\n`,
        exitCode: 1
      };
    }

    const sess = createSession(name);
    return {
      stdout: `Created session '${name}' (${sess.id})\n`,
      stderr: "",
      exitCode: 0
    };
  }

  if (subcommand === "switch") {
    // Switch to session
    const nameOrId = args[1];
    if (!nameOrId) {
      return {
        stdout: "",
        stderr: "Usage: session switch <name|id>\n",
        exitCode: 1
      };
    }

    // Find session by name or ID
    let sess = sessionState.sessions[nameOrId];
    if (!sess) {
      // Try to find by name
      const found = Object.values(sessionState.sessions).find(s => s.name === nameOrId);
      if (found) sess = found;
    }

    if (!sess) {
      return {
        stdout: "",
        stderr: `Session '${nameOrId}' not found\n`,
        exitCode: 1
      };
    }

    try {
      switchSession(sess.id);
      // Signal shell to reload VFS with the new session's filesystem namespace
      (_context as any).requestedSessionSwitch = {
        fsNamespace: sess.fsNamespace,
        env: sess.env,
        aliases: sess.aliases,
      };
      return {
        stdout: `Switched to session '${sess.name}'\n`,
        stderr: "",
        exitCode: 0
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `${(error as Error).message}\n`,
        exitCode: 1
      };
    }
  }

  if (subcommand === "delete" || subcommand === "rm") {
    // Delete session
    const nameOrId = args[1];
    if (!nameOrId) {
      return {
        stdout: "",
        stderr: "Usage: session delete <name|id>\n",
        exitCode: 1
      };
    }

    // Find session by name or ID
    let sess = sessionState.sessions[nameOrId];
    if (!sess) {
      // Try to find by name
      const found = Object.values(sessionState.sessions).find(s => s.name === nameOrId);
      if (found) sess = found;
    }

    if (!sess) {
      return {
        stdout: "",
        stderr: `Session '${nameOrId}' not found\n`,
        exitCode: 1
      };
    }

    try {
      deleteSession(sess.id);
      return {
        stdout: `Deleted session '${sess.name}'\n`,
        stderr: "",
        exitCode: 0
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `${(error as Error).message}\n`,
        exitCode: 1
      };
    }
  }

  if (subcommand === "rename") {
    // Rename session
    const nameOrId = args[1];
    const newName = args[2];

    if (!nameOrId || !newName) {
      return {
        stdout: "",
        stderr: "Usage: session rename <name|id> <new-name>\n",
        exitCode: 1
      };
    }

    // Find session by name or ID
    let sess = sessionState.sessions[nameOrId];
    if (!sess) {
      // Try to find by name
      const found = Object.values(sessionState.sessions).find(s => s.name === nameOrId);
      if (found) sess = found;
    }

    if (!sess) {
      return {
        stdout: "",
        stderr: `Session '${nameOrId}' not found\n`,
        exitCode: 1
      };
    }

    // Check if new name already exists
    const existing = Object.values(sessionState.sessions).find(s => s.name === newName && s.id !== sess!.id);
    if (existing) {
      return {
        stdout: "",
        stderr: `Session '${newName}' already exists\n`,
        exitCode: 1
      };
    }

    const oldName = sess.name;
    try {
      updateSession(sess.id, { name: newName });
      return {
        stdout: `Renamed session '${oldName}' to '${newName}'\n`,
        stderr: "",
        exitCode: 0
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `${(error as Error).message}\n`,
        exitCode: 1
      };
    }
  }

  if (subcommand === "export") {
    // Export current session to disk image
    const activeSession = getActiveSession();
    const vfs = _context.vfs;

    if (!vfs) {
      return {
        stdout: "",
        stderr: "Export failed: VFS not available\n",
        exitCode: 1
      };
    }

    try {
      // Collect all files recursively, excluding /proc and /dev
      const files: Record<string, DiskFile> = {};

      async function collectFiles(dirPath: string): Promise<void> {
        // Skip /proc and /dev directories
        if (dirPath.startsWith("/proc") || dirPath.startsWith("/dev")) {
          return;
        }

        const entries = vfs!.listDetailed(dirPath);
        for (const entry of entries) {
          const fullPath = dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;

          // Skip /proc and /dev at top level
          if (fullPath === "/proc" || fullPath === "/dev") {
            continue;
          }

          const diskFile: DiskFile = {
            type: entry.type,
            meta: {
              created: new Date(entry.meta.createdAt).toISOString(),
              modified: new Date(entry.meta.updatedAt).toISOString(),
              permissions: "rw-r--r--"
            }
          };

          if (entry.type === "file") {
            // Read file content
            const content = await vfs!.read(fullPath);
            diskFile.content = content;
          }

          files[fullPath] = diskFile;

          // Recursively collect from subdirectories
          if (entry.type === "directory") {
            await collectFiles(fullPath);
          }
        }
      }

      // Start collecting from root
      await collectFiles("/");

      // Create the DiskImage structure
      const diskImage: DiskImage = {
        version: 1,
        name: activeSession.name,
        created: new Date(activeSession.created).toISOString(),
        exported: new Date().toISOString(),
        session: {
          env: { ...activeSession.env },
          aliases: { ...activeSession.aliases },
          history: [...activeSession.history]
        },
        files
      };

      // Trigger browser download in YAML format
      const yamlString = serializeDiskImageToYaml(diskImage);
      const blob = new Blob([yamlString], { type: "application/x-yaml" });
      const url = URL.createObjectURL(blob);

      // Create a temporary anchor element to trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeSession.name}.disk.yaml`;
      a.click();
      URL.revokeObjectURL(url);

      return {
        stdout: `Exported session '${activeSession.name}' to ${activeSession.name}.disk.yaml\n`,
        stderr: "",
        exitCode: 0
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `Export failed: ${(error as Error).message}\n`,
        exitCode: 1
      };
    }
  }

  if (subcommand === "import") {
    // Parse import flags
    const flags = args.slice(1);
    const hasMerge = flags.includes("--merge");
    const hasOverwrite = flags.includes("--overwrite");
    const hasSkip = flags.includes("--skip");
    const hasInteractive = flags.includes("--interactive");

    // Validate flag combinations
    const conflictFlags = [hasOverwrite, hasSkip, hasInteractive].filter(Boolean).length;
    if (conflictFlags > 1) {
      return {
        stdout: "",
        stderr: "Error: Only one of --overwrite, --skip, or --interactive can be specified\n",
        exitCode: 1
      };
    }

    // Conflict resolution flags require --merge
    if (!hasMerge && (hasOverwrite || hasSkip || hasInteractive)) {
      return {
        stdout: "",
        stderr: "Error: --overwrite, --skip, and --interactive require --merge flag\n",
        exitCode: 1
      };
    }

    // Determine the UI request based on flags
    if (hasMerge) {
      let strategy: ConflictStrategy = 'interactive'; // default for merge
      if (hasOverwrite) strategy = 'overwrite';
      if (hasSkip) strategy = 'skip';

      // Trigger merge dialog with the specified strategy
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        uiRequest: `showMergeDialog:${strategy}`
      };
    }

    // Check for --undo flag
    if (flags.includes("--undo")) {
      return await handleImportUndo(_context);
    }

    // Check for --history flag
    if (flags.includes("--history")) {
      return await handleImportHistory();
    }

    // Default behavior: show import dialog (creates new session)
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      uiRequest: "showImportDialog"
    };
  }

  // session diff <file.disk.yaml> - preview changes before import
  if (subcommand === "diff") {
    const filePath = args[1];
    if (!filePath) {
      return {
        stdout: "",
        stderr: "Usage: session diff <file.disk.yaml>\nShows differences between current session and a disk image before import.\n",
        exitCode: 1
      };
    }

    // Trigger diff dialog with file selection
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      uiRequest: `showDiffDialog:${filePath}`
    };
  }

  // session snapshot <name> - create a named snapshot
  if (subcommand === "snapshot") {
    const snapshotName = args[1];
    if (!snapshotName) {
      return {
        stdout: "",
        stderr: "Usage: session snapshot <name>\nCreates a named snapshot of the current session state.\n",
        exitCode: 1
      };
    }

    const vfs = _context.vfs;
    if (!vfs) {
      return {
        stdout: "",
        stderr: "Snapshot failed: VFS not available\n",
        exitCode: 1
      };
    }

    try {
      const activeSession = getActiveSession();

      // Check if a snapshot with this name already exists
      const existing = await getSnapshotByName(activeSession.id, snapshotName);
      if (existing) {
        return {
          stdout: "",
          stderr: `Snapshot '${snapshotName}' already exists. Use a different name or delete the existing snapshot.\n`,
          exitCode: 1
        };
      }

      // Capture current state
      const diskImage = await captureSessionState(
        vfs,
        activeSession.name,
        activeSession.created,
        activeSession.env,
        activeSession.aliases,
        activeSession.history
      );

      // Create the snapshot
      const snapshot = await createSnapshot(
        activeSession.id,
        snapshotName,
        diskImage,
        { isAuto: false }
      );

      // Enforce snapshot limit
      const deleted = await enforceSnapshotLimit(activeSession.id);

      let output = `Created snapshot '${snapshotName}'\n`;
      output += `  Timestamp: ${new Date(snapshot.timestamp).toLocaleString()}\n`;
      output += `  Files: ${Object.keys(diskImage.files).length}\n`;

      if (deleted > 0) {
        output += `  (${deleted} old snapshot(s) removed to stay within limit)\n`;
      }

      return {
        stdout: output,
        stderr: "",
        exitCode: 0
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `Snapshot failed: ${(error as Error).message}\n`,
        exitCode: 1
      };
    }
  }

  // session snapshots - list all snapshots
  if (subcommand === "snapshots") {
    try {
      const activeSession = getActiveSession();
      const snapshots = await getSessionSnapshots(activeSession.id);

      if (snapshots.length === 0) {
        return {
          stdout: "No snapshots for current session.\n",
          stderr: "",
          exitCode: 0
        };
      }

      let output = `Snapshots for session '${activeSession.name}':\n\n`;

      for (const snapshot of snapshots) {
        const date = new Date(snapshot.timestamp).toLocaleString();
        const autoTag = snapshot.isAuto ? " (auto)" : "";
        const fileCount = Object.keys(snapshot.diskImage.files).length;

        output += `  ${snapshot.name}${autoTag}\n`;
        output += `    Created: ${date}\n`;
        output += `    Files: ${fileCount}\n`;
        if (snapshot.description) {
          output += `    Description: ${snapshot.description}\n`;
        }
        output += "\n";
      }

      output += `Total: ${snapshots.length} snapshot(s) (limit: ${DEFAULT_MAX_SNAPSHOTS})\n`;

      return {
        stdout: output,
        stderr: "",
        exitCode: 0
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `Failed to list snapshots: ${(error as Error).message}\n`,
        exitCode: 1
      };
    }
  }

  // session restore <name> - restore session to snapshot state
  if (subcommand === "restore") {
    const snapshotName = args[1];
    if (!snapshotName) {
      return {
        stdout: "",
        stderr: "Usage: session restore <name>\nRestores the session to a previous snapshot state.\n",
        exitCode: 1
      };
    }

    const vfs = _context.vfs;
    if (!vfs) {
      return {
        stdout: "",
        stderr: "Restore failed: VFS not available\n",
        exitCode: 1
      };
    }

    try {
      const activeSession = getActiveSession();

      // Find the snapshot
      const snapshot = await getSnapshotByName(activeSession.id, snapshotName);
      if (!snapshot) {
        return {
          stdout: "",
          stderr: `Snapshot '${snapshotName}' not found.\nUse 'session snapshots' to list available snapshots.\n`,
          exitCode: 1
        };
      }

      // Create auto-snapshot before restore (destructive operation)
      const autoSnapshot = await createAutoSnapshot(vfs, `restore to '${snapshotName}'`);
      let autoSnapshotMsg = "";
      if (autoSnapshot) {
        autoSnapshotMsg = `Auto-snapshot '${autoSnapshot.name}' created before restore.\n`;
      }

      // Restore files from snapshot
      const diskImage = snapshot.diskImage;
      let filesRestored = 0;
      let filesCreated = 0;
      const errors: string[] = [];

      // Sort paths by depth to ensure parent directories are created first
      const sortedPaths = Object.keys(diskImage.files).sort((a, b) => {
        const depthA = a.split("/").length;
        const depthB = b.split("/").length;
        return depthA - depthB;
      });

      for (const filePath of sortedPaths) {
        const diskFile = diskImage.files[filePath];

        try {
          if (diskFile.type === "directory") {
            if (!vfs.exists(filePath)) {
              vfs.mkdir(filePath, true);
              filesCreated++;
            }
          } else if (diskFile.type === "file" && diskFile.content !== undefined) {
            // Create parent directories if they don't exist
            const parentDir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
            if (parentDir !== "/" && !vfs.exists(parentDir)) {
              vfs.mkdir(parentDir, true);
            }

            const existed = vfs.exists(filePath);
            await vfs.write(filePath, diskFile.content);

            if (existed) {
              filesRestored++;
            } else {
              filesCreated++;
            }
          }
        } catch (error) {
          errors.push(`${filePath}: ${(error as Error).message}`);
        }
      }

      // Restore session state (env, aliases, history)
      updateSession(activeSession.id, {
        env: { ...diskImage.session.env },
        aliases: { ...diskImage.session.aliases },
        history: [...diskImage.session.history]
      });

      // Sync VFS
      await vfs.sync();

      let output = autoSnapshotMsg;
      output += `Restored session to snapshot '${snapshotName}':\n`;
      output += `  Files restored: ${filesRestored}\n`;
      output += `  Files created: ${filesCreated}\n`;
      output += `  Environment variables: ${Object.keys(diskImage.session.env).length}\n`;
      output += `  Aliases: ${Object.keys(diskImage.session.aliases).length}\n`;

      if (errors.length > 0) {
        output += `\nErrors (${errors.length}):\n`;
        for (const err of errors.slice(0, 5)) {
          output += `  - ${err}\n`;
        }
        if (errors.length > 5) {
          output += `  ... and ${errors.length - 5} more\n`;
        }
      }

      return {
        stdout: output,
        stderr: "",
        exitCode: errors.length > 0 ? 1 : 0
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `Restore failed: ${(error as Error).message}\n`,
        exitCode: 1
      };
    }
  }

  return {
    stdout: "",
    stderr: `Unknown subcommand: ${subcommand}\nUsage: session [list|new|switch|delete|rename|export|import|diff|snapshot|snapshots|restore]\n` +
            "  snapshot <name> - create a named snapshot\n" +
            "  snapshots - list all snapshots\n" +
            "  restore <name> - restore to a snapshot\n" +
            "  import [--merge] [--overwrite|--skip|--interactive] [--undo] [--history]\n" +
            "  diff <file.disk.yaml>\n",
    exitCode: 1
  };
};

/**
 * Handle the import --undo command
 * Reverts the most recent import operation for the current session
 */
async function handleImportUndo(context: ExecutionContext): Promise<CommandResult> {
  const activeSession = getActiveSession();
  const vfs = context.vfs;

  if (!vfs) {
    return {
      stdout: "",
      stderr: "Error: VFS not available\n",
      exitCode: 1
    };
  }

  // Get the most recent import entry
  let latestImport;
  try {
    latestImport = await getLatestImportEntry(activeSession.id);
  } catch {
    // DB not available (test environment or CLI mode without storage)
    return {
      stdout: "",
      stderr: "No import history found for current session. Nothing to undo.\n",
      exitCode: 1
    };
  }

  if (!latestImport) {
    return {
      stdout: "",
      stderr: "No import history found for current session. Nothing to undo.\n",
      exitCode: 1
    };
  }

  // Check if the import was a new session creation (can't undo that from here)
  if (latestImport.wasNew) {
    return {
      stdout: "",
      stderr: `Cannot undo session creation. Use 'session delete' to remove the imported session.\n` +
              `Last import created session from: ${latestImport.diskImageName}\n`,
      exitCode: 1
    };
  }

  const lines: string[] = [];
  let undoneCount = 0;
  let errorCount = 0;

  // Revert each file that has a version snapshot
  for (const [filePath, versionId] of Object.entries(latestImport.versionIds)) {
    try {
      const result = await revertToVersion(activeSession.fsNamespace, filePath, versionId, {});
      if (result) {
        // Write the reverted content back to VFS
        await vfs.write(filePath, result.content);
        undoneCount++;
      } else {
        errorCount++;
        lines.push(`  Warning: Could not find version for ${filePath}`);
      }
    } catch (error) {
      errorCount++;
      lines.push(`  Error reverting ${filePath}: ${(error as Error).message}`);
    }
  }

  // Sync VFS changes
  await vfs.sync();

  // Build result message
  lines.unshift(`Undo import from: ${latestImport.diskImageName}`);
  lines.push(`\nFiles reverted: ${undoneCount}`);
  if (errorCount > 0) {
    lines.push(`Errors: ${errorCount}`);
  }
  lines.push(`\nNote: Environment variables and aliases were not reverted.`);
  lines.push(`Use 'timewarp list <file>' to manage individual file versions.`);

  return {
    stdout: lines.join("\n") + "\n",
    stderr: "",
    exitCode: errorCount > 0 ? 1 : 0
  };
}

/**
 * Handle the import --history command
 * Shows the import history for the current session
 */
async function handleImportHistory(): Promise<CommandResult> {
  const activeSession = getActiveSession();

  let history;
  try {
    history = await getSessionImportHistory(activeSession.id);
  } catch {
    // DB not available (test environment or CLI mode without storage)
    return {
      stdout: "No import history for current session.\n",
      stderr: "",
      exitCode: 0
    };
  }

  if (history.length === 0) {
    return {
      stdout: "No import history for current session.\n",
      stderr: "",
      exitCode: 0
    };
  }

  const lines: string[] = [`Import history for session '${activeSession.name}':\n`];

  for (const entry of history) {
    const date = new Date(entry.timestamp).toLocaleString();
    const mode = entry.wasNew ? "new session" : `merge (${entry.mergeStrategy || "unknown"})`;
    lines.push(`  ${date} - ${entry.diskImageName}`);
    lines.push(`    Mode: ${mode}`);
    lines.push(`    Files imported: ${entry.filesImported.length}`);
    if (entry.filesSkipped.length > 0) {
      lines.push(`    Files skipped: ${entry.filesSkipped.length}`);
    }
    if (Object.keys(entry.versionIds).length > 0) {
      lines.push(`    Versions saved: ${Object.keys(entry.versionIds).length} (undoable)`);
    }
    lines.push("");
  }

  return {
    stdout: lines.join("\n"),
    stderr: "",
    exitCode: 0
  };
}

/**
 * Perform diff between current session and a disk image
 * Called by the UI after file is selected
 */
export function diffDiskImage(
  diskImage: DiskImage,
  vfs: InMemoryVFS,
  currentEnv: Record<string, string>,
  currentAliases: Record<string, string>
): string {
  const lines: string[] = [];
  lines.push(`Comparing current session with disk image: ${diskImage.name}`);
  lines.push(`Exported: ${diskImage.exported}\n`);

  // File differences
  const newFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const unchangedFiles: string[] = [];

  for (const [filePath, diskFile] of Object.entries(diskImage.files)) {
    if (diskFile.type !== 'file') continue;

    if (!vfs.exists(filePath)) {
      newFiles.push(filePath);
    } else {
      try {
        const currentContent = vfs.readSync(filePath);
        if (currentContent !== diskFile.content) {
          modifiedFiles.push(filePath);
        } else {
          unchangedFiles.push(filePath);
        }
      } catch {
        newFiles.push(filePath);
      }
    }
  }

  // Files section
  lines.push("=== Files ===");
  if (newFiles.length > 0) {
    lines.push(`\nNew files (${newFiles.length}):`);
    for (const f of newFiles.slice(0, 20)) {
      lines.push(`  + ${f}`);
    }
    if (newFiles.length > 20) {
      lines.push(`  ... and ${newFiles.length - 20} more`);
    }
  }

  if (modifiedFiles.length > 0) {
    lines.push(`\nModified files (${modifiedFiles.length}):`);
    for (const f of modifiedFiles.slice(0, 20)) {
      lines.push(`  ~ ${f}`);
    }
    if (modifiedFiles.length > 20) {
      lines.push(`  ... and ${modifiedFiles.length - 20} more`);
    }
  }

  if (unchangedFiles.length > 0) {
    lines.push(`\nUnchanged files: ${unchangedFiles.length}`);
  }

  // Environment differences
  const newEnvVars: string[] = [];
  const modifiedEnvVars: string[] = [];

  for (const [key, value] of Object.entries(diskImage.session.env)) {
    if (!(key in currentEnv)) {
      newEnvVars.push(key);
    } else if (currentEnv[key] !== value) {
      modifiedEnvVars.push(key);
    }
  }

  if (newEnvVars.length > 0 || modifiedEnvVars.length > 0) {
    lines.push("\n=== Environment Variables ===");
    if (newEnvVars.length > 0) {
      lines.push(`New: ${newEnvVars.join(", ")}`);
    }
    if (modifiedEnvVars.length > 0) {
      lines.push(`Modified: ${modifiedEnvVars.join(", ")}`);
    }
  }

  // Alias differences
  const newAliases: string[] = [];
  const modifiedAliases: string[] = [];

  for (const [name, command] of Object.entries(diskImage.session.aliases)) {
    if (!(name in currentAliases)) {
      newAliases.push(name);
    } else if (currentAliases[name] !== command) {
      modifiedAliases.push(name);
    }
  }

  if (newAliases.length > 0 || modifiedAliases.length > 0) {
    lines.push("\n=== Aliases ===");
    if (newAliases.length > 0) {
      lines.push(`New: ${newAliases.join(", ")}`);
    }
    if (modifiedAliases.length > 0) {
      lines.push(`Modified: ${modifiedAliases.join(", ")}`);
    }
  }

  // Summary
  lines.push("\n=== Summary ===");
  lines.push(`Files: ${newFiles.length} new, ${modifiedFiles.length} modified, ${unchangedFiles.length} unchanged`);
  lines.push(`Environment: ${newEnvVars.length} new, ${modifiedEnvVars.length} modified`);
  lines.push(`Aliases: ${newAliases.length} new, ${modifiedAliases.length} modified`);

  return lines.join("\n");
}

/**
 * Record an import operation in history
 * Should be called after a successful import or merge
 */
export async function recordImportHistory(
  sessionId: string,
  diskImage: DiskImage,
  wasNew: boolean,
  mergeResult?: MergeResult,
  strategy?: ConflictStrategy
): Promise<ImportHistoryEntry> {
  const entry: Omit<ImportHistoryEntry, "id"> = {
    timestamp: Date.now(),
    diskImageName: diskImage.name,
    diskImageExported: diskImage.exported,
    sessionId,
    wasNew,
    mergeStrategy: strategy,
    filesImported: mergeResult?.merged || Object.keys(diskImage.files).filter(p => diskImage.files[p].type === 'file'),
    filesSkipped: mergeResult?.skipped || [],
    versionIds: mergeResult?.versionIds || {},
    envMerged: mergeResult?.envMerged || Object.keys(diskImage.session.env),
    aliasesMerged: mergeResult?.aliasesMerged || Object.keys(diskImage.session.aliases)
  };

  return await saveImportEntry(entry);
}
