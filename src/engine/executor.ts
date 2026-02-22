/**
 * @fileoverview Command execution engine for the AIOS shell.
 *
 * This module provides the runtime for executing parsed shell commands:
 * - Simple commands (builtins and executables)
 * - Pipelines (command | command)
 * - Logical sequences (command && command, command || command)
 * - I/O redirection (>, >>, <)
 * - .trx file execution with sandboxing
 *
 * The executor handles:
 * - Builtin command dispatch
 * - PATH-based executable resolution
 * - .trx metadata parsing and validation
 * - Sandbox environment creation for .trx files
 * - Error handling and exit code propagation
 *
 * @module engine/executor
 */

import type { ParsedCommand, SimpleCommand, Pipeline, LogicalSequence, CommandResult, ExecutionContext, Redirect, ExeMetadata, ExeParseResult } from './types';
import { BUILTIN_COMMANDS } from './builtins';
import { ExitSignal, createSandboxTerminalAPI, isFeatureAvailable } from '../executor/sandbox';
import { tokenize, buildAST } from './parser';
import { getPackageNameForExe, getMissingRequiredConfig } from './builtins/tpkg';

/**
 * Parse metadata from an .trx file's header comments.
 *
 * .trx files have metadata in comment headers at the top:
 * ```javascript
 * #!/tronos
 * // @name: program-name
 * // @description: Brief description
 * // @version: 1.0.0
 * // @author: username
 * // @created: 2024-01-15T10:30:00Z
 * // @license: MIT
 * // @requires: network, usb
 *
 * (async function(t) {
 *   // Program code
 * })
 * ```
 *
 * The 'name' field is required; all others are optional.
 * Parsing stops at the first non-comment, non-empty, non-shebang line.
 *
 * @param source - The raw source code of the .trx file
 * @returns Parse result with metadata, function body, or error
 *
 * @example
 * const result = parseExeMetadata(source);
 * if (result.success) {
 *   console.log(result.metadata.name);  // Program name
 *   console.log(result.body);           // Function body
 * } else {
 *   console.error(result.error);        // Parse error
 * }
 */
export function parseExeMetadata(source: string): ExeParseResult {
  const lines = source.split('\n');
  const metadata: Partial<ExeMetadata> = {};
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines at the top
    if (line === '') {
      continue;
    }

    // Skip shebang line
    if (line.startsWith('#!')) {
      bodyStartIndex = i + 1;
      continue;
    }

    // Check for metadata comment (// @key: value or // key: value)
    if (line.startsWith('//')) {
      const commentContent = line.substring(2).trim();

      // Match either "@key: value" or "key: value" format
      const match = commentContent.match(/^@?(\w+):\s*(.*)$/);

      if (match) {
        const [, key, value] = match;
        const normalizedKey = key.toLowerCase();

        switch (normalizedKey) {
          case 'name':
            metadata.name = value.trim();
            break;
          case 'description':
            metadata.description = value.trim();
            break;
          case 'version':
            metadata.version = value.trim();
            break;
          case 'author':
            metadata.author = value.trim();
            break;
          case 'created':
            metadata.created = value.trim();
            break;
          case 'license':
            metadata.license = value.trim();
            break;
          case 'requires':
            // Parse comma-separated list of requirements
            metadata.requires = value.split(',').map(r => r.trim()).filter(r => r.length > 0);
            break;
        }
        bodyStartIndex = i + 1;
        continue;
      }

      // Regular comment without metadata, still skip it
      bodyStartIndex = i + 1;
      continue;
    }

    // We've hit a non-comment line, this is where the body starts
    bodyStartIndex = i;
    break;
  }

  // Validate that name is present (required)
  if (!metadata.name) {
    return {
      success: false,
      error: 'Missing required metadata field: name'
    };
  }

  // Extract the body (everything from bodyStartIndex onwards)
  const body = lines.slice(bodyStartIndex).join('\n').trim();

  return {
    success: true,
    metadata: metadata as ExeMetadata,
    body
  };
}

