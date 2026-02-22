/**
 * @fileoverview In-memory Virtual File System (VFS) with persistence.
 *
 * The InMemoryVFS provides a Unix-like filesystem that:
 * - Runs entirely in the browser
 * - Persists to IndexedDB automatically
 * - Supports /proc and /dev virtual filesystems
 * - Uses batched writes for optimal performance
 *
 * Features:
 * - Standard file operations (read, write, append, remove, copy, move)
 * - Directory operations (mkdir, list, chdir)
 * - Path resolution with relative and absolute paths
 * - /proc virtual filesystem for system information
 * - /dev virtual filesystem for special devices
 * - Automatic IndexedDB persistence with batching
 *
 * @module vfs/memory
 */

import type { DirectoryNode, FileNode, FSNode } from '../types';
import path from 'path-browserify';
import { loadFilesystem, syncFilesystem } from '../persistence/filesystem';
import { getBatchManager, type BatchManager } from '../persistence/batch';
import { getStorage, isStorageInitialized, type StorageBackend } from '../persistence/storage';
import {
  isProcPath,
  isProcDirectory,
  getProcGenerator,
  listProcDirectory,
  setProcContext,
  setBootTime,
  getProcWriteHandler,
} from './proc';
import {
  isDevPath,
  isDevDirectory,
  isDevFile,
  getDevHandler,
  listDevDirectory
} from './dev';
import {
  isDocsPath,
  isDocsDirectory,
  isDocsFile,
  getDocsGenerator,
  listDocsDirectory
} from './docs';
import { saveVersion, hasVersionHistory } from '../persistence/versions';

/**
 * In-memory virtual filesystem with IndexedDB persistence.
 *
 * The VFS provides a Unix-like filesystem abstraction that operates
 * entirely in the browser. Data is automatically persisted to IndexedDB
 * using batched writes for optimal performance.
 *
 * Special directories:
 * - `/proc`: Virtual files that generate content dynamically (AI config, system info)
 * - `/dev`: Device files (null, zero, random, clipboard)
 *
 * @example
 * const vfs = new InMemoryVFS('session-123');
 * await vfs.init();
 *
 * // File operations
 * vfs.write('/home/user/file.txt', 'Hello, world!');
 * const content = vfs.read('/home/user/file.txt');
 *
 * // Directory operations
 * vfs.mkdir('/home/user/projects');
 * const files = vfs.list('/home/user');
 */
export class InMemoryVFS {
  private nodes: Map<string, FSNode> = new Map();
  private _cwd = '/';
  private namespace: string;
  private initialized = false;
  private batchManager: BatchManager | null = null;
  private storage: StorageBackend | null = null;

  /**
   * Create a new VFS instance.
   *
   * @param namespace - Unique namespace for IndexedDB persistence (e.g., session ID)
   */
  constructor(namespace = 'default') {
    this.namespace = namespace;
    // Initialize boot time for /proc/system/uptime
    setBootTime(Date.now());
    // Initialize root directory
    this.nodes.set('/', {
      name: '/',
      type: 'directory',
      parent: null,
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      children: [],
    } as DirectoryNode);
  }

  /**
   * Update the proc context with current environment variables
   * This should be called before accessing /proc/env
   */
  public setProcEnv(env: Record<string, string>): void {
    setProcContext({ env });
  }

  /**
   * Initialize the VFS by loading from storage or creating default filesystem.
   * In CLI mode, uses filesystem-based storage (~/.tronos/).
   * In browser mode, uses IndexedDB.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check if storage abstraction is initialized (CLI mode)
      if (isStorageInitialized()) {
        this.storage = getStorage();

        // Try to load existing filesystem from storage
        const loadedNodes = await this.storage.loadFilesystem(this.namespace);

        if (loadedNodes.size > 0) {
          // Filesystem exists in storage, use it
          this.nodes = loadedNodes;
          // Ensure we have a root node
          if (!this.nodes.has('/')) {
            this.nodes.set('/', {
              name: '/',
              type: 'directory',
              parent: null,
              meta: {
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
              children: [],
            } as DirectoryNode);
          }
        } else {
          // No existing filesystem, create default structure
          this.initDefaultFS();
          // Save the default filesystem to storage
          await this.sync();
        }
        // Ensure default files have version history (also handles existing sessions)
        await this.initDefaultVersions();
      }
      // Check if IndexedDB is available (browser environment)
      else if (typeof indexedDB !== 'undefined') {
        // Initialize IndexedDB
        const { initDB } = await import('../persistence/db');
        await initDB();

        // Initialize the batch manager for this namespace
        this.batchManager = getBatchManager(this.namespace);

        // Try to load existing filesystem from IndexedDB
        const loadedNodes = await loadFilesystem(this.namespace);

        if (loadedNodes.size > 0) {
          // Filesystem exists in IndexedDB, use it
          this.nodes = loadedNodes;
          // Ensure we have a root node
          if (!this.nodes.has('/')) {
            this.nodes.set('/', {
              name: '/',
              type: 'directory',
              parent: null,
              meta: {
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
              children: [],
            } as DirectoryNode);
          }
        } else {
          // No existing filesystem, create default structure
          this.initDefaultFS();
          // Save the default filesystem to IndexedDB
          await this.sync();
        }
        // Ensure default files have version history (also handles existing sessions)
        await this.initDefaultVersions();
      } else {
        // No storage available (test environment), just create default filesystem
        this.initDefaultFS();
      }
    } catch (error) {
      // If persistence fails, fall back to in-memory only
      console.warn('Failed to initialize persistence, using in-memory only:', error);
      this.initDefaultFS();
    }

    // Migrate .exe → .trx for existing sessions
    this.migrateExeToTrx();

    this.initialized = true;
  }

  /**
   * Migrate legacy .exe files to .trx extension.
   * Renames any .exe files found in /bin to .trx so existing
   * sessions continue to work after the extension rename.
   */
  private migrateExeToTrx(): void {
    try {
      if (!this.exists('/bin') || !this.isDirectory('/bin')) return;
      const files = this.list('/bin');
      for (const file of files) {
        if (file.endsWith('.exe')) {
          const oldPath = `/bin/${file}`;
          const newPath = `/bin/${file.replace(/\.exe$/, '.trx')}`;
          if (!this.exists(newPath)) {
            const content = this.readSync(oldPath);
            this.write(newPath, content);
            this.remove(oldPath);
          }
        }
      }
    } catch {
      // Migration is best-effort; don't block boot
    }
  }

