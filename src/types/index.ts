export type FSType = 'file' | 'directory' | 'virtual';

export interface FSNode {
  name: string;
  type: FSType;
  parent: string | null; // path
  meta: {
    createdAt: number;
    updatedAt: number;
  };
}

export interface FileNode extends FSNode {
  type: 'file';
  content: string;
}

export interface DirectoryNode extends FSNode {
  type: 'directory';
  children: string[]; // names of children
}

/**
 * A message in the AI conversation history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;                   // Unix timestamp
  mode?: string;                       // AI mode (chat, create, edit, explain, fix)
}

export interface Session {
  id: string;                          // UUID
  name: string;                        // Display name
  created: number;                     // Unix timestamp
  lastAccess: number;                  // Unix timestamp
  fsNamespace: string;                 // IndexedDB namespace for this session's FS
  env: Record<string, string>;         // Session environment variables
  history: string[];                   // Command history
  aliases: Record<string, string>;     // User-defined aliases
  conversationHistory?: ConversationMessage[]; // AI conversation history
}

export interface DiskFile {
  type: FSType;
  content?: string;                    // For files
  meta: {
    created: string;                   // ISO 8601
    modified: string;                  // ISO 8601
    permissions: string;
  };
}

export interface DiskImage {
  version: 1;
  name: string;
  created: string;                     // ISO 8601
  exported: string;                    // ISO 8601
  session: {
    env: Record<string, string>;
    aliases: Record<string, string>;
    history: string[];
  };
  files: Record<string, DiskFile>;     // path -> file
}

/**
 * A single version of a file in the version history.
 * Versions form a tree structure where each edit creates a new version
 * that references its parent.
 */
export interface FileVersion {
  id: string;                          // UUID for this version
  filePath: string;                    // Absolute path to the file
  content: string;                     // File content at this version
  timestamp: number;                   // Unix timestamp when version was created
  parentId: string | null;             // ID of parent version (null for initial)
  branchName: string;                  // Branch name (default: 'main')
  message?: string;                    // Optional description of changes
  author?: string;                     // Who made the change (e.g., '@ai', 'user')
}

/**
 * Version history metadata for a file.
 * Tracks which version is currently active and all branches.
 */
export interface FileVersionHistory {
  filePath: string;                    // Absolute path to the file
  currentVersionId: string;            // ID of the currently active version
  branches: Record<string, string>;    // branchName -> latest version ID on that branch
}

/**
 * Record of a disk image import operation for tracking and undo functionality
 */
export interface ImportHistoryEntry {
  id: string;                          // UUID for this import
  timestamp: number;                   // Unix timestamp when import occurred
  diskImageName: string;               // Name from the disk image
  diskImageExported: string;           // ISO 8601 timestamp when disk image was exported
  sessionId: string;                   // Target session ID
  wasNew: boolean;                     // True if created a new session, false if merged
  mergeStrategy?: 'overwrite' | 'skip' | 'interactive'; // Strategy used for merge
  filesImported: string[];             // Paths of files that were imported/overwritten
  filesSkipped: string[];              // Paths of files that were skipped
  versionIds: Record<string, string>;  // filePath -> versionId of pre-import version (for undo)
  envMerged: string[];                 // Environment variables that were merged
  aliasesMerged: string[];             // Aliases that were merged
}

/**
 * A named snapshot of a session's complete state
 * Stored in /var/snapshots/ directory and indexed in the database
 */
export interface SessionSnapshot {
  id: string;                          // UUID for this snapshot
  sessionId: string;                   // Session this snapshot belongs to
  name: string;                        // User-provided name
  timestamp: number;                   // Unix timestamp when snapshot was created
  description?: string;                // Optional description
  isAuto: boolean;                     // True if created automatically before destructive ops
  diskImage: DiskImage;                // Full session state captured as DiskImage
}