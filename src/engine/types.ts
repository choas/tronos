/**
 * @fileoverview Core type definitions for the AIOS shell engine.
 *
 * This module defines the fundamental types used throughout the shell:
 * - Token types for the lexer
 * - AST node types for the parser
 * - Command execution context and results
 * - Executable metadata format
 *
 * @module engine/types
 */

/**
 * Token produced by the shell lexer.
 *
 * @property type - The token type identifier
 * @property value - The raw string value of the token
 *
 * @example
 * // Word token for command name
 * { type: 'word', value: 'echo' }
 *
 * @example
 * // Pipe operator token
 * { type: 'pipe', value: '|' }
 */
export type Token = {
  type: 'word' | 'sstring' | 'dstring' | 'pipe' | 'redirect' | 'append' | 'and' | 'or' | 'semicolon';
  value: string;
};

/**
 * Output redirection specification.
 *
 * @property type - 'redirect' for `>` (overwrite) or 'append' for `>>` (append)
 * @property file - The target file path
 *
 * @example
 * // Redirect stdout to file (overwrite)
 * { type: 'redirect', file: 'output.txt' }
 *
 * @example
 * // Append stdout to file
 * { type: 'append', file: 'log.txt' }
 */
export interface Redirect {
  type: 'redirect' | 'append';
  file: string;
}

/**
 * AST node representing a simple command with optional redirects.
 *
 * A simple command consists of a command name, arguments, and
 * optional input/output redirections.
 *
 * @property type - Always 'Command' for simple commands
 * @property command - The command name or executable path
 * @property args - Array of command arguments
 * @property redirects - Array of output redirections
 *
 * @example
 * // ls -la > files.txt
 * {
 *   type: 'Command',
 *   command: 'ls',
 *   args: ['-la'],
 *   redirects: [{ type: 'redirect', file: 'files.txt' }]
 * }
 */
export interface SimpleCommand {
  type: 'Command';
  command: string;
  args: string[];
  redirects: Redirect[];
}

/**
 * AST node representing a logical sequence of commands.
 *
 * Commands connected with `&&` (and) or `||` (or) operators.
 * - `&&`: Execute right only if left succeeds (exit code 0)
 * - `||`: Execute right only if left fails (exit code != 0)
 *
 * @property type - Always 'LogicalSequence'
 * @property left - The left-hand command
 * @property operator - 'and' for `&&`, 'or' for `||`
 * @property right - The right-hand command
 *
 * @example
 * // mkdir dir && cd dir
 * {
 *   type: 'LogicalSequence',
 *   left: { type: 'Command', command: 'mkdir', args: ['dir'], redirects: [] },
 *   operator: 'and',
 *   right: { type: 'Command', command: 'cd', args: ['dir'], redirects: [] }
 * }
 */
export interface LogicalSequence {
  type: 'LogicalSequence';
  left: ParsedCommand;
  operator: 'and' | 'or';
  right: ParsedCommand;
}

/**
 * AST node representing a pipeline of commands.
 *
 * Multiple commands connected with `|` where stdout of each
 * command is piped to stdin of the next.
 *
 * @property type - Always 'Pipeline'
 * @property commands - Array of commands in pipeline order
 *
 * @example
 * // cat file.txt | grep pattern | wc -l
 * {
 *   type: 'Pipeline',
 *   commands: [
 *     { type: 'Command', command: 'cat', args: ['file.txt'], redirects: [] },
 *     { type: 'Command', command: 'grep', args: ['pattern'], redirects: [] },
 *     { type: 'Command', command: 'wc', args: ['-l'], redirects: [] }
 *   ]
 * }
 */
export interface Pipeline {
  type: 'Pipeline';
  commands: SimpleCommand[];
}

/**
 * Union type for all parsed command AST nodes.
 * Use the `type` property to discriminate between variants.
 */
export type ParsedCommand = SimpleCommand | LogicalSequence | Pipeline;

/**
 * Result returned from command execution.
 *
 * @property stdout - Standard output produced by the command
 * @property stderr - Standard error output (error messages)
 * @property exitCode - Exit code (0 for success, non-zero for failure)
 * @property uiRequest - Optional request to trigger UI actions (e.g., "showConfigModal")
 *
 * @example
 * // Successful command
 * { stdout: 'file1.txt\nfile2.txt\n', stderr: '', exitCode: 0 }
 *
 * @example
 * // Failed command
 * { stdout: '', stderr: 'cat: file.txt: No such file or directory', exitCode: 1 }
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  uiRequest?: string;
  /** When true, stdout was already written directly to terminal (e.g., by .trx files) */
  directOutput?: boolean;
}

import { InMemoryVFS } from '../vfs/memory';

/**
 * Execution context passed to commands during execution.
 *
 * Contains all the state and services needed by commands to execute,
 * including stdin data, environment variables, and filesystem access.
 *
 * @property stdin - Input data piped to the command (empty string if none)
 * @property env - Environment variables as key-value pairs
 * @property vfs - Virtual filesystem instance for file operations
 * @property terminal - Terminal API instance for screen operations (clear, cursor)
 * @property history - Command history array for the history builtin
 * @property aliases - Shell aliases map for alias expansion
 * @property size - Terminal size in columns and rows
 *
 * @example
 * const ctx: ExecutionContext = {
 *   stdin: '',
 *   env: { HOME: '/home/user', PATH: '/bin' },
 *   vfs: new InMemoryVFS(),
 *   terminal: terminalAPI,
 *   history: ['ls', 'pwd'],
 *   aliases: new Map([['ll', 'ls -la']]),
 *   size: { cols: 80, rows: 24 }
 * };
 */
export interface ExecutionContext {
  stdin: string;
  env: { [key: string]: string };
  vfs?: InMemoryVFS;
  terminal?: any;
  history?: string[];
  aliases?: Map<string, string>;
  size?: { cols: number; rows: number };
}

/**
 * Function signature for builtin shell commands.
 *
 * Builtin commands are implemented as async functions that receive
 * arguments and an execution context, returning a CommandResult.
 *
 * @param args - Command arguments (excluding the command name)
 * @param context - Execution context with env, stdin, vfs, etc.
 * @returns Promise resolving to command result with stdout, stderr, exitCode
 *
 * @example
 * const echo: BuiltinCommand = async (args, ctx) => {
 *   return { stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 };
 * };
 */
export type BuiltinCommand = (args: string[], context: ExecutionContext) => Promise<CommandResult>;

/**
 * Metadata parsed from .trx file header comments.
 * See spec Section 7.3 for format details.
 */
export interface ExeMetadata {
  name: string;           // Required: program name
  description?: string;   // Optional: brief description
  version?: string;       // Optional: semver version
  author?: string;        // Optional: author name or "@ai"
  created?: string;       // Optional: ISO 8601 timestamp
  license?: string;       // Optional: license identifier
  requires?: string[];    // Optional: required features (e.g., ["network", "usb"])
}

/**
 * Result of parsing an .trx file
 */
export interface ExeParseResult {
  success: boolean;
  metadata?: ExeMetadata;
  body?: string;          // The function body (code after metadata)
  error?: string;         // Error message if parsing failed
}
