import type { BuiltinCommand } from '../types';

// Complete list of all builtin command names
// Must be kept in sync with BUILTIN_COMMANDS in index.ts
const BUILTIN_NAMES = new Set([
  'ls', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'cp', 'mv',
  'head', 'tail', 'grep', 'wc', 'clear', 'history', 'version', 'whoami',
  'env', 'export', 'unset', 'alias', 'unalias', 'which', 'type',
  'help', 'man', 'source', '.', 'session', 'config', '@ai',
  'curl', 'fetch', 'theme', 'reset', 'factory-reset', 'boot',
  'tpkg', 'feedback', 'timewarp', 'cron', 'update', 'exit', 'quit'
]);

/**
 * which - Show the full path of a command
 * Usage: which <command> [command...]
 * Shows the full path of a command:
 * - For builtins: displays "<command>: shell built-in command"
 * - For aliases: displays the aliased command
 * - For executables: displays the path (e.g., /bin/<command>.trx)
 */
export const which: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0
    };
  }

  const outputs: string[] = [];
  const errors: string[] = [];
  let hasError = false;

  for (const cmd of args) {
    // Check if it's an alias first
    if (context.aliases && context.aliases.has(cmd)) {
      const aliasValue = context.aliases.get(cmd)!;
      outputs.push(`${cmd}: aliased to ${aliasValue}`);
      continue;
    }

    // Check if it's a builtin command
    if (BUILTIN_NAMES.has(cmd)) {
      outputs.push(`${cmd}: shell built-in command`);
      continue;
    }

    // Check if it exists as an executable in /bin
    if (context.vfs) {
      const exePath = `/bin/${cmd}.trx`;
      if (context.vfs.exists(exePath) && context.vfs.isFile(exePath)) {
        outputs.push(exePath);
        continue;
      }
    }

    // Command not found
    errors.push(`which: ${cmd}: not found`);
    hasError = true;
  }

  return {
    stdout: outputs.join('\n'),
    stderr: errors.join('\n'),
    exitCode: hasError ? 1 : 0
  };
};

/**
 * type - Display information about command type
 * Usage: type <command> [command...]
 * Shows what type of command each argument is:
 * - builtin: a shell built-in command
 * - alias: an alias with its definition
 * - file: an executable file with its path
 */
export const type: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'type: usage: type name [name ...]',
      exitCode: 1
    };
  }

  const outputs: string[] = [];
  const errors: string[] = [];
  let hasError = false;

  for (const cmd of args) {
    // Check if it's an alias first (aliases shadow other definitions)
    if (context.aliases && context.aliases.has(cmd)) {
      const aliasValue = context.aliases.get(cmd)!;
      outputs.push(`${cmd} is aliased to \`${aliasValue}'`);
      continue;
    }

    // Check if it's a builtin command
    if (BUILTIN_NAMES.has(cmd)) {
      outputs.push(`${cmd} is a shell builtin`);
      continue;
    }

    // Check if it exists as an executable in /bin
    if (context.vfs) {
      const exePath = `/bin/${cmd}.trx`;
      if (context.vfs.exists(exePath) && context.vfs.isFile(exePath)) {
        outputs.push(`${cmd} is ${exePath}`);
        continue;
      }
    }

    // Command not found
    errors.push(`-bash: type: ${cmd}: not found`);
    hasError = true;
  }

  return {
    stdout: outputs.join('\n'),
    stderr: errors.join('\n'),
    exitCode: hasError ? 1 : 0
  };
};