  private initDefaultFS(): void {
    // Create essential directories
    this.mkdir('/home/tronos', true);
    this.mkdir('/bin', true);
    this.mkdir('/tmp', true);
    this.mkdir('/dev', true);
    this.mkdir('/etc', true);
    this.mkdir('/proc', true);
    this.mkdir('/usr/share/man/man1', true);

    // Create a welcome message
    this.write('/etc/motd',
`Welcome to TronOS!
This is a simulated operating system running in your browser.
`);

    // Create a default user profile with aliases
    this.write('/home/tronos/.profile',
`# Default aliases
alias ll='ls -l'
alias la='ls -la'
alias ..='cd ..'
`);

    // Create /bin/help.trx - Display help information
    this.write('/bin/help.trx',
`#!/tronos
// @name: help
// @description: Display help information
// @version: 1.0.0

(async function(t) {
  const topic = t.args[0];

  if (!topic) {
    t.writeln(t.style.bold("TronOS Help"));
    t.writeln("");
    t.writeln("Available commands:");
    t.writeln("  " + t.style.cyan("ls, cd, pwd, cat, echo, mkdir, touch, rm, cp, mv"));
    t.writeln("  " + t.style.cyan("head, tail, grep, wc, clear, history"));
    t.writeln("  " + t.style.cyan("env, export, alias, which, type"));
    t.writeln("  " + t.style.cyan("curl, fetch"));
    t.writeln("  " + t.style.cyan("session, config"));
    t.writeln("");
    t.writeln("AI Assistant:");
    t.writeln("  " + t.style.green("@ai create <name> <description>") + "  Generate a new program");
    t.writeln("  " + t.style.green("@ai edit <file> <changes>") + "       Modify existing code");
    t.writeln("  " + t.style.green("@ai explain <file>") + "              Explain how code works");
    t.writeln("  " + t.style.green("@ai fix <file>") + "                  Fix errors in code");
    t.writeln("  " + t.style.green("@ai <question>") + "                  Ask anything");
    t.writeln("");
    t.writeln("Type 'help <command>' for more info on a specific command.");
  } else {
    // Specific command help - delegate to shell help builtin
    const result = await t.exec("help " + topic);
    if (result.stdout) {
      t.writeln(result.stdout);
    }
    if (result.stderr) {
      t.writeln(result.stderr);
    }
  }

  t.exit(0);
})
`);

    // Create /bin/countdown.trx - Countdown timer with argument support
    this.write('/bin/countdown.trx',
`#!/tronos
// @name: countdown
// @description: Countdown timer with argument support
// @version: 1.0.0
// @author: @ai

(async function(t) {
  const seconds = parseInt(t.args[0]) || 10;

  if (isNaN(seconds) || seconds <= 0) {
    t.writeln(t.style.red("Usage: countdown [seconds]"));
    t.writeln("  seconds: positive integer (default: 10)");
    t.exit(1);
  }

  for (let i = seconds; i > 0; i--) {
    t.clear();
    t.writeln("");
    t.writeln(t.style.bold(t.style.cyan("    " + i)));
    t.writeln("");
    await t.sleep(1000);
  }

  t.clear();
  t.writeln("");
  t.writeln(t.style.bold(t.style.green("    TIME!")));
  t.writeln("");

  t.exit(0);
})
`);

    // Create /bin/tictactoe.trx - Two-player tic-tac-toe game
    this.write('/bin/tictactoe.trx',
`#!/tronos
// @name: tictactoe
// @description: Two-player tic-tac-toe game
// @version: 1.0.0
// @author: @ai

(async function(t) {
  // Game state
  let board = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '];
  let currentPlayer = 'X';
  let gameOver = false;

  // Win conditions (indices)
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];

  // Draw the game board
  function drawBoard() {
    t.clear();
    t.writeln('');
    t.writeln(t.style.bold(t.style.cyan('  TIC-TAC-TOE')));
    t.writeln('');
    t.writeln('  Use keys 1-9 to place your mark:');
    t.writeln('');
    t.writeln('   1 | 2 | 3');
    t.writeln('  ---+---+---');
    t.writeln('   4 | 5 | 6');
    t.writeln('  ---+---+---');
    t.writeln('   7 | 8 | 9');
    t.writeln('');
    t.writeln(t.style.bold('  Current Board:'));
    t.writeln('');

    // Draw actual board with colors
    for (let row = 0; row < 3; row++) {
      let rowStr = '   ';
      for (let col = 0; col < 3; col++) {
        const idx = row * 3 + col;
        const cell = board[idx];
        if (cell === 'X') {
          rowStr += t.style.red(t.style.bold('X'));
        } else if (cell === 'O') {
          rowStr += t.style.blue(t.style.bold('O'));
        } else {
          rowStr += ' ';
        }
        if (col < 2) rowStr += ' | ';
      }
      t.writeln(rowStr);
      if (row < 2) t.writeln('  ---+---+---');
    }
    t.writeln('');
  }

  // Check for winner
  function checkWinner() {
    for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (board[a] !== ' ' && board[a] === board[b] && board[b] === board[c]) {
        return board[a];
      }
    }
    return null;
  }

  // Check for draw
  function checkDraw() {
    return board.every(cell => cell !== ' ');
  }

  // Main game loop
  async function playGame() {
    while (!gameOver) {
      drawBoard();

      // Show current player
      const playerColor = currentPlayer === 'X' ? t.style.red : t.style.blue;
      t.writeln('  Player ' + playerColor(t.style.bold(currentPlayer)) + "'s turn");
      t.writeln('  Press 1-9 to place mark, Q to quit');
      t.writeln('');

      // Read key
      const keyResult = await t.readKey();
      const key = keyResult.key.toLowerCase();

      // Handle quit
      if (key === 'q') {
        t.clear();
        t.writeln('');
        t.writeln(t.style.yellow('  Game quit. Thanks for playing!'));
        t.writeln('');
        t.exit(0);
      }

      // Handle move
      const pos = parseInt(key);
      if (pos >= 1 && pos <= 9) {
        const idx = pos - 1;
        if (board[idx] === ' ') {
          board[idx] = currentPlayer;

          // Check for winner
          const winner = checkWinner();
          if (winner) {
            drawBoard();
            const winColor = winner === 'X' ? t.style.red : t.style.blue;
            t.writeln('  ' + t.style.bold(t.style.green('★ WINNER: Player ' + winColor(winner) + '! ★')));
            gameOver = true;
          } else if (checkDraw()) {
            drawBoard();
            t.writeln('  ' + t.style.bold(t.style.yellow("It's a draw!")));
            gameOver = true;
          } else {
            // Switch player
            currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
          }
        }
      }
    }

    // Ask to play again
    t.writeln('');
    t.writeln('  Press R to play again, any other key to quit');

    const replayKey = await t.readKey();
    if (replayKey.key.toLowerCase() === 'r') {
      // Reset game
      board = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '];
      currentPlayer = 'X';
      gameOver = false;
      await playGame();
    } else {
      t.clear();
      t.writeln('');
      t.writeln(t.style.green('  Thanks for playing tic-tac-toe!'));
      t.writeln('');
    }
  }

  // Start the game
  await playGame();
  t.exit(0);
})
`);

    // Create /usr/share/tronos directory for system documentation
    this.mkdir('/usr/share/tronos', true);

    // Create AI context documentation file for user reference
    this.write('/usr/share/tronos/ai-context.md',
`# TronOS AI Context Documentation

This file documents the Terminal API and executable format for TronOS.
AI assistants use this information when generating .trx programs.

## Terminal API (t.*)

Your code runs in an async function with parameter \`t\` (SandboxTerminalAPI).

### Output
- \`t.write(text)\` - Write without newline
- \`t.writeln(text)\` - Write with newline
- \`t.clear()\` - Clear terminal screen
- \`t.clearLine()\` - Clear current line

### Cursor Control
- \`t.moveTo(x, y)\` - Move to absolute position (0-indexed)
- \`t.moveBy(dx, dy)\` - Move relative to current
- \`t.getCursor()\` - Returns { x, y }
- \`t.getSize()\` - Returns { cols, rows }

### Input (all async)
- \`await t.readLine(prompt?)\` - Read line with optional prompt
- \`await t.readKey()\` - Returns { key, domEvent? }
- \`await t.readChar()\` - Read single printable character

### Styling (t.style.*)
- \`t.style.bold(text)\`, \`t.style.dim(text)\`, \`t.style.italic(text)\`, \`t.style.underline(text)\`
- \`t.style.red(text)\`, \`t.style.green(text)\`, \`t.style.yellow(text)\`, \`t.style.blue(text)\`
- \`t.style.magenta(text)\`, \`t.style.cyan(text)\`, \`t.style.white(text)\`, \`t.style.gray(text)\`

### Control
- \`t.exit(code?)\` - Exit program (default: 0)
- \`await t.sleep(ms)\` - Pause execution

### Context (read-only)
- \`t.args\` - string[] - command-line arguments
- \`t.env\` - { [key]: string } - environment variables
- \`t.cwd\` - string - current working directory

### Filesystem (t.fs.*)
- \`t.fs.read(path)\`, \`t.fs.write(path, content)\`, \`t.fs.append(path, content)\`
- \`t.fs.exists(path)\`, \`t.fs.list(path)\`, \`t.fs.mkdir(path)\`, \`t.fs.remove(path)\`
- \`t.fs.stat(path)\`, \`t.fs.cwd()\`, \`t.fs.resolve(path)\`
- \`t.fs.isFile(path)\`, \`t.fs.isDirectory(path)\`

### Network (t.net.*)
- \`await t.net.fetch(url, options?)\` - Same as browser fetch()

### Subprocess Execution
- \`await t.exec(command)\` - Returns { stdout, stderr, exitCode }

## Executable Format (.trx)

\`\`\`javascript
// @name: program-name          // REQUIRED
// @description: Brief desc     // Optional
// @version: 1.0.0              // Optional
// @author: @ai                 // Optional

async function main(t) {
  t.writeln('Hello!');
}
\`\`\`

## Example: Interactive Input

\`\`\`javascript
// @name: greet
// @description: Interactive greeting

async function main(t) {
  const name = await t.readLine('Enter name: ');
  t.writeln(t.style.green(\`Hello, \${name}!\`));
}
\`\`\`

For more examples, run: cat /bin/*.trx
`);

    // Create update mechanism concept document
    this.write('/usr/share/tronos/update-concept.md',
`# TronOS Update Mechanism

## Overview

The \`update\` command allows existing TronOS instances to upgrade to newer
versions while preserving user modifications. It integrates with timewarp
(file versioning) to safely snapshot files before updating, and uses the
existing merge infrastructure for conflict resolution.

## How It Works

### 1. Check Phase
\`\`\`
update              # Preview what would change
update --dry-run    # Same as above (explicit dry-run)
\`\`\`
Compares current system files against the latest defaults to identify:
- New files added in the update
- Modified system files (changed upstream)
- User-modified files (potential conflicts)

### 2. Apply Phase
\`\`\`
update --apply                # Apply with interactive conflict resolution
update --apply --skip         # Keep user changes on conflicts
update --apply --overwrite    # Replace with system version on conflicts
\`\`\`

Before any changes are made:
1. A session snapshot is created (restorable via \`session restore\`)
2. Each modified file is versioned in timewarp (viewable via \`timewarp list\`)
3. New files are added silently
4. Conflicts are resolved according to the chosen strategy

### 3. Rollback
\`\`\`
update --rollback    # Show the most recent pre-update snapshot
session restore <snapshot-name>  # Restore entire session state
timewarp revert <file> <version> # Restore individual files
\`\`\`

## System Files vs User Files

System files are those installed by TronOS defaults:
- /bin/*.trx (default executables)
- /etc/motd (welcome message)
- /home/tronos/.profile (default profile)
- /usr/share/* (documentation and system data)

User-created files (outside these paths) are never touched during updates.

## Conflict Resolution Strategies

| Strategy      | Flag          | Behavior                                    |
|---------------|---------------|---------------------------------------------|
| Interactive   | (default)     | Prompt for each conflicting file            |
| Skip          | --skip        | Keep user's version, don't update           |
| Overwrite     | --overwrite   | Replace with new version (old saved in timewarp) |

## Update History

All updates are logged in \`/var/log/update.log\`. View with:
\`\`\`
update --history
cat /var/log/update.log
\`\`\`

## Architecture

The update mechanism reuses existing TronOS infrastructure:
- **timewarp**: File version snapshots before modification
- **session snapshots**: Full session state backup before update
- **merge infrastructure**: Conflict detection and resolution
- **DiskImage format**: Represents both current and target state

## Future Enhancements

- Remote update checking (fetch latest version manifest from server)
- Incremental updates (only download changed files)
- Package-aware updates (update tpkg packages alongside system)
- Update channels (stable, beta, dev)
`);
  }

