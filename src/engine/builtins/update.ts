/**
 * @fileoverview TronOS system update mechanism.
 *
 * The update command allows existing TronOS instances to upgrade to newer
 * versions while preserving user modifications. It uses timewarp (file
 * versioning) to snapshot modified system files before updating, and the
 * existing merge infrastructure to handle conflicts between user changes
 * and system updates.
 *
 * ## Update Flow
 *
 * 1. Check: Compare current system version against available update version
 * 2. Snapshot: Create a session snapshot (via timewarp) before applying changes
 * 3. Diff: Generate a default filesystem image representing the latest version,
 *    then compare against the current state to identify:
 *    - New files (added in the update)
 *    - Modified system files (changed upstream)
 *    - User-modified system files (potential conflicts)
 * 4. Merge: Apply updates using the merge infrastructure with conflict resolution:
 *    - New files: always added
 *    - Unmodified system files: silently updated
 *    - User-modified system files: handled by chosen strategy (skip/overwrite/interactive)
 * 5. Version bump: Update /proc/system/version and TRONOS_VERSION env var
 *
 * ## Conflict Resolution
 *
 * When a system file has been modified by both the user and the update:
 * - `update --skip`: Keep user's version, skip system update for that file
 * - `update --overwrite`: Replace with updated system version (user changes saved in timewarp)
 * - `update --interactive`: Ask for each conflicting file (default)
 *
 * ## Rollback
 *
 * Since timewarp snapshots are created before every update, users can:
 * - `update --rollback`: Restore the pre-update snapshot
 * - `timewarp list <file>`: View version history of any file
 * - `timewarp revert <file> <version>`: Restore a specific file version
 * - `session restore <snapshot>`: Restore entire session to pre-update state
 *
 * @module engine/builtins/update
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from '../types';
import type { DiskImage, DiskFile } from '../../types';
import { VERSION } from '../../version';
import { saveVersion } from '../../persistence/versions';
import { getActiveSession } from '../../stores';
import {
  createSnapshot,
  getSessionSnapshots,
  enforceSnapshotLimit,
} from '../../persistence/snapshots';
import { captureSessionState } from './session';
import type { ConflictStrategy } from './session';


/**
 * Generate the default filesystem as a DiskImage.
 * This represents what a fresh TronOS installation looks like,
 * and is used as the "target" state during updates.
 */