/**
 * Extract the function body from an .trx file's async function wrapper.
 *
 * .trx files can have several formats:
 * 1. (async function(t) { ... })           - anonymous with outer parentheses
 * 2. async function(t) { ... }             - anonymous without outer parentheses
 * 3. async function main(t) { ... }        - named function (AI-generated format)
 *
 * This extracts just the inner code.
 */
function extractFunctionBody(body: string): { success: boolean; code?: string; error?: string } {
  // Match: (async function(t) { ... }) or (async function (t) { ... })
  // The body might have the parameter named differently (t, api, terminal, etc.)
  const match = body.match(/^\s*\(\s*async\s+function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*\)\s*$/);

  if (match) {
    return {
      success: true,
      code: match[2]
    };
  }

  // Try alternate format without outer parentheses (anonymous function)
  const altMatch = body.match(/^\s*async\s+function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*$/);
  if (altMatch) {
    return {
      success: true,
      code: altMatch[2]
    };
  }

  // Try named function format: async function main(t) { ... }
  // This is the format generated by AI prompts
  const namedMatch = body.match(/^\s*async\s+function\s+(\w+)\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}\s*$/);
  if (namedMatch) {
    return {
      success: true,
      code: namedMatch[3]
    };
  }

  return {
    success: false,
    error: 'Invalid .trx format: expected async function(t) { ... } or async function main(t) { ... }'
  };
}

/**
 * Resolve an executable path from a command name.
 *
 * Resolution order:
 * 1. If the path is absolute and ends with .trx, use it directly
 * 2. If the path is relative (starts with ./ or ../) and ends with .trx, resolve it
 * 3. Search in PATH directories (default: /bin) for name.trx
 * 4. If the name already ends in .trx, skip adding the extension
 */
function resolveExePath(commandName: string, ctx: ExecutionContext): string | null {
  const vfs = ctx.vfs;
  if (!vfs) return null;

  // Check if it's an absolute or relative path with .trx/.exe extension
  if (commandName.endsWith('.trx') || commandName.endsWith('.exe')) {
    const resolvedPath = vfs.resolve(commandName);
    if (vfs.exists(resolvedPath) && vfs.isFile(resolvedPath)) {
      return resolvedPath;
    }
    return null;
  }

  // Check if it's a relative path (./something or ../something) without extension
  if (commandName.startsWith('./') || commandName.startsWith('../')) {
    // Try .trx first, then legacy .exe
    for (const ext of ['.trx', '.exe']) {
      const withExt = commandName + ext;
      const resolvedPath = vfs.resolve(withExt);
      if (vfs.exists(resolvedPath) && vfs.isFile(resolvedPath)) {
        return resolvedPath;
      }
    }
    // Also try without extension in case user typed full path
    const directPath = vfs.resolve(commandName);
    if (vfs.exists(directPath) && vfs.isFile(directPath)) {
      return directPath;
    }
    return null;
  }

  // Search in PATH directories (.trx first, then legacy .exe)
  const pathEnv = ctx.env.PATH || '/bin';
  const pathDirs = pathEnv.split(':');

  for (const dir of pathDirs) {
    for (const ext of ['.trx', '.exe']) {
      const exePath = `${dir}/${commandName}${ext}`;
      if (vfs.exists(exePath) && vfs.isFile(exePath)) {
        return exePath;
      }
    }
  }

  return null;
}

/**
 * Execute an .trx file in a sandboxed environment.
 *
 * Execution process:
 * 1. Read the .trx file from the VFS
 * 2. Parse metadata and validate required fields
 * 3. Check feature requirements (network, clipboard, etc.)
 * 4. Extract the async function body
 * 5. Create a sandboxed Terminal API
 * 6. Execute the code using AsyncFunction constructor
 * 7. Capture output and handle exit signals
 *
 * The sandbox provides a `t` parameter with:
 * - Output methods: write(), writeln(), clear()
 * - Cursor control: moveTo(), moveBy(), getCursor()
 * - Style helpers: t.style.bold(), t.style.red(), etc.
 * - Filesystem: t.fs.read(), t.fs.write(), etc.
 * - Network: t.net.fetch()
 * - Control: t.exit(), t.sleep()
 *
 * @param exePath - Resolved path to the .trx file
 * @param args - Command line arguments passed to the program
 * @param ctx - Execution context with env, vfs, terminal
 * @returns Promise resolving to command result with stdout, stderr, exitCode
 *
 * @example
 * const result = await executeExe('/bin/countdown.trx', ['10'], ctx);
 * console.log(result.stdout);    // Program output
 * console.log(result.exitCode);  // 0 for success
 */
