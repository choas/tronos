/**
 * @fileoverview Shell engine providing interactive command line interface.
 *
 * The ShellEngine is the core of the AIOS shell experience, managing:
 * - Command line input with history and editing
 * - Tab completion for files and directories
 * - Command parsing and execution
 * - Session state (aliases, environment, history)
 * - Keyboard shortcuts (Ctrl+C, Ctrl+L, Ctrl+D, etc.)
 *
 * @module engine/shell
 */

import type { KeyEvent, TerminalAPI } from '../terminal/api';
import { tokenize, buildAST, expandAliases } from './parser';
import type { ParsedCommand, ExecutionContext } from './types';
import { InMemoryVFS } from '../vfs/memory';
import { HybridVFS, type HostMountConfig } from '../vfs/host';
import { executeCommand } from './executor';
import type { Session } from '../types';
import { displayBootSequence, displayQuickBoot } from './boot';
import { isCLI } from '../utils/environment';
import { VERSION } from '../version';
import { getCronScheduler } from './cron';
import type { CronCommandExecutor } from './cron';

// Import stores only in browser mode
// In CLI mode, this will be undefined and we'll use fallback
let storesShouldSkipBootAnimation: (() => boolean) | undefined;
let registerCustomPresetFn: ((name: string, preset: any) => void) | undefined;
let refreshPresetGeneratorsFn: (() => void) | undefined;

// Only import stores in non-CLI environments
// This prevents Solid.js store initialization errors in Node.js
if (!isCLI()) {
  // Dynamic import will be resolved at build time by Vite
  import('../stores/boot').then(stores => {
    storesShouldSkipBootAnimation = stores.shouldSkipBootAnimation;
  }).catch(() => {
    // Ignore import errors (e.g., in test environment)
  });
  import('../stores/theme').then(stores => {
    registerCustomPresetFn = stores.registerCustomPreset;
  }).catch(() => {});
  import('../vfs/proc').then(proc => {
    refreshPresetGeneratorsFn = proc.refreshPresetGenerators;
  }).catch(() => {});
}

/**
 * Check if boot animation should be skipped.
 * Uses stores in browser, returns false in CLI/tests.
 */
const shouldSkipBootAnimation = (): boolean => {
  return storesShouldSkipBootAnimation?.() ?? false;
};

/**
 * Configuration options for creating a ShellEngine instance.
 *
 * @property session - Optional session to restore state from (env, aliases, history)
 * @property onAliasChange - Callback invoked when aliases are modified (for persistence)
 * @property onUIRequest - Callback invoked when a command requests UI action (e.g., config modal)
 * @property skipBootAnimation - Skip the boot animation (useful for testing)
 * @property hostMountConfig - Configuration for mounting host filesystem (CLI mode only)
 */
export interface ShellEngineOptions {
  session?: Session;
  onAliasChange?: (aliases: Record<string, string>) => void;
  onUIRequest?: (request: string) => void;
  skipBootAnimation?: boolean;
  hostMountConfig?: HostMountConfig;
}

/**
 * Interactive shell engine for the AIOS terminal.
 *
 * The ShellEngine provides a bash-like command line interface with:
 * - Line editing with cursor movement (arrow keys, Ctrl+A/E)
 * - Command history navigation (up/down arrows)
 * - Tab completion for files and directories
 * - Alias expansion
 * - Environment variable management
 * - .profile loading on startup
 *
 * @example
 * const shell = new ShellEngine(terminalAPI, {
 *   session: currentSession,
 *   onAliasChange: (aliases) => saveToStore(aliases),
 *   onUIRequest: (request) => handleUIRequest(request)
 * });
 * await shell.boot();
 */
class ShellEngine {
  private term: TerminalAPI;
  private history: string[] = [];
  private historyIndex = -1;
  private vfs: InMemoryVFS;
  private env: { [key: string]: string } = {
    PATH: '/bin',
    HOME: '/home/tronos',
    USER: 'tronos',
    TRONOS_VERSION: VERSION
  };
  private aliases: Map<string, string> = new Map();
  private onAliasChange?: (aliases: Record<string, string>) => void;
  private onUIRequest?: (request: string) => void;
  private skipBootAnimation: boolean;
  private exitRequested = false;
  private exitCode = 0;