  /**
   * Initialize version history for default files so they can be reverted
   * to their original state via timewarp.
   */
  private async initDefaultVersions(): Promise<void> {
    // All default files that should have an initial version saved
    const defaultFiles = [
      '/bin/help.trx',
      '/bin/countdown.trx',
      '/bin/tictactoe.trx',
    ];

    for (const filePath of defaultFiles) {
      try {
        const hasHistory = await hasVersionHistory(this.namespace, filePath);
        if (!hasHistory) {
          const node = this.nodes.get(filePath);
          if (node && node.type === 'file') {
            await saveVersion(this.namespace, filePath, (node as FileNode).content, {
              message: 'Initial system version',
              author: 'system',
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to init version history for ${filePath}:`, err);
      }
    }
  }

  /**
   * Get the current working directory.
   * @returns Absolute path of the current working directory
   */
  public cwd(): string {
    return this._cwd;
  }

  /**
   * Resolve a path to an absolute path.
   *
   * @param p - Path to resolve (absolute or relative to cwd)
   * @returns Normalized absolute path
   *
   * @example
   * vfs.chdir('/home/user');
   * vfs.resolve('file.txt');    // '/home/user/file.txt'
   * vfs.resolve('../etc/motd'); // '/home/etc/motd'
   * vfs.resolve('/bin/ls');     // '/bin/ls'
   */
  public resolve(p: string): string {
    if (path.isAbsolute(p)) {
      return path.normalize(p);
    }
    return path.normalize(path.join(this._cwd, p));
  }

  /**
   * Change the current working directory.
   *
   * @param p - Path to change to (absolute or relative)
   * @throws Error if path does not exist or is not a directory
   */
  public chdir(p: string): void {
    const newPath = this.resolve(p);
    const node = this.nodes.get(newPath);

    if (!node) {
      throw new Error(`chdir: no such file or directory: ${p}`);
    }

    if (node.type !== 'directory') {
      throw new Error(`chdir: not a directory: ${p}`);
    }

    this._cwd = newPath;
  }

  /**
   * Check if a path exists.
   *
   * @param p - Path to check
   * @returns True if the path exists (file or directory)
   */
  public exists(p: string): boolean {
    const resolvedPath = this.resolve(p);
    // Check for /proc paths
    if (isProcPath(resolvedPath)) {
      return isProcDirectory(resolvedPath) || getProcGenerator(resolvedPath) !== undefined;
    }
    // Check for /dev paths
    if (isDevPath(resolvedPath)) {
      return isDevDirectory(resolvedPath) || isDevFile(resolvedPath);
    }
    // Check for /docs paths (virtual documentation)
    if (isDocsPath(resolvedPath)) {
      return isDocsDirectory(resolvedPath) || isDocsFile(resolvedPath);
    }
    return this.nodes.has(resolvedPath);
  }

  /**
   * Get metadata for a path.
   *
   * @param p - Path to stat
   * @returns Copy of the FSNode with name, type, parent, and metadata
   * @throws Error if path does not exist
   */
  public stat(p: string): FSNode {
    const resolvedPath = this.resolve(p);

    // Handle /proc paths
    if (isProcPath(resolvedPath)) {
      const name = path.basename(resolvedPath) || 'proc';
      const parent = path.dirname(resolvedPath);
      const now = Date.now();

      if (isProcDirectory(resolvedPath)) {
        return {
          name,
          type: 'directory',
          parent: parent === resolvedPath ? null : parent,
          meta: { createdAt: now, updatedAt: now }
        } as DirectoryNode;
      }
      if (getProcGenerator(resolvedPath)) {
        return {
          name,
          type: 'file',
          parent,
          meta: { createdAt: now, updatedAt: now }
        } as FSNode;
      }
      throw new Error(`stat: no such file or directory: ${p}`);
    }

    // Handle /dev paths
    if (isDevPath(resolvedPath)) {
      const name = path.basename(resolvedPath) || 'dev';
      const parent = path.dirname(resolvedPath);
      const now = Date.now();

      if (isDevDirectory(resolvedPath)) {
        return {
          name,
          type: 'directory',
          parent: parent === resolvedPath ? null : parent,
          meta: { createdAt: now, updatedAt: now }
        } as DirectoryNode;
      }
      if (isDevFile(resolvedPath)) {
        return {
          name,
          type: 'file',
          parent,
          meta: { createdAt: now, updatedAt: now }
        } as FSNode;
      }
      throw new Error(`stat: no such file or directory: ${p}`);
    }

    // Handle /docs paths (virtual documentation files)
    if (isDocsPath(resolvedPath)) {
      const name = path.basename(resolvedPath) || 'docs';
      const parent = path.dirname(resolvedPath);
      const now = Date.now();

      if (isDocsDirectory(resolvedPath)) {
        return {
          name,
          type: 'directory',
          parent: parent === resolvedPath ? null : parent,
          meta: { createdAt: now, updatedAt: now }
        } as DirectoryNode;
      }
      if (isDocsFile(resolvedPath)) {
        // Mark documentation files as 'virtual' type
        return {
          name,
          type: 'virtual',
          parent,
          meta: { createdAt: now, updatedAt: now }
        } as FSNode;
      }
      throw new Error(`stat: no such file or directory: ${p}`);
    }

    const node = this.nodes.get(resolvedPath);
    if (!node) {
      throw new Error(`stat: no such file or directory: ${p}`);
    }
    return { ...node }; // Return a copy
  }

  /**
   * Read the contents of a file.
   *
   * For /dev devices (like /dev/clipboard), this may return a Promise.
   * For /proc paths, content is generated dynamically.
   *
   * @param p - Path to the file
   * @returns File contents as string, or Promise for async devices
   * @throws Error if path doesn't exist, is a directory, or device is not readable
   */
  public read(p: string): string | Promise<string> {
    const resolvedPath = this.resolve(p);

    // Check if this is a /proc path
    if (isProcPath(resolvedPath)) {
      // Check if it's a /proc directory
      if (isProcDirectory(resolvedPath)) {
        throw new Error(`read: not a file: ${p}`);
      }
      // Try to get the generator for this path
      const generator = getProcGenerator(resolvedPath);
      if (generator) {
        return generator();
      }
      throw new Error(`read: no such file or directory: ${p}`);
    }

    // Check if this is a /dev path
    if (isDevPath(resolvedPath)) {
      // Check if it's a /dev directory
      if (isDevDirectory(resolvedPath)) {
        throw new Error(`read: not a file: ${p}`);
      }
      // Try to get the handler for this device
      const handler = getDevHandler(resolvedPath);
      if (handler) {
        if (!handler.readable || !handler.read) {
          throw new Error(`read: device not readable: ${p}`);
        }
        return handler.read();
      }
      throw new Error(`read: no such file or directory: ${p}`);
    }

    // Check if this is a /docs path (virtual documentation)
    if (isDocsPath(resolvedPath)) {
      // Check if it's a /docs directory
      if (isDocsDirectory(resolvedPath)) {
        throw new Error(`read: not a file: ${p}`);
      }
      // Try to get the generator for this docs file
      const generator = getDocsGenerator(resolvedPath);
      if (generator) {
        return generator(); // Returns Promise<string>
      }
      throw new Error(`read: no such file or directory: ${p}`);
    }

    const node = this.nodes.get(resolvedPath);

    if (!node) {
      throw new Error(`read: no such file or directory: ${p}`);
    }

    if (node.type !== 'file') {
      throw new Error(`read: not a file: ${p}`);
    }

    return (node as FileNode).content;
  }

  /**
   * Synchronous read for regular filesystem paths only.
   * Does not support /dev or /proc paths.
   *
   * @param p - Path to the file
   * @returns File contents as string
   * @throws Error if path doesn't exist, is a directory, or is a special path
   */
  public readSync(p: string): string {
    const resolvedPath = this.resolve(p);

    // Don't support /proc, /dev, or /docs in sync mode
    if (isProcPath(resolvedPath)) {
      throw new Error(`readSync: cannot read /proc paths synchronously: ${p}`);
    }
    if (isDevPath(resolvedPath)) {
      throw new Error(`readSync: cannot read /dev paths synchronously: ${p}`);
    }
    if (isDocsPath(resolvedPath)) {
      throw new Error(`readSync: cannot read /docs paths synchronously: ${p}`);
    }

    const node = this.nodes.get(resolvedPath);

    if (!node) {
      throw new Error(`readSync: no such file or directory: ${p}`);
    }

    if (node.type !== 'file') {
      throw new Error(`readSync: not a file: ${p}`);
    }

    return (node as FileNode).content;
  }

  /**
   * Write content to a file (creates if doesn't exist, overwrites if exists).
   *
   * For /dev devices (like /dev/clipboard), this may return a Promise.
   * Creates parent directories implicitly if they exist.
   *
   * @param p - Path to the file
   * @param content - Content to write
   * @throws Error if parent directory doesn't exist, path is a directory, or device is not writable
   */
  public write(p: string, content: string): void | Promise<void> {
    const resolvedPath = this.resolve(p);

    // Check if this is a /proc path (writable proc files like /proc/theme/colors/*)
    if (isProcPath(resolvedPath)) {
      if (isProcDirectory(resolvedPath)) {
        throw new Error(`write: not a file: ${p}`);
      }
      const writeHandler = getProcWriteHandler(resolvedPath);
      if (writeHandler) {
        writeHandler(content);
        return;
      }
      if (getProcGenerator(resolvedPath)) {
        throw new Error(`write: read-only proc file: ${p}`);
      }
      throw new Error(`write: no such file or directory: ${p}`);
    }

    // Check if this is a /dev path
    if (isDevPath(resolvedPath)) {
      // Check if it's a /dev directory
      if (isDevDirectory(resolvedPath)) {
        throw new Error(`write: not a file: ${p}`);
      }
      // Try to get the handler for this device
      const handler = getDevHandler(resolvedPath);
      if (handler) {
        if (!handler.writable || !handler.write) {
          throw new Error(`write: device not writable: ${p}`);
        }
        return handler.write(content);
      }
      throw new Error(`write: no such device: ${p}`);
    }

    // Prevent writing to /docs (read-only virtual filesystem)
    if (isDocsPath(resolvedPath)) {
      throw new Error(`write: /docs is a read-only virtual filesystem: ${p}`);
    }

    const dirname = path.dirname(resolvedPath);
    const basename = path.basename(resolvedPath);

    const parentNode = this.nodes.get(dirname);

    if (!parentNode || parentNode.type !== 'directory') {
      throw new Error(`write: no such file or directory: ${dirname}`);
    }

    const existingNode = this.nodes.get(resolvedPath);

    if (existingNode) {
      if (existingNode.type !== 'file') {
        throw new Error(`write: not a file: ${p}`);
      }
      // Overwrite existing file
      (existingNode as FileNode).content = content;
      existingNode.meta.updatedAt = Date.now();
    } else {
      // Create new file
      const newNode: FileNode = {
        name: basename,
        type: 'file',
        parent: dirname,
        content,
        meta: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
      this.nodes.set(resolvedPath, newNode);
      // Guard against duplicate children entries
      if (!(parentNode as DirectoryNode).children.includes(basename)) {
        (parentNode as DirectoryNode).children.push(basename);
      }
      parentNode.meta.updatedAt = Date.now();
    }

    // Persist to IndexedDB
    this.persistNode(resolvedPath);
    this.persistNode(dirname); // Also persist parent (updated children list)
  }

  /**
   * Append content to a file (creates if doesn't exist).
   *
   * @param p - Path to the file
   * @param content - Content to append
   * @throws Error if path is a directory
   */
  public append(p: string, content: string): void {
    const resolvedPath = this.resolve(p);
    const node = this.nodes.get(resolvedPath);

    if (node && node.type === 'file') {
      (node as FileNode).content += content;
      node.meta.updatedAt = Date.now();
      // Persist to IndexedDB
      this.persistNode(resolvedPath);
    } else if (!node) {
      this.write(p, content);
    } else if (node && node.type !== 'file') {
      throw new Error(`append: not a file: ${p}`);
    }
  }

  /**
   * Check if a path is a directory.
   *
   * @param p - Path to check
   * @returns True if path exists and is a directory
   */
  public isDirectory(p: string): boolean {
    const resolvedPath = this.resolve(p);
    // Handle /proc paths
    if (isProcPath(resolvedPath)) {
      return isProcDirectory(resolvedPath);
    }
    // Handle /dev paths
    if (isDevPath(resolvedPath)) {
      return isDevDirectory(resolvedPath);
    }
    // Handle /docs paths
    if (isDocsPath(resolvedPath)) {
      return isDocsDirectory(resolvedPath);
    }
    const node = this.nodes.get(resolvedPath);
    return !!node && node.type === 'directory';
  }

  /**
   * Check if a path is a file.
   *
   * @param p - Path to check
   * @returns True if path exists and is a file (not a directory)
   */
  public isFile(p: string): boolean {
    const resolvedPath = this.resolve(p);
    // Handle /proc paths
    if (isProcPath(resolvedPath)) {
      return getProcGenerator(resolvedPath) !== undefined;
    }
    // Handle /dev paths
    if (isDevPath(resolvedPath)) {
      return isDevFile(resolvedPath);
    }
    // Handle /docs paths (virtual files are still "files" for this check)
    if (isDocsPath(resolvedPath)) {
      return isDocsFile(resolvedPath);
    }
    const node = this.nodes.get(resolvedPath);
    return !!node && node.type === 'file';
  }

  /**
   * List the contents of a directory.
   *
   * @param p - Path to the directory
   * @returns Array of file and directory names in the directory
   * @throws Error if path doesn't exist or is not a directory
   */
  public list(p: string): string[] {
    const resolvedPath = this.resolve(p);

    // Handle /proc directories
    if (isProcPath(resolvedPath)) {
      const contents = listProcDirectory(resolvedPath);
      if (contents) {
        return [...contents];
      }
      // Not a directory - check if it's a file
      if (getProcGenerator(resolvedPath)) {
        throw new Error(`list: not a directory: ${p}`);
      }
      throw new Error(`list: no such directory: ${p}`);
    }

    // Handle /dev directories
    if (isDevPath(resolvedPath)) {
      const contents = listDevDirectory(resolvedPath);
      if (contents) {
        return [...contents];
      }
      // Not a directory - check if it's a device file
      if (isDevFile(resolvedPath)) {
        throw new Error(`list: not a directory: ${p}`);
      }
      throw new Error(`list: no such directory: ${p}`);
    }

    // Handle /docs directories
    if (isDocsPath(resolvedPath)) {
      const contents = listDocsDirectory(resolvedPath);
      if (contents) {
        return [...contents];
      }
      // Not a directory - check if it's a docs file
      if (isDocsFile(resolvedPath)) {
        throw new Error(`list: not a directory: ${p}`);
      }
      throw new Error(`list: no such directory: ${p}`);
    }

    const node = this.nodes.get(resolvedPath);

    if (!node || node.type !== 'directory') {
      throw new Error(`list: no such directory: ${p}`);
    }

    const children = [...(node as DirectoryNode).children];

    // When listing root directory, append virtual directories
    if (resolvedPath === '/') {
      // Add virtual directories if not already present
      if (!children.includes('proc')) children.push('proc');
      if (!children.includes('dev')) children.push('dev');
      if (!children.includes('docs')) children.push('docs');
    }

    return children;
  }

  /**
   * List directory contents with full metadata.
   *
   * @param p - Path to the directory
   * @returns Array of FSNode objects with name, type, parent, and metadata
   * @throws Error if path doesn't exist or is not a directory
   */
  public listDetailed(p: string): FSNode[] {
    const resolvedPath = this.resolve(p);

    // Handle /proc directories
    if (isProcPath(resolvedPath)) {
      const contents = listProcDirectory(resolvedPath);
      if (contents) {
        const now = Date.now();
        return contents.map(childName => {
          const childPath = path.join(resolvedPath, childName);
          const isDir = isProcDirectory(childPath);
          return {
            name: childName,
            type: isDir ? 'directory' : 'file',
            parent: resolvedPath,
            meta: { createdAt: now, updatedAt: now }
          } as FSNode;
        });
      }
      // Not a directory - check if it's a file
      if (getProcGenerator(resolvedPath)) {
        throw new Error(`listDetailed: not a directory: ${p}`);
      }
      throw new Error(`listDetailed: no such directory: ${p}`);
    }

    // Handle /dev directories
    if (isDevPath(resolvedPath)) {
      const contents = listDevDirectory(resolvedPath);
      if (contents) {
        const now = Date.now();
        return contents.map(childName => {
          return {
            name: childName,
            type: 'file', // All /dev entries are device files
            parent: resolvedPath,
            meta: { createdAt: now, updatedAt: now }
          } as FSNode;
        });
      }
      // Not a directory - check if it's a device file
      if (isDevFile(resolvedPath)) {
        throw new Error(`listDetailed: not a directory: ${p}`);
      }
      throw new Error(`listDetailed: no such directory: ${p}`);
    }

    // Handle /docs directories
    if (isDocsPath(resolvedPath)) {
      const contents = listDocsDirectory(resolvedPath);
      if (contents) {
        const now = Date.now();
        return contents.map(childName => {
          return {
            name: childName,
            type: 'virtual', // Mark /docs entries as virtual files
            parent: resolvedPath,
            meta: { createdAt: now, updatedAt: now }
          } as FSNode;
        });
      }
      // Not a directory - check if it's a docs file
      if (isDocsFile(resolvedPath)) {
        throw new Error(`listDetailed: not a directory: ${p}`);
      }
      throw new Error(`listDetailed: no such directory: ${p}`);
    }

    const node = this.nodes.get(resolvedPath);

    if (!node || node.type !== 'directory') {
      throw new Error(`listDetailed: no such directory: ${p}`);
    }

    const result = (node as DirectoryNode).children
      .map(childName => {
        const childPath = path.join(resolvedPath, childName);
        const childNode = this.nodes.get(childPath);
        if (!childNode) {
          // Orphaned child reference - skip it
          return null;
        }
        return { ...childNode };
      })
      .filter((n): n is FSNode => n !== null);

    // When listing root directory, append virtual directories
    if (resolvedPath === '/') {
      const now = Date.now();
      const existingNames = new Set(result.map(n => n.name));

      // Add /proc if not already present
      if (!existingNames.has('proc')) {
        result.push({
          name: 'proc',
          type: 'directory',
          parent: '/',
          meta: { createdAt: now, updatedAt: now }
        } as FSNode);
      }

      // Add /dev if not already present
      if (!existingNames.has('dev')) {
        result.push({
          name: 'dev',
          type: 'directory',
          parent: '/',
          meta: { createdAt: now, updatedAt: now }
        } as FSNode);
      }

      // Add /docs if not already present
      if (!existingNames.has('docs')) {
        result.push({
          name: 'docs',
          type: 'directory',
          parent: '/',
          meta: { createdAt: now, updatedAt: now }
        } as FSNode);
      }
    }

    return result;
  }

  /**
   * Create a directory.
   *
   * @param p - Path for the new directory
   * @param recursive - If true, create parent directories as needed
   * @throws Error if path already exists or parent doesn't exist (when not recursive)
   */
  public mkdir(p: string, recursive = false): void {
    const resolvedPath = this.resolve(p);
    if (this.nodes.has(resolvedPath)) {
      // Per POSIX: mkdir -p silently succeeds on existing directories
      if (recursive && this.nodes.get(resolvedPath)!.type === 'directory') {
        return;
      }
      throw new Error(`mkdir: file exists: ${p}`);
    }

    const dirname = path.dirname(resolvedPath);
    const basename = path.basename(resolvedPath);

    let parentNode = this.nodes.get(dirname);

    if (!parentNode) {
      if (recursive) {
        this.mkdir(dirname, true);
        parentNode = this.nodes.get(dirname);
      } else {
        throw new Error(`mkdir: no such file or directory: ${dirname}`);
      }
    }

    if (!parentNode) {
      // This should not happen if recursive creation is successful
      throw new Error(`mkdir: failed to create parent directory: ${dirname}`);
    }

    if (parentNode.type !== 'directory') {
        throw new Error(`mkdir: not a directory: ${dirname}`);
    }

    const newNode: DirectoryNode = {
      name: basename,
      type: 'directory',
      parent: dirname,
      children: [],
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    this.nodes.set(resolvedPath, newNode);
    // Guard against duplicate children entries
    if (!(parentNode as DirectoryNode).children.includes(basename)) {
      (parentNode as DirectoryNode).children.push(basename);
    }
    parentNode.meta.updatedAt = Date.now();

    // Persist to IndexedDB
    this.persistNode(resolvedPath);
    this.persistNode(dirname); // Also persist parent (updated children list)
  }

  /**
   * Remove a file or directory.
   *
   * @param p - Path to remove
   * @param recursive - If true, remove directory contents recursively
   * @throws Error if path doesn't exist or directory is not empty (when not recursive)
   */
  public remove(p: string, recursive = false): void {
    const resolvedPath = this.resolve(p);

    // Prevent removing /docs (read-only virtual filesystem)
    if (isDocsPath(resolvedPath)) {
      throw new Error(`remove: cannot remove virtual documentation: ${p}`);
    }

    const node = this.nodes.get(resolvedPath);

    if (!node) {
      throw new Error(`remove: no such file or directory: ${p}`);
    }

    if (node.type === 'directory' && (node as DirectoryNode).children.length > 0 && !recursive) {
      throw new Error(`remove: directory not empty: ${p}`);
    }

    // Recursively remove children
    if (node.type === 'directory' && recursive) {
      for (const childName of [...(node as DirectoryNode).children]) {
        const childPath = path.join(resolvedPath, childName);
        this.remove(childPath, true);
      }
    }

    // Remove from parent's children list
    const parentPath = node.parent;
    if (parentPath) {
      const parentNode = this.nodes.get(parentPath) as DirectoryNode;
      if (parentNode) {
        parentNode.children = parentNode.children.filter(child => child !== node.name);
        parentNode.meta.updatedAt = Date.now();
        // Persist updated parent
        this.persistNode(parentPath);
      }
    }

    this.nodes.delete(resolvedPath);

    // Delete from IndexedDB
    this.deletePersistedNode(resolvedPath);
  }

  /**
   * Copy a file or directory.
   *
   * @param src - Source path
   * @param dest - Destination path
   * @param recursive - If true, copy directories recursively
   * @throws Error if source doesn't exist, destination exists, or source is directory without recursive
   */
  public copy(src: string, dest: string, recursive = false): void {
    const srcPath = this.resolve(src);
    const destPath = this.resolve(dest);
    
    const srcNode = this.nodes.get(srcPath);
    if (!srcNode) {
      throw new Error(`copy: no such file or directory: ${src}`);
    }

    if (this.nodes.has(destPath)) {
      throw new Error(`copy: destination already exists: ${dest}`);
    }

    if (srcNode.type === 'directory') {
      if (!recursive) {
        throw new Error(`copy: source is a directory (and recursive option is not used): ${src}`);
      }
      
      this.mkdir(destPath);
      for (const childName of (srcNode as DirectoryNode).children) {
        const srcChildPath = path.join(srcPath, childName);
        const destChildPath = path.join(destPath, childName);
        this.copy(srcChildPath, destChildPath, true);
      }
    } else { // 'file'
      const content = (srcNode as FileNode).content;
      this.write(destPath, content);
    }
  }

  /**
   * Move (rename) a file or directory.
   *
   * @param src - Source path
   * @param dest - Destination path
   * @throws Error if source doesn't exist, destination exists, or destination parent doesn't exist
   */
  public move(src: string, dest: string): void {
    const srcPath = this.resolve(src);
    const destPath = this.resolve(dest);

    const srcNode = this.nodes.get(srcPath);
    if (!srcNode) {
      throw new Error(`move: no such file or directory: ${src}`);
    }

    if (this.nodes.has(destPath)) {
      throw new Error(`move: destination already exists: ${dest}`);
    }

    const destDir = path.dirname(destPath);
    if (!this.nodes.has(destDir) || this.nodes.get(destDir)!.type !== 'directory') {
        throw new Error(`move: no such directory: ${destDir}`);
    }

    // This is a naive implementation. A more robust one would avoid the double work.
    // Copy to new location (recursively)
    this.copy(srcPath, destPath, true);

    // Remove from old location
    this.remove(srcPath, true);
  }

  /**
   * Persist a single node to storage.
   * In CLI mode, uses filesystem storage directly.
   * In browser mode, uses batched IndexedDB operations.
   */
  private persistNode(p: string): void {
    const node = this.nodes.get(p);
    if (!node) return;

    // Use storage abstraction if available (CLI mode)
    if (this.storage) {
      // In CLI mode, persist directly (no batching needed for filesystem)
      this.storage.saveFile(this.namespace, p, node).catch(err => {
        console.warn('Failed to persist node:', err);
      });
      return;
    }

    // Use batch manager for IndexedDB (browser mode)
    if (this.batchManager) {
      this.batchManager.save(p, node);
    }
  }

  /**
   * Delete a persisted node from storage.
   * In CLI mode, uses filesystem storage directly.
   * In browser mode, uses batched IndexedDB operations.
   */
  private deletePersistedNode(p: string): void {
    // Use storage abstraction if available (CLI mode)
    if (this.storage) {
      this.storage.deleteFile(this.namespace, p).catch(err => {
        console.warn('Failed to delete persisted node:', err);
      });
      return;
    }

    // Use batch manager for IndexedDB (browser mode)
    if (this.batchManager) {
      this.batchManager.delete(p);
    }
  }

  /**
   * Force synchronize the entire filesystem to storage.
   * This is useful for batch operations or when you want to ensure
   * everything is persisted (e.g., before exporting a session)
   */
  public async sync(): Promise<void> {
    // Use storage abstraction if available (CLI mode)
    if (this.storage) {
      await this.storage.syncFilesystem(this.namespace, this.nodes);
      return;
    }

    // Use IndexedDB (browser mode)
    if (typeof indexedDB === 'undefined') return;

    // First, flush any pending batched operations
    if (this.batchManager) {
      await this.batchManager.waitForPending();
    }

    await syncFilesystem(this.namespace, this.nodes);
  }

  /**
   * Flush any pending persistence operations
   * Use this to ensure data integrity before critical operations
   */
  public async flushPersistence(): Promise<void> {
    if (this.batchManager) {
      await this.batchManager.flush();
    }
  }

  /**
   * Check if there are pending persistence operations
   */
  public hasPendingPersistence(): boolean {
    return this.batchManager?.hasPending() ?? false;
  }

  /**
   * Verify data integrity between in-memory and persisted state
   * Returns true if data is consistent, false otherwise
   */
  public async verifyIntegrity(): Promise<boolean> {
    // First, flush any pending operations
    await this.flushPersistence();

    let persistedNodes: Map<string, FSNode>;

    // Use storage abstraction if available (CLI mode)
    if (this.storage) {
      persistedNodes = await this.storage.loadFilesystem(this.namespace);
    }
    // Use IndexedDB (browser mode)
    else if (typeof indexedDB !== 'undefined') {
      persistedNodes = await loadFilesystem(this.namespace);
    } else {
      // No storage available, nothing to verify
      return true;
    }

    // Compare node counts
    if (persistedNodes.size !== this.nodes.size) {
      console.warn(`Integrity check failed: node count mismatch (memory: ${this.nodes.size}, persisted: ${persistedNodes.size})`);
      return false;
    }

    // Compare each node
    for (const [path, memNode] of this.nodes.entries()) {
      const persistedNode = persistedNodes.get(path);
      if (!persistedNode) {
        console.warn(`Integrity check failed: missing persisted node for ${path}`);
        return false;
      }

      // Compare basic properties
      if (memNode.type !== persistedNode.type ||
          memNode.name !== persistedNode.name) {
        console.warn(`Integrity check failed: node mismatch at ${path}`);
        return false;
      }

      // For files, compare content
      if (memNode.type === 'file' && persistedNode.type === 'file') {
        if ((memNode as FileNode).content !== (persistedNode as FileNode).content) {
          console.warn(`Integrity check failed: content mismatch at ${path}`);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Switch to a different namespace (used when switching sessions).
   * Flushes pending writes for the current namespace, then reloads
   * the filesystem from storage for the new namespace.
   */
  public async switchNamespace(newNamespace: string): Promise<void> {
    // Flush pending writes for current namespace
    await this.flushPersistence();
    if (this.batchManager) {
      await this.batchManager.waitForPending();
    }

    // Update namespace
    this.namespace = newNamespace;

    // Reset state
    this.nodes = new Map();
    this.nodes.set('/', {
      name: '/',
      type: 'directory',
      parent: null,
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      children: [],
    } as DirectoryNode);
    this._cwd = '/';
    this.initialized = false;

    // Update batch manager for new namespace
    if (typeof indexedDB !== 'undefined') {
      this.batchManager = getBatchManager(this.namespace);
    }

    // Reinitialize with new namespace data
    await this.init();
  }
}