export async function executeExe(
  exePath: string,
  args: string[],
  ctx: ExecutionContext
): Promise<CommandResult> {
  const vfs = ctx.vfs;
  if (!vfs) {
    return {
      stdout: '',
      stderr: 'No filesystem available',
      exitCode: 1
    };
  }

  // 1. Read the file
  let source: string;
  try {
    source = await vfs.read(exePath);
  } catch (error) {
    return {
      stdout: '',
      stderr: `Cannot read ${exePath}: ${error}`,
      exitCode: 1
    };
  }

  // 2. Parse metadata
  const parseResult = parseExeMetadata(source);
  if (!parseResult.success) {
    return {
      stdout: '',
      stderr: `Parse error in ${exePath}: ${parseResult.error}`,
      exitCode: 1
    };
  }

  const { metadata, body } = parseResult;

  // 3. Check requirements
  if (metadata!.requires && metadata!.requires.length > 0) {
    for (const req of metadata!.requires) {
      if (!isFeatureAvailable(req)) {
        return {
          stdout: '',
          stderr: `${metadata!.name}: requires '${req}' which is not available`,
          exitCode: 1
        };
      }
    }
  }

  // 4. Extract function body
  const extractResult = extractFunctionBody(body!);
  if (!extractResult.success) {
    return {
      stdout: '',
      stderr: `${exePath}: ${extractResult.error}`,
      exitCode: 1
    };
  }

  // 5. Create command executor for t.exec()
  const commandExecutor = async (command: string): Promise<CommandResult> => {
    try {
      const tokens = tokenize(command);
      const commands = buildAST(tokens);

      if (commands.length === 0) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // Execute all commands and return the last result
      let lastResult: CommandResult = { stdout: '', stderr: '', exitCode: 0 };
      let combinedStdout = '';
      let combinedStderr = '';

      for (const cmd of commands) {
        lastResult = await executeCommand(cmd, ctx);
        combinedStdout += lastResult.stdout;
        combinedStderr += lastResult.stderr;
      }

      return {
        stdout: combinedStdout,
        stderr: combinedStderr,
        exitCode: lastResult.exitCode
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `exec error: ${error}`,
        exitCode: 1
      };
    }
  };

  // 6. Get package context (if this exe is an installed package)
  const packageName = getPackageNameForExe(exePath, ctx);

  // 7. Check for missing required config and emit warnings
  let stderr = '';
  if (packageName) {
    const missingConfig = getMissingRequiredConfig(packageName, ctx);
    if (missingConfig.length > 0) {
      const warningMsg = `Warning: Missing required config for ${packageName}: ${missingConfig.join(', ')}\n` +
        `Run 'tpkg config ${packageName}' to configure.\n`;
      stderr = warningMsg;
      // Also write warning to terminal if available
      if (ctx.terminal?.write) {
        ctx.terminal.write(`\x1b[33m${warningMsg}\x1b[0m`);
      }
    }
  }

  // 8. Create Terminal API sandbox with package context
  const terminalAPI = createSandboxTerminalAPI(ctx, args, commandExecutor, { packageName });

  // 9. Execute the code
  // Use the AsyncFunction constructor to create a function from the code
  // The function receives the terminal API as parameter 't'
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

  // Capture output for non-terminal contexts
  let stdout = '';

  // Create a wrapper API that captures output for pipe support
  // while also writing directly to terminal for live display.
  // The shell skips re-printing stdout for exe results (directOutput flag).
  const wrappedAPI = {
    ...terminalAPI,
    write: (text: string) => {
      stdout += text;
      terminalAPI.write(text);
    },
    writeln: (text: string) => {
      stdout += text + '\n';
      terminalAPI.writeln(text);
    }
  };

  try {
    // Create the async function with the extracted body
    // The parameter is 't' which receives the terminal API
    const fn = new AsyncFunction('t', extractResult.code!);

    // Execute the function with the sandbox API
    await fn(wrappedAPI);

    return {
      stdout,
      stderr,
      exitCode: 0,
      directOutput: true
    };
  } catch (error) {
    // Check if this is an ExitSignal (normal program exit)
    if (error instanceof ExitSignal) {
      return {
        stdout,
        stderr,
        exitCode: error.code,
        directOutput: true
      };
    }

    // Runtime error
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      stdout,
      stderr: stderr + `${metadata!.name}: ${errorMessage}`,
      exitCode: 1,
      directOutput: true
    };
  }
}