  /**
   * Create a new ShellEngine instance.
   *
   * @param term - Terminal API for input/output
   * @param options - Optional configuration (session, callbacks)
   */
  constructor(term: TerminalAPI, options?: ShellEngineOptions) {
    this.term = term;

    // Use HybridVFS if host mount config is provided, otherwise use InMemoryVFS
    if (options?.hostMountConfig) {
      this.vfs = new HybridVFS(options?.session?.fsNamespace, options.hostMountConfig);
    } else {
      this.vfs = new InMemoryVFS(options?.session?.fsNamespace);
    }

    this.onAliasChange = options?.onAliasChange;
    this.onUIRequest = options?.onUIRequest;
    this.skipBootAnimation = options?.skipBootAnimation ?? false;

    // Load aliases from session if provided
    if (options?.session?.aliases) {
      for (const [name, command] of Object.entries(options.session.aliases)) {
        this.aliases.set(name, command);
      }
    }

    // Load environment from session if provided
    if (options?.session?.env) {
      this.env = { ...options.session.env };
    }

    // Load history from session if provided
    if (options?.session?.history) {
      this.history = [...options.session.history];
    }
  }

  /**
   * Convert aliases Map to plain object and notify listener
   */
  private persistAliases(): void {
    if (this.onAliasChange) {
      const aliasObj: Record<string, string> = {};
      for (const [name, command] of this.aliases) {
        aliasObj[name] = command;
      }
      this.onAliasChange(aliasObj);
    }
  }

  /**
   * Switch the shell to a different session.
   * Reloads the VFS with the new session's namespace and updates env/aliases.
   * Called by App.tsx when the active session changes (via tab click or command).
   */
  public async switchToSession(session: { fsNamespace: string; env?: Record<string, string>; aliases?: Record<string, string>; history?: string[] }): Promise<void> {
    await this.vfs.switchNamespace(session.fsNamespace);

    // Update environment
    if (session.env) {
      this.env = { ...session.env };
    }

    // Update aliases
    if (session.aliases) {
      this.aliases = new Map(Object.entries(session.aliases));
    }

    // Update history
    if (session.history) {
      this.history = [...session.history];
    }

    // Reset cwd to home
    const home = this.env.HOME || '/home/tronos';
    if (this.vfs.exists(home) && this.vfs.isDirectory(home)) {
      this.vfs.chdir(home);
    }
  }

  /**
   * Initialize and start the shell.
   *
   * Boot sequence:
   * 1. Display animated boot sequence (or quick boot if preference is set)
   * 2. Initialize virtual filesystem from IndexedDB
   * 3. Load and execute ~/.profile if it exists
   * 4. Start the interactive command loop
   *
   * This method should be awaited to ensure proper initialization.
   */
  public async boot() {
    // Display boot sequence (animated or quick based on preference or option)
    if (this.skipBootAnimation || shouldSkipBootAnimation()) {
      displayQuickBoot(this.term);
    } else {
      await displayBootSequence(this.term);
    }

    // Initialize VFS (already done in boot sequence messages, but this is the actual init)
    await this.vfs.init();

    // Load custom theme presets from /etc/themes/*.json
    this.loadCustomThemes();

    // Initialize and start the cron scheduler
    await this.initCronScheduler();

    // Load and execute .profile if it exists
    await this.loadProfile();

    this.term.writeln('');
    this.run();
  }

  /**
   * Load and execute .profile on session start
   */
  private async loadProfile() {
    const home = this.env.HOME || '/home/tronos';
    const profilePath = `${home}/.profile`;

    try {
      // Check if .profile exists
      if (this.vfs.exists(profilePath)) {
        const stat = this.vfs.stat(profilePath);

        // Only execute if it's a file (not a directory)
        if (stat.type === 'file') {
          const content = await this.vfs.read(profilePath);

          // Process file line by line, just like source command
          const lines = content.split('\n').filter((line: string) => {
            const trimmed = line.trim();
            // Skip empty lines and comments
            return trimmed !== '' && !trimmed.startsWith('#');
          });

          // Execute each command from .profile
          for (const cmd of lines) {
            await this.execute(cmd);
          }
        }
      }
      // If .profile doesn't exist or is not a file, silently continue
    } catch (error) {
      // Gracefully handle errors - don't crash on .profile issues
      // This ensures the shell still starts even if .profile has problems
      console.error('Error loading .profile:', error);
    }
  }

