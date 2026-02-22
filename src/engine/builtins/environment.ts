import type { BuiltinCommand } from '../types';

/**
 * whoami - Print the current username
 * Usage: whoami
 * Prints the value of the USER environment variable
 */
export const whoami: BuiltinCommand = async (_args, context) => {
  const user = context.env.USER || 'unknown';
  return {
    stdout: user,
    stderr: '',
    exitCode: 0
  };
};

/**
 * env - Display all environment variables
 * Usage: env
 * Lists all environment variables in KEY=value format
 */
export const env: BuiltinCommand = async (_args, context) => {
  const entries = Object.entries(context.env);

  if (entries.length === 0) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0
    };
  }

  const output = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  return {
    stdout: output,
    stderr: '',
    exitCode: 0
  };
};

/**
 * export - Set an environment variable
 * Usage: export KEY=value
 *        export KEY (displays value)
 *        export (lists all exported variables)
 */
export const exportCmd: BuiltinCommand = async (args, context) => {
  // No arguments: list all exported variables (same as env)
  if (args.length === 0) {
    const entries = Object.entries(context.env);
    const output = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `declare -x ${key}="${value}"`)
      .join('\n');

    return {
      stdout: output,
      stderr: '',
      exitCode: 0
    };
  }

  // Process each argument
  for (const arg of args) {
    const equalIndex = arg.indexOf('=');

    if (equalIndex === -1) {
      // Just a key name, display its value if set
      const value = context.env[arg];
      if (value !== undefined) {
        // Mark it as exported (for bash compatibility, we just acknowledge it)
        continue;
      } else {
        // Variable doesn't exist - in bash, this just marks the name for export
        continue;
      }
    }

    // KEY=value format
    const key = arg.slice(0, equalIndex);
    const value = arg.slice(equalIndex + 1);

    if (!key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      return {
        stdout: '',
        stderr: `export: '${key}': not a valid identifier`,
        exitCode: 1
      };
    }

    // Store the export request in context for the shell to process
    const exportRequests = (context as any).exportRequests || [];
    exportRequests.push({ key, value });
    (context as any).exportRequests = exportRequests;
  }

  return {
    stdout: '',
    stderr: '',
    exitCode: 0
  };
};

/**
 * unset - Remove an environment variable
 * Usage: unset KEY [KEY2 ...]
 */
export const unset: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0
    };
  }

  const errors: string[] = [];

  for (const key of args) {
    // Validate the variable name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      errors.push(`unset: '${key}': not a valid identifier`);
      continue;
    }

    // Store the unset request in context for the shell to process
    const unsetRequests = (context as any).unsetRequests || [];
    unsetRequests.push(key);
    (context as any).unsetRequests = unsetRequests;
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