/**
 * Execute a pipeline of commands connected by pipes.
 *
 * Pipes (`|`) connect commands by passing stdout from each command
 * to stdin of the next. This enables powerful command composition:
 *
 * ```bash
 * cat file.txt | grep pattern | wc -l
 * ```
 *
 * Execution behavior:
 * - Commands execute sequentially from left to right
 * - stdout of command N becomes stdin of command N+1
 * - stderr from all commands is collected and combined
 * - Exit code is from the last command in the pipeline
 * - If a command fails mid-pipeline, subsequent commands receive empty stdin
 *
 * @param pipeline - Pipeline AST node with array of commands
 * @param ctx - Execution context with env, vfs, etc.
 * @returns Promise resolving to combined result of the pipeline
 *
 * @example
 * // cat file | grep "hello" | wc -l
 * const result = await executePipeline({
 *   type: 'Pipeline',
 *   commands: [
 *     { type: 'Command', command: 'cat', args: ['file'], redirects: [] },
 *     { type: 'Command', command: 'grep', args: ['hello'], redirects: [] },
 *     { type: 'Command', command: 'wc', args: ['-l'], redirects: [] }
 *   ]
 * }, ctx);
 */
export async function executePipeline(
  pipeline: Pipeline,
  ctx: ExecutionContext
): Promise<CommandResult> {
  let input = "";
  let lastResult: CommandResult = { stdout: "", stderr: "", exitCode: 0 };
  let combinedStderr = "";

  for (let i = 0; i < pipeline.commands.length; i++) {
    const cmd = pipeline.commands[i];
    const isLast = i === pipeline.commands.length - 1;

    // Create a context with piped input
    const pipeCtx: ExecutionContext = {
      ...ctx,
      stdin: input
    };

    try {
      // Execute the command
      lastResult = await executeSimpleCommand(cmd, pipeCtx);

      // Collect stderr from all commands in the pipeline
      if (lastResult.stderr) {
        combinedStderr += (combinedStderr ? '\n' : '') + lastResult.stderr;
      }

      // Output becomes input for next command
      input = lastResult.stdout;

      // If command failed and not last, still continue but track error
      if (lastResult.exitCode !== 0 && !isLast) {
        // Pipe continues with empty input on error
        input = "";
      }
    } catch (error) {
      // Handle unexpected errors in pipeline execution
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: "",
        stderr: combinedStderr + (combinedStderr ? '\n' : '') + `${cmd.command}: ${message}`,
        exitCode: 1
      };
    }
  }

  // Return result with combined stderr from all pipeline stages
  return {
    stdout: lastResult.stdout,
    stderr: combinedStderr,
    exitCode: lastResult.exitCode
  };
}

/**
 * Execute a simple command with optional I/O redirects.
 *
 * A simple command is a single command with arguments and redirections.
 * This function handles:
 * - Input redirection (`<`): Read file content into stdin
 * - Output redirection (`>`): Write stdout to file (overwrite)
 * - Append redirection (`>>`): Append stdout to file
 * - Builtin command dispatch
 * - External .trx resolution and execution
 *
 * Command resolution order:
 * 1. Check if command is a builtin (ls, cd, cat, etc.)
 * 2. If not, try to resolve as .trx in PATH
 * 3. If still not found, return "command not found" error
 *
 * @param command - Simple command AST node
 * @param ctx - Execution context with stdin, env, vfs
 * @returns Promise resolving to command result
 *
 * @example
 * // echo hello > file.txt
 * const result = await executeSimpleCommand({
 *   type: 'Command',
 *   command: 'echo',
 *   args: ['hello'],
 *   redirects: [{ type: 'redirect', file: 'file.txt' }]
 * }, ctx);
 */