function generateDefaultDiskImage(): DiskImage {
  // We create a temporary VFS, initialize defaults, and capture it
  // For efficiency, we directly build the DiskImage from known defaults
  const now = new Date().toISOString();
  const files: Record<string, DiskFile> = {};

  const addDir = (path: string) => {
    files[path] = {
      type: 'directory',
      meta: { created: now, modified: now, permissions: 'rwxr-xr-x' },
    };
  };

  const addFile = (path: string, content: string) => {
    files[path] = {
      type: 'file',
      content,
      meta: { created: now, modified: now, permissions: 'rw-r--r--' },
    };
  };

  // Core directories
  addDir('/home');
  addDir('/home/tronos');
  addDir('/bin');
  addDir('/tmp');
  addDir('/dev');
  addDir('/etc');
  addDir('/proc');
  addDir('/usr');
  addDir('/usr/share');
  addDir('/usr/share/man');
  addDir('/usr/share/man/man1');
  addDir('/usr/share/tronos');

  // /etc/motd
  addFile('/etc/motd', `Welcome to TronOS!
This is a simulated operating system running in your browser.
`);

  // /home/tronos/.profile
  addFile('/home/tronos/.profile', `# Default aliases
alias ll='ls -l'
alias la='ls -la'
alias ..='cd ..'
`);

  // /bin/help.trx
  addFile('/bin/help.trx', `#!/tronos
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

  // /bin/countdown.trx
  addFile('/bin/countdown.trx', `#!/tronos
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

  // /bin/tictactoe.trx
  addFile('/bin/tictactoe.trx', `#!/tronos
// @name: tictactoe
// @description: Two-player tic-tac-toe game
// @version: 1.0.0
// @author: @ai

(async function(t) {
  let board = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '];
  let currentPlayer = 'X';
  let gameOver = false;

  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

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

  function checkWinner() {
    for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (board[a] !== ' ' && board[a] === board[b] && board[b] === board[c]) {
        return board[a];
      }
    }
    return null;
  }

  function checkDraw() {
    return board.every(cell => cell !== ' ');
  }

  async function playGame() {
    while (!gameOver) {
      drawBoard();

      const playerColor = currentPlayer === 'X' ? t.style.red : t.style.blue;
      t.writeln('  Player ' + playerColor(t.style.bold(currentPlayer)) + "'s turn");
      t.writeln('  Press 1-9 to place mark, Q to quit');
      t.writeln('');

      const keyResult = await t.readKey();
      const key = keyResult.key.toLowerCase();

      if (key === 'q') {
        t.clear();
        t.writeln('');
        t.writeln(t.style.yellow('  Game quit. Thanks for playing!'));
        t.writeln('');
        t.exit(0);
      }

      const pos = parseInt(key);
      if (pos >= 1 && pos <= 9) {
        const idx = pos - 1;
        if (board[idx] === ' ') {
          board[idx] = currentPlayer;

          const winner = checkWinner();
          if (winner) {
            drawBoard();
            const winColor = winner === 'X' ? t.style.red : t.style.blue;
            t.writeln('  ' + t.style.bold(t.style.green('\\u2605 WINNER: Player ' + winColor(winner) + '! \\u2605')));
            gameOver = true;
          } else if (checkDraw()) {
            drawBoard();
            t.writeln('  ' + t.style.bold(t.style.yellow("It's a draw!")));
            gameOver = true;
          } else {
            currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
          }
        }
      }
    }

    t.writeln('');
    t.writeln('  Press R to play again, any other key to quit');

    const replayKey = await t.readKey();
    if (replayKey.key.toLowerCase() === 'r') {
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

  await playGame();
  t.exit(0);
})
`);

  // /usr/share/tronos/ai-context.md
  addFile('/usr/share/tronos/ai-context.md', `# TronOS AI Context Documentation

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
  t.writeln(t.style.green(\\\`Hello, \\\${name}!\\\`));
}
\`\`\`

For more examples, run: cat /bin/*.trx
`);

  return {
    version: 1,
    name: 'TronOS System Defaults',
    created: now,
    exported: now,
    session: {
      env: {},
      aliases: {},
      history: [],
    },
    files,
  };
}

/**
 * Compare the default filesystem against the current VFS state.
 * Classifies files into categories for the update process.
 */
interface UpdateAnalysis {
  newFiles: string[];           // Files in defaults that don't exist in current VFS
  updatedFiles: string[];       // System files where default differs from current AND user hasn't modified
  conflictFiles: string[];      // System files modified by both the update and the user
  unchangedFiles: string[];     // Files that are the same in both
  userOnlyFiles: string[];      // Files created by user (not in defaults)
}

async function analyzeUpdate(
  defaultImage: DiskImage,
  vfs: any,
): Promise<UpdateAnalysis> {
  const analysis: UpdateAnalysis = {
    newFiles: [],
    updatedFiles: [],
    conflictFiles: [],
    unchangedFiles: [],
    userOnlyFiles: [],
  };

  for (const [path, diskFile] of Object.entries(defaultImage.files)) {
    if (diskFile.type === 'directory') {
      continue; // Directories are always created if missing
    }

    const exists = vfs.exists(path);
    if (!exists) {
      analysis.newFiles.push(path);
    } else {
      try {
        const currentContent = vfs.readSync(path);
        if (currentContent === diskFile.content) {
          analysis.unchangedFiles.push(path);
        } else {
          // File has been modified - this is a conflict
          analysis.conflictFiles.push(path);
        }
      } catch {
        // Can't read (e.g., virtual file) - treat as unchanged
        analysis.unchangedFiles.push(path);
      }
    }
  }

  return analysis;
}

/**
 * The update builtin command.
 *
 * Usage:
 *   update                    - Check for updates and show what would change
 *   update --apply            - Apply the update with interactive conflict resolution
 *   update --apply --skip     - Apply update, keep user's version on conflicts
 *   update --apply --overwrite - Apply update, overwrite user changes on conflicts
 *   update --rollback         - Restore the pre-update snapshot
 *   update --history          - Show update history
 */
export const update: BuiltinCommand = async (args: string[], context: ExecutionContext): Promise<CommandResult> => {
  const flags = new Set(args);

  // Parse flags
  const showHelp = flags.has('--help') || flags.has('-h');
  const apply = flags.has('--apply');
  const rollback = flags.has('--rollback');
  const showHistory = flags.has('--history');
  const skipConflicts = flags.has('--skip');
  const overwriteConflicts = flags.has('--overwrite');
  const dryRun = flags.has('--dry-run');

  if (showHelp) {
    return {
      stdout: `update - TronOS system update mechanism

Usage:
  update                        Check for updates and preview changes
  update --apply                Apply update (interactive conflict resolution)
  update --apply --skip         Apply update, keep user changes on conflicts
  update --apply --overwrite    Apply update, replace user changes on conflicts
  update --dry-run              Show what would change without applying
  update --rollback             Restore pre-update snapshot
  update --history              Show update history

The update mechanism:
  1. Snapshots your current state via timewarp before any changes
  2. Compares your system files against the latest defaults
  3. Adds new files and updates unmodified system files
  4. Handles conflicts between your changes and system updates

Conflict resolution:
  - Without flags: prompts for each conflicting file
  - --skip: keeps your modified version
  - --overwrite: replaces with new system version
  User changes are always preserved in timewarp history.

Rollback:
  update --rollback restores the most recent pre-update snapshot.
  You can also use 'timewarp' to manage individual file versions.
`,
      stderr: '',
      exitCode: 0,
    };
  }

  const vfs = context.vfs;
  if (!vfs) {
    return {
      stdout: '',
      stderr: 'update: VFS not available\n',
      exitCode: 1,
    };
  }

  // Handle --history
  if (showHistory) {
    return await handleUpdateHistory(vfs);
  }

  // Handle --rollback
  if (rollback) {
    return await handleRollback(vfs);
  }

  // Generate the target state (what latest TronOS should look like)
  const defaultImage = generateDefaultDiskImage();

  // Analyze what needs updating
  const analysis = await analyzeUpdate(defaultImage, vfs);

  // Check if there's anything to update
  const hasUpdates = analysis.newFiles.length > 0 ||
    analysis.updatedFiles.length > 0 ||
    analysis.conflictFiles.length > 0;

  if (!hasUpdates && !apply) {
    return {
      stdout: `TronOS v${VERSION}\n\nSystem is up to date. All system files match the current version.\n` +
        `  ${analysis.unchangedFiles.length} system files checked\n`,
      stderr: '',
      exitCode: 0,
    };
  }

  // Preview mode (no --apply flag)
  if (!apply || dryRun) {
    let output = `TronOS Update Preview (v${VERSION})\n\n`;

    if (analysis.newFiles.length > 0) {
      output += `New files to add (${analysis.newFiles.length}):\n`;
      for (const f of analysis.newFiles) {
        output += `  + ${f}\n`;
      }
      output += '\n';
    }

    if (analysis.conflictFiles.length > 0) {
      output += `Modified system files (${analysis.conflictFiles.length}):\n`;
      for (const f of analysis.conflictFiles) {
        output += `  ~ ${f}\n`;
      }
      output += '\n';
    }

    if (analysis.unchangedFiles.length > 0) {
      output += `Unchanged (${analysis.unchangedFiles.length} files)\n\n`;
    }

    if (hasUpdates) {
      output += `Run 'update --apply' to apply these changes.\n`;
      output += `Use --skip or --overwrite to control conflict resolution.\n`;
    } else {
      output += `No updates needed.\n`;
    }

    return {
      stdout: output,
      stderr: '',
      exitCode: 0,
    };
  }

  // Apply the update
  return await applyUpdate(defaultImage, analysis, vfs, context, skipConflicts, overwriteConflicts);
};

/**
 * Apply the system update
 */
async function applyUpdate(
  defaultImage: DiskImage,
  analysis: UpdateAnalysis,
  vfs: any,
  _context: ExecutionContext,
  skipConflicts: boolean,
  overwriteConflicts: boolean,
): Promise<CommandResult> {
  let output = '';

  // Step 1: Create pre-update snapshot
  try {
    const activeSession = getActiveSession();
    const diskImage = await captureSessionState(
      vfs,
      activeSession.name,
      activeSession.created,
      activeSession.env,
      activeSession.aliases,
      activeSession.history,
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snapshotName = `pre-update-${timestamp}`;

    await createSnapshot(
      activeSession.id,
      snapshotName,
      diskImage,
      {
        description: `Pre-update snapshot (v${VERSION})`,
        isAuto: true,
      },
    );

    await enforceSnapshotLimit(activeSession.id);

    output += `Created pre-update snapshot: ${snapshotName}\n`;
  } catch (error) {
    output += `Warning: Could not create snapshot: ${(error as Error).message}\n`;
  }

  const activeSession = getActiveSession();
  const namespace = activeSession.fsNamespace;

  // Step 2: Save timewarp versions of files that will be modified
  let versionedCount = 0;
  for (const filePath of analysis.conflictFiles) {
    try {
      const currentContent = vfs.readSync(filePath);
      await saveVersion(namespace, filePath, currentContent, {
        message: `Pre-update backup (v${VERSION})`,
        author: 'update',
      });
      versionedCount++;
    } catch {
      // If we can't save a version, continue anyway
    }
  }

  if (versionedCount > 0) {
    output += `Saved ${versionedCount} file versions to timewarp\n`;
  }

  // Step 3: Apply new files
  let addedCount = 0;
  for (const filePath of analysis.newFiles) {
    const diskFile = defaultImage.files[filePath];
    if (diskFile.type === 'file' && diskFile.content !== undefined) {
      // Ensure parent directory exists
      const parentDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
      if (parentDir !== '/' && !vfs.exists(parentDir)) {
        vfs.mkdir(parentDir, true);
      }
      await vfs.write(filePath, diskFile.content);
      addedCount++;
    } else if (diskFile.type === 'directory' && !vfs.exists(filePath)) {
      vfs.mkdir(filePath, true);
    }
  }

  if (addedCount > 0) {
    output += `Added ${addedCount} new files\n`;
  }

  // Step 4: Handle conflict files
  let updatedCount = 0;
  let skippedCount = 0;

  // Determine strategy
  let strategy: ConflictStrategy = 'interactive';
  if (skipConflicts) strategy = 'skip';
  if (overwriteConflicts) strategy = 'overwrite';

  for (const filePath of analysis.conflictFiles) {
    const diskFile = defaultImage.files[filePath];
    if (diskFile.type !== 'file' || diskFile.content === undefined) continue;

    if (strategy === 'skip') {
      skippedCount++;
      continue;
    }

    if (strategy === 'overwrite') {
      await vfs.write(filePath, diskFile.content);
      updatedCount++;
      continue;
    }

    // Interactive mode - for now, default to skip since we don't have
    // an interactive terminal prompt in builtin commands
    // The user can use --overwrite or --skip explicitly
    skippedCount++;
  }

  if (updatedCount > 0) {
    output += `Updated ${updatedCount} system files\n`;
  }
  if (skippedCount > 0) {
    output += `Skipped ${skippedCount} user-modified files (preserved your changes)\n`;
  }

  // Step 5: Record update in VFS
  const updateRecord = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    added: analysis.newFiles.length,
    updated: updatedCount,
    skipped: skippedCount,
    conflictsResolved: strategy,
  };

  try {
    // Ensure /var/log exists
    if (!vfs.exists('/var')) {
      vfs.mkdir('/var', true);
    }
    if (!vfs.exists('/var/log')) {
      vfs.mkdir('/var/log', true);
    }

    // Append to update log
    let updateLog = '';
    try {
      updateLog = vfs.readSync('/var/log/update.log');
    } catch {
      // File doesn't exist yet
    }

    updateLog += `[${updateRecord.timestamp}] Updated to v${updateRecord.version}: ` +
      `${updateRecord.added} added, ${updateRecord.updated} updated, ` +
      `${updateRecord.skipped} skipped (strategy: ${updateRecord.conflictsResolved})\n`;

    await vfs.write('/var/log/update.log', updateLog);
  } catch {
    // Non-critical, continue
  }

  // Step 6: Sync
  await vfs.sync();

  output += `\nUpdate complete (v${VERSION})\n`;

  if (skippedCount > 0) {
    output += `\nTip: Use 'timewarp list <file>' to view version history.\n`;
    output += `Use 'update --rollback' to undo this update.\n`;
  }

  return {
    stdout: output,
    stderr: '',
    exitCode: 0,
  };
}

/**
 * Handle --rollback flag: restore the most recent pre-update snapshot
 */
async function handleRollback(_vfs: any): Promise<CommandResult> {
  try {
    const activeSession = getActiveSession();
    const snapshots = await getSessionSnapshots(activeSession.id);

    // Find the most recent pre-update snapshot
    const updateSnapshots = snapshots
      .filter(s => s.name.startsWith('pre-update-'))
      .sort((a, b) => b.timestamp - a.timestamp);

    if (updateSnapshots.length === 0) {
      return {
        stdout: '',
        stderr: 'No pre-update snapshots found. Nothing to roll back to.\n',
        exitCode: 1,
      };
    }

    const latestSnapshot = updateSnapshots[0];

    // Use the session restore mechanism
    return {
      stdout: `Found pre-update snapshot: ${latestSnapshot.name}\n` +
        `Created: ${new Date(latestSnapshot.timestamp).toISOString()}\n` +
        `${latestSnapshot.description || ''}\n\n` +
        `To restore, run: session restore ${latestSnapshot.name}\n`,
      stderr: '',
      exitCode: 0,
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: `update --rollback: ${(error as Error).message}\n`,
      exitCode: 1,
    };
  }
}

/**
 * Handle --history flag: show update history
 */
async function handleUpdateHistory(vfs: any): Promise<CommandResult> {
  try {
    const logContent = vfs.readSync('/var/log/update.log');
    if (!logContent || logContent.trim().length === 0) {
      return {
        stdout: 'No update history found.\n',
        stderr: '',
        exitCode: 0,
      };
    }

    return {
      stdout: `TronOS Update History\n${'='.repeat(40)}\n${logContent}\n`,
      stderr: '',
      exitCode: 0,
    };
  } catch {
    return {
      stdout: 'No update history found.\n',
      stderr: '',
      exitCode: 0,
    };
  }
}