  /**
   * Start the interactive read-eval-print loop (REPL).
   *
   * Continuously:
   * 1. Display prompt
   * 2. Read user input
   * 3. Execute command
   * 4. Repeat
   *
   * This method runs indefinitely until the shell is terminated.
   */
  public async run() {
    while (true) {
      const line = await this.readLine();
      if (line.trim() !== '') {
        this.history.push(line);
        await this.execute(line);
      }
      if (this.exitRequested) {
        this.shutdown();
        if (isCLI()) {
          process.exit(this.exitCode);
        } else {
          this.term.writeln('Use the browser tab close button to exit.');
          this.exitRequested = false;
        }
        break;
      }
    }
  }

  /**
   * Load custom theme presets from /etc/themes/*.json
   */
  private loadCustomThemes(): void {
    try {
      if (this.vfs.exists('/etc/themes') && this.vfs.isDirectory('/etc/themes')) {
        const files = this.vfs.list('/etc/themes');
        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const content = this.vfs.read(`/etc/themes/${file}`);
              if (typeof content === 'string') {
                const preset = JSON.parse(content);
                if (preset.name && preset.colors) {
                  registerCustomPresetFn?.(preset.name, preset);
                }
              }
            } catch {
              // Skip invalid theme files
            }
          }
        }
        refreshPresetGeneratorsFn?.();
      }
    } catch {
      // Non-fatal: custom themes are optional
    }
  }

  /**
   * Initialize the cron scheduler with a command executor.
   */
  private async initCronScheduler(): Promise<void> {
    try {
      const scheduler = getCronScheduler();

      // Create a command executor that runs commands through the shell engine
      const executor: CronCommandExecutor = async (command: string) => {
        const context: ExecutionContext = {
          stdin: '',
          env: { ...this.env, PWD: this.vfs.cwd() },
          vfs: this.vfs,
          terminal: this.term,
          history: this.history,
          aliases: this.aliases,
          size: this.term.getSize()
        };

        try {
          const tokens = tokenize(command);
          const expandedTokens = expandAliases(tokens, this.aliases);
          const commands = buildAST(expandedTokens);

          let stdout = '';
          let stderr = '';
          let exitCode = 0;

          for (const cmd of commands) {
            const result = await executeCommand(cmd, context);
            stdout += result.stdout;
            stderr += result.stderr;
            exitCode = result.exitCode;
          }

          return { stdout, stderr, exitCode };
        } catch (err) {
          return {
            stdout: '',
            stderr: err instanceof Error ? err.message : String(err),
            exitCode: 1,
          };
        }
      };

      scheduler.setExecutor(executor);
      await scheduler.init();
      scheduler.start();
    } catch (err) {
      console.error('Failed to initialize cron scheduler:', err);
    }
  }

  /**
   * Clean up resources and shut down the shell.
   * Stops the cron scheduler.
   */
  public shutdown() {
    const scheduler = getCronScheduler();
    scheduler.stop();
  }

  /**
   * Write output directly to the terminal.
   * Used for external components to display messages (e.g., import results)
   */
  public writeOutput(text: string): void {
    this.term.write(text);
  }

  private async execute(line: string) {
    try {
      const tokens = tokenize(line);
      const expandedTokens = expandAliases(tokens, this.aliases);
      const commands = buildAST(expandedTokens);
      for (const command of commands) {
        await this.executeCommand(command);
      }
    } catch (error) {
      // Handle parsing errors (syntax errors, unterminated strings, etc.)
      const message = error instanceof Error ? error.message : String(error);
      this.term.writeln(`\x1b[31mSyntax error: ${message}\x1b[0m`);
    }
  }

  private async executeCommand(command: ParsedCommand) {
    const context: ExecutionContext = {
      stdin: '',
      env: { ...this.env, PWD: this.vfs.cwd() },
      vfs: this.vfs,
      terminal: this.term,
      history: this.history,
      aliases: this.aliases,
      size: this.term.getSize()
    };

    try {
      // Use the new executor to handle all command types
      const result = await executeCommand(command, context);

      // Handle special context updates for stateful commands

      // Handle cd command specially to update VFS state
      const requestedPath = (context as any).requestedCd;
      if (requestedPath) {
        try {
          this.vfs.chdir(requestedPath);
        } catch (error) {
          // Error already reported in result
        }
      }

      // Handle export command to update environment variables
      const exportRequests = (context as any).exportRequests;
      if (exportRequests && Array.isArray(exportRequests)) {
        for (const { key, value } of exportRequests) {
          this.env[key] = value;
        }
      }

      // Handle unset command to remove environment variables
      const unsetRequests = (context as any).unsetRequests;
      if (unsetRequests && Array.isArray(unsetRequests)) {
        for (const key of unsetRequests) {
          delete this.env[key];
        }
      }

      // Handle alias command to add aliases
      const aliasRequests = (context as any).aliasRequests;
      if (aliasRequests && Array.isArray(aliasRequests)) {
        for (const req of aliasRequests) {
          if (req.action === 'add') {
            this.aliases.set(req.name, req.command);
          }
        }
        // Persist aliases after modification
        this.persistAliases();
      }

      // Handle unalias command to remove aliases
      const unaliasRequests = (context as any).unaliasRequests;
      if (unaliasRequests && Array.isArray(unaliasRequests)) {
        for (const req of unaliasRequests) {
          if (req.action === 'removeAll') {
            this.aliases.clear();
          } else if (req.action === 'remove') {
            this.aliases.delete(req.name);
          }
        }
        // Persist aliases after modification
        this.persistAliases();
      }

      // Handle session switch to reload VFS with new namespace
      const sessionSwitch = (context as any).requestedSessionSwitch;
      if (sessionSwitch) {
        try {
          await this.vfs.switchNamespace(sessionSwitch.fsNamespace);
          // Update shell env and aliases from the new session
          if (sessionSwitch.env) {
            this.env = { ...sessionSwitch.env };
          }
          if (sessionSwitch.aliases) {
            this.aliases = new Map(Object.entries(sessionSwitch.aliases));
          }
          // Reset cwd to home
          const home = this.env.HOME || '/home/tronos';
          if (this.vfs.exists(home) && this.vfs.isDirectory(home)) {
            this.vfs.chdir(home);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.term.writeln(`\x1b[31mFailed to switch filesystem: ${msg}\x1b[0m`);
        }
      }

      // Handle source command to execute commands from file
      const sourceCommands = (context as any).sourceCommands;
      if (sourceCommands && Array.isArray(sourceCommands)) {
        for (const cmd of sourceCommands) {
          await this.execute(cmd);
        }
      }

      // Handle exit request
      const exitReq = (context as any).exitRequested;
      if (exitReq) {
        this.exitRequested = true;
        this.exitCode = exitReq.code ?? 0;
      }

      // Display output (skip stdout if already written directly by .trx)
      if (result.stdout && !result.directOutput) {
        this.term.writeln(result.stdout);
      }
      if (result.stderr) {
        this.term.writeln(`\x1b[31m${result.stderr}\x1b[0m`);
      }

      // Handle UI requests (e.g., config ui command)
      if (result.uiRequest && this.onUIRequest) {
        this.onUIRequest(result.uiRequest);
      }
    } catch (error) {
      // Handle runtime execution errors
      const message = error instanceof Error ? error.message : String(error);
      this.term.writeln(`\x1b[31mError: ${message}\x1b[0m`);
    }
  }

  /**
   * Copy text to the system clipboard.
   * Uses the Clipboard API with graceful error handling.
   */
  private async copyToClipboard(text: string): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    } catch (error) {
      // Clipboard access may be denied - fail silently
      console.warn('Clipboard write failed:', error);
    }
  }

  /**
   * Read text from the system clipboard.
   * Uses the Clipboard API with graceful error handling.
   */
  private async pasteFromClipboard(): Promise<string> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        return await navigator.clipboard.readText();
      }
    } catch (error) {
      // Clipboard access may be denied - fail silently
      console.warn('Clipboard read failed:', error);
    }
    return '';
  }

  private getPrompt() {
    const cwd = this.vfs.cwd();
    const home = this.env.HOME || '/home/tronos';
    const user = this.env.USER || 'tronos';
    let displayPath = cwd;

    // Replace home directory with ~ for display
    if (cwd === home) {
      displayPath = '~';
    } else if (cwd.startsWith(home + '/')) {
      displayPath = '~' + cwd.slice(home.length);
    }

    return `${user}@tronos:${displayPath}$ `;
  }

  private readLine(): Promise<string> {
    return new Promise(resolve => {
      let line = '';
      let cursorPos = 0; // Track cursor position within line
      this.term.write(this.getPrompt());

      // Helper to redraw line with cursor at correct position
      const redrawLine = () => {
        this.term.write(`\x1b[2K\r${this.getPrompt()}${line}`);
        // Move cursor back if not at end
        if (cursorPos < line.length) {
          this.term.write(`\x1b[${line.length - cursorPos}D`);
        }
      };

      // Handle pasted text from xterm.js onData event
      // xterm.js sends multi-character strings when text is pasted
      const dataDisposable = this.term.onData((data: string) => {
        // Skip single characters (come through onKey) and escape sequences
        // (arrow keys, function keys etc. start with \x1b and are handled by onKey)
        if (data.length > 1 && !data.startsWith('\x1b')) {
          // Filter out newlines to prevent command injection and keep single line
          const sanitized = data.replace(/[\r\n]+/g, ' ').trim();
          if (sanitized) {
            // Insert at cursor position
            line = line.slice(0, cursorPos) + sanitized + line.slice(cursorPos);
            cursorPos += sanitized.length;
            redrawLine();
          }
        }
      });

      const disposable = this.term.onKey((key: KeyEvent) => {
        const printable = !key.domEvent.altKey && !key.domEvent.ctrlKey && !key.domEvent.metaKey;

        // Handle Ctrl/Cmd key combinations
        const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
        const copyPasteModifier = isMac ? key.domEvent.metaKey : key.domEvent.ctrlKey;

        // Handle copy (Ctrl+C on Windows/Linux, Cmd+C on Mac)
        if (copyPasteModifier && key.domEvent.key.toLowerCase() === 'c') {
          // If text is selected, copy it to clipboard instead of interrupt
          if (this.term.hasSelection()) {
            const selectedText = this.term.getSelection();
            this.copyToClipboard(selectedText);
            this.term.clearSelection();
            return;
          }
          // Fall through to Ctrl+C interrupt only on non-Mac or if no selection
          if (!isMac) {
            this.term.write('^C');
            this.term.writeln('');
            line = '';
            cursorPos = 0;
            this.historyIndex = -1;
            this.term.write(this.getPrompt());
            return;
          }
        }

        // Handle paste (Ctrl+V on Windows/Linux, Cmd+V on Mac)
        // Note: Most paste operations are handled by xterm.js via onData event.
        // This handler is kept as a fallback for environments where onData
        // doesn't receive pasted text (e.g., some browser configurations).
        if (copyPasteModifier && key.domEvent.key.toLowerCase() === 'v') {
          // Use async clipboard read as fallback
          // The onData handler will catch most paste operations
          this.pasteFromClipboard().then(text => {
            if (text) {
              // Filter out newlines to prevent command injection and keep single line
              const sanitized = text.replace(/[\r\n]+/g, ' ').trim();
              if (sanitized) {
                // Insert at cursor position
                line = line.slice(0, cursorPos) + sanitized + line.slice(cursorPos);
                cursorPos += sanitized.length;
                redrawLine();
              }
            }
          });
          return;
        }

        // Handle Ctrl key combinations (not Cmd on Mac)
        if (key.domEvent.ctrlKey) {
          switch (key.domEvent.key.toLowerCase()) {
            case 'l': // Ctrl+L - Clear screen
              this.term.clear();
              this.term.write(this.getPrompt() + line);
              // Position cursor correctly after clear
              if (cursorPos < line.length) {
                this.term.write(`\x1b[${line.length - cursorPos}D`);
              }
              return;
            case 'c': // Ctrl+C - Cancel current input (when not copy)
              // On Mac, we already handled Cmd+C above, so Ctrl+C is always interrupt
              // On Windows/Linux, we only get here if no selection (copy handled above)
              this.term.write('^C');
              this.term.writeln('');
              line = '';
              cursorPos = 0;
              this.historyIndex = -1;
              this.term.write(this.getPrompt());
              return;
            case 'd': // Ctrl+D - Exit (if input empty)
              if (line === '') {
                this.term.writeln('^D');
                this.term.writeln('exit');
                if (isCLI()) {
                  disposable.dispose();
                  dataDisposable.dispose();
                  this.exitRequested = true;
                  this.exitCode = 0;
                  resolve('');
                } else {
                  this.term.writeln('Use the browser tab close button to exit.');
                  this.term.write(this.getPrompt());
                }
              }
              return;
            case 'a': // Ctrl+A - Move to beginning of line
              if (cursorPos > 0) {
                this.term.write(`\x1b[${cursorPos}D`);
                cursorPos = 0;
              }
              return;
            case 'e': // Ctrl+E - Move to end of line
              if (cursorPos < line.length) {
                this.term.write(`\x1b[${line.length - cursorPos}C`);
                cursorPos = line.length;
              }
              return;
            case 'u': // Ctrl+U - Delete to beginning of line
              if (cursorPos > 0) {
                line = line.slice(cursorPos);
                cursorPos = 0;
                redrawLine();
              }
              return;
            case 'k': // Ctrl+K - Delete to end of line
              if (cursorPos < line.length) {
                line = line.slice(0, cursorPos);
                redrawLine();
              }
              return;
          }
        }

        switch (key.key) {
          case '\r': // Enter
            disposable.dispose();
            dataDisposable.dispose();
            this.term.writeln('');
            // Flush the newline to terminal before command executes
            // This ensures command output appears on a new line
            this.term.flush();
            this.historyIndex = -1;
            resolve(line);
            break;
          case '\u007f': // Backspace
            if (cursorPos > 0) {
              line = line.slice(0, cursorPos - 1) + line.slice(cursorPos);
              cursorPos--;
              redrawLine();
            }
            break;
          case '\t': // Tab
            {
              const completion = this.getCompletion(line);
              if (completion.type === 'complete') {
                // Single match - complete it
                line = completion.newLine;
                cursorPos = line.length;
                this.term.write(`\x1b[2K\r${this.getPrompt()}${line}`);
              } else if (completion.type === 'multiple') {
                // Multiple matches - show them
                this.term.writeln('');
                this.term.writeln(completion.matches.join('  '));
                this.term.write(this.getPrompt() + line);
                cursorPos = line.length;
              }
            }
            break;
          case '\x1b[A': // Up arrow
            if (this.historyIndex < this.history.length - 1) {
              this.historyIndex++;
              line = this.history[this.history.length - 1 - this.historyIndex];
              cursorPos = line.length;
              this.term.write(`\x1b[2K\r${this.getPrompt()}${line}`);
            }
            break;
          case '\x1b[B': // Down arrow
            if (this.historyIndex > 0) {
              this.historyIndex--;
              line = this.history[this.history.length - 1 - this.historyIndex];
              cursorPos = line.length;
              this.term.write(`\x1b[2K\r${this.getPrompt()}${line}`);
            } else if (this.historyIndex === 0) {
              this.historyIndex = -1;
              line = '';
              cursorPos = 0;
              this.term.write(`\x1b[2K\r${this.getPrompt()}`);
            }
            break;
          case '\x1b[D': // Left arrow
            if (cursorPos > 0) {
              cursorPos--;
              this.term.write('\x1b[D');
            }
            break;
          case '\x1b[C': // Right arrow
            if (cursorPos < line.length) {
              cursorPos++;
              this.term.write('\x1b[C');
            }
            break;
          default:
            if (printable) {
              // Insert character at cursor position
              line = line.slice(0, cursorPos) + key.key + line.slice(cursorPos);
              cursorPos++;
              // If cursor is at end, just write the character
              if (cursorPos === line.length) {
                this.term.write(key.key);
              } else {
                // Otherwise, redraw from cursor position
                redrawLine();
              }
            }
        }
      });
    });
  }

  private getCompletion(line: string): { type: 'complete', newLine: string } | { type: 'multiple', matches: string[] } | { type: 'none' } {
    // Get the word being completed (last word in the line)
    const words = line.split(/\s+/);
    const partialWord = words[words.length - 1] || '';

    // Get files and directories in current directory
    try {
      const entries = this.vfs.list(this.vfs.cwd());

      // Filter matches
      const matches = entries.filter(entry => entry.startsWith(partialWord));

      if (matches.length === 0) {
        return { type: 'none' };
      } else if (matches.length === 1) {
        // Single match - complete it
        const completed = matches[0];
        const beforeWord = words.slice(0, -1).join(' ');
        const newLine = beforeWord ? `${beforeWord} ${completed}` : completed;
        return { type: 'complete', newLine };
      } else {
        // Multiple matches - return them
        return { type: 'multiple', matches };
      }
    } catch (error) {
      return { type: 'none' };
    }
  }
}

export default ShellEngine;