export async function executeSimpleCommand(
  command: SimpleCommand,
  ctx: ExecutionContext
): Promise<CommandResult> {
  const { command: commandName, args, redirects } = command;

  // Handle input redirection (<) before command execution
  let execCtx = { ...ctx };
  for (const redirect of redirects) {
    if (redirect.type === 'redirect' && redirect.file.startsWith('<')) {
      // This is input redirection - read the file
      const inputFile = redirect.file.substring(1).trim();

      if (!ctx.vfs) {
        return {
          stdout: '',
          stderr: `${inputFile}: no filesystem available`,
          exitCode: 1
        };
      }

      const resolvedPath = ctx.vfs.resolve(inputFile);

      // Check if file exists
      if (!ctx.vfs.exists(resolvedPath)) {
        return {
          stdout: '',
          stderr: `${inputFile}: No such file or directory`,
          exitCode: 1
        };
      }

      // Check if it's a directory
      if (ctx.vfs.isDirectory(resolvedPath)) {
        return {
          stdout: '',
          stderr: `${inputFile}: Is a directory`,
          exitCode: 1
        };
      }

      try {
        const content = await ctx.vfs.read(resolvedPath);
        execCtx.stdin = content || '';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          stdout: '',
          stderr: `${inputFile}: ${message}`,
          exitCode: 1
        };
      }
    }
  }

  // Execute the command
  let result: CommandResult;

  if (isBuiltin(commandName)) {
    const builtin = BUILTIN_COMMANDS[commandName as keyof typeof BUILTIN_COMMANDS];
    if (builtin) {
      try {
        result = await builtin(args, execCtx);
        // Copy back context modifications to original context
        copyContextModifications(execCtx, ctx);
      } catch (error) {
        // Handle unexpected errors from builtin commands
        const message = error instanceof Error ? error.message : String(error);
        result = {
          stdout: '',
          stderr: `${commandName}: ${message}`,
          exitCode: 1
        };
      }
    } else {
      result = {
        stdout: '',
        stderr: `${commandName}: builtin command not implemented`,
        exitCode: 1
      };
    }
  } else {
    // Try to resolve as an executable (.trx file)
    const exePath = resolveExePath(commandName, execCtx);
    if (exePath) {
      try {
        result = await executeExe(exePath, args, execCtx);
      } catch (error) {
        // Handle unexpected errors from executable execution
        const message = error instanceof Error ? error.message : String(error);
        result = {
          stdout: '',
          stderr: `${commandName}: ${message}`,
          exitCode: 1
        };
      }
    } else {
      result = {
        stdout: '',
        stderr: `${commandName}: command not found`,
        exitCode: 127
      };
    }
  }

  // Handle output redirection (> and >>)
  result = await handleRedirects(result, redirects, ctx);

  return result;
}

/**
 * Handle output redirects
 */
async function handleRedirects(
  result: CommandResult,
  redirects: Redirect[],
  ctx: ExecutionContext
): Promise<CommandResult> {
  for (const redirect of redirects) {
    // Skip input redirection - already handled
    if (redirect.file.startsWith('<')) {
      continue;
    }

    if (!ctx.vfs) {
      return {
        stdout: '',
        stderr: `Cannot redirect to ${redirect.file}: no filesystem available`,
        exitCode: 1
      };
    }

    const path = ctx.vfs.resolve(redirect.file);

    try {
      switch (redirect.type) {
        case 'redirect': // >
          await ctx.vfs.write(path, result.stdout);
          result.stdout = "";  // Output was redirected
          break;

        case 'append': // >>
          await ctx.vfs.append(path, result.stdout);
          result.stdout = "";
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: '',
        stderr: `${redirect.file}: ${message}`,
        exitCode: 1
      };
    }
  }

  return result;
}

