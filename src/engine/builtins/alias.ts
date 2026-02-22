import type { BuiltinCommand } from '../types';

/**
 * alias - Define or display aliases
 * Usage: alias                    Lists all aliases
 *        alias name               Shows definition of alias 'name'
 *        alias name='command'     Defines alias 'name' as 'command'
 *        alias name=command       Same as above (quotes optional)
 */
export const alias: BuiltinCommand = async (args, context) => {
  // Get current aliases from context
  const aliases: Map<string, string> = (context as any).aliases || new Map();

  // No arguments: list all aliases
  if (args.length === 0) {
    if (aliases.size === 0) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0
      };
    }

    const output = Array.from(aliases.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, command]) => `alias ${name}='${command}'`)
      .join('\n');

    return {
      stdout: output,
      stderr: '',
      exitCode: 0
    };
  }

  const errors: string[] = [];
  const aliasRequests: Array<{ action: 'add'; name: string; command: string }> = [];

  for (const arg of args) {
    const equalIndex = arg.indexOf('=');

    if (equalIndex === -1) {
      // Just a name - display the alias if it exists
      const name = arg;
      if (aliases.has(name)) {
        const command = aliases.get(name)!;
        return {
          stdout: `alias ${name}='${command}'`,
          stderr: '',
          exitCode: 0
        };
      } else {
        errors.push(`alias: ${name}: not found`);
      }
      continue;
    }

    // name=command or name='command' format
    const name = arg.slice(0, equalIndex);
    let command = arg.slice(equalIndex + 1);

    // Remove surrounding quotes if present
    if ((command.startsWith("'") && command.endsWith("'")) ||
        (command.startsWith('"') && command.endsWith('"'))) {
      command = command.slice(1, -1);
    }

    // Validate the alias name
    // Bash allows most characters in alias names, including dots
    // Reject empty names, names starting with digits, or names containing special shell characters
    if (!name || /^[0-9]/.test(name) || /[=\s|&;><]/.test(name)) {
      errors.push(`alias: '${name}': invalid alias name`);
      continue;
    }

    // Store the alias request for the shell to process
    aliasRequests.push({ action: 'add', name, command });
  }

  // Store requests in context for shell to process
  if (aliasRequests.length > 0) {
    (context as any).aliasRequests = aliasRequests;
  }

  if (errors.length > 0) {
    return {
      stdout: '',
      stderr: errors.join('\n'),
      exitCode: 1
    };
  }

  return {
    stdout: '',
    stderr: '',
    exitCode: 0
  };
};

/**
 * unalias - Remove alias definitions
 * Usage: unalias name [name2 ...]    Removes the specified aliases
 *        unalias -a                   Removes all aliases
 */
export const unalias: BuiltinCommand = async (args, context) => {
  // Get current aliases from context
  const aliases: Map<string, string> = (context as any).aliases || new Map();

  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'unalias: usage: unalias [-a] name [name ...]',
      exitCode: 1
    };
  }

  const errors: string[] = [];
  const unaliasRequests: Array<{ action: 'remove'; name: string } | { action: 'removeAll' }> = [];

  for (const arg of args) {
    if (arg === '-a') {
      // Remove all aliases
      unaliasRequests.push({ action: 'removeAll' });
      continue;
    }

    // Validate the alias name (must match alias validation - allow dots and other non-shell chars)
    if (!arg || /^[0-9]/.test(arg) || /[=\s|&;><]/.test(arg)) {
      errors.push(`unalias: '${arg}': invalid alias name`);
      continue;
    }

    // Check if alias exists
    if (!aliases.has(arg)) {
      errors.push(`unalias: ${arg}: not found`);
      continue;
    }

    unaliasRequests.push({ action: 'remove', name: arg });
  }

  // Store requests in context for shell to process
  if (unaliasRequests.length > 0) {
    (context as any).unaliasRequests = unaliasRequests;
  }

  if (errors.length > 0) {
    return {
      stdout: '',
      stderr: errors.join('\n'),
      exitCode: 1
    };
  }

  return {
    stdout: '',
    stderr: '',
    exitCode: 0
  };
};