/**
 * Execute a logical sequence of commands connected by `&&` or `||`.
 *
 * Logical operators control conditional execution:
 * - `&&` (and): Execute right command only if left succeeds (exit code 0)
 * - `||` (or): Execute right command only if left fails (exit code != 0)
 *
 * This enables conditional command chains:
 * ```bash
 * mkdir dir && cd dir     # cd only if mkdir succeeds
 * cat file || echo "fail" # echo only if cat fails
 * ```
 *
 * @param sequence - Logical sequence AST node with left, operator, right
 * @param ctx - Execution context
 * @returns Promise resolving to result of the executed branch
 *
 * @example
 * // mkdir dir && cd dir
 * const result = await executeLogicalSequence({
 *   type: 'LogicalSequence',
 *   left: { type: 'Command', command: 'mkdir', args: ['dir'], redirects: [] },
 *   operator: 'and',
 *   right: { type: 'Command', command: 'cd', args: ['dir'], redirects: [] }
 * }, ctx);
 */
export async function executeLogicalSequence(
  sequence: LogicalSequence,
  ctx: ExecutionContext
): Promise<CommandResult> {
  let leftResult: CommandResult;

  try {
    // Execute the left command
    leftResult = await executeCommand(sequence.left, ctx);
  } catch (error) {
    // Handle unexpected errors in left command
    const message = error instanceof Error ? error.message : String(error);
    leftResult = {
      stdout: '',
      stderr: message,
      exitCode: 1
    };
  }

  // Determine if we should execute the right command
  let shouldExecuteRight = false;
  if (sequence.operator === 'and') {
    // && - execute right only if left succeeded
    shouldExecuteRight = leftResult.exitCode === 0;
  } else {
    // || - execute right only if left failed
    shouldExecuteRight = leftResult.exitCode !== 0;
  }

  if (!shouldExecuteRight) {
    return leftResult;
  }

  try {
    // Execute the right command
    const rightResult = await executeCommand(sequence.right, ctx);
    return rightResult;
  } catch (error) {
    // Handle unexpected errors in right command
    const message = error instanceof Error ? error.message : String(error);
    return {
      stdout: '',
      stderr: message,
      exitCode: 1
    };
  }
}

/**
 * Execute any type of parsed command (main dispatch function).
 *
 * This is the primary entry point for command execution. It dispatches
 * to the appropriate executor based on the command type:
 * - `Command`: Simple command → `executeSimpleCommand()`
 * - `Pipeline`: Piped commands → `executePipeline()`
 * - `LogicalSequence`: &&/|| chains → `executeLogicalSequence()`
 *
 * All errors are caught and converted to CommandResult with exitCode 1.
 *
 * @param command - Parsed command AST node (any type)
 * @param ctx - Execution context with env, vfs, terminal, etc.
 * @returns Promise resolving to command result
 *
 * @example
 * const tokens = tokenize('ls -la | grep txt');
 * const [ast] = buildAST(tokens);
 * const result = await executeCommand(ast, ctx);
 * console.log(result.stdout);
 */
export async function executeCommand(
  command: ParsedCommand,
  ctx: ExecutionContext
): Promise<CommandResult> {
  try {
    switch (command.type) {
      case 'Command':
        return await executeSimpleCommand(command, ctx);
      case 'Pipeline':
        return await executePipeline(command, ctx);
      case 'LogicalSequence':
        return await executeLogicalSequence(command, ctx);
      default:
        return {
          stdout: '',
          stderr: 'Unknown command type',
          exitCode: 1
        };
    }
  } catch (error) {
    // Catch any unexpected errors during command execution
    const message = error instanceof Error ? error.message : String(error);
    return {
      stdout: '',
      stderr: message,
      exitCode: 1
    };
  }
}

/**
 * Copy context modifications from one context to another
 * This ensures that state changes (like export requests) propagate
 * from the execution context back to the original context
 */
function copyContextModifications(from: any, to: any): void {
  const modifiableKeys = [
    'exportRequests',
    'unsetRequests',
    'aliasRequests',
    'unaliasRequests',
    'sourceCommands',
    'requestedCd',
    'exitRequested'
  ];

  for (const key of modifiableKeys) {
    if (from[key] !== undefined) {
      to[key] = from[key];
    }
  }
}

/**
 * Check if a command is a builtin
 */
function isBuiltin(command: string): boolean {
  // Use BUILTIN_COMMANDS keys to dynamically check for builtins
  return command in BUILTIN_COMMANDS;
}
