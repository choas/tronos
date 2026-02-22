import type { BuiltinCommand } from '../types';

/**
 * Executes commands from a file in the current shell environment.
 * Supports both `source file` and `. file` syntax.
 * Processes the file line by line.
 */
export const source: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'source: missing file operand',
      exitCode: 1
    };
  }

  const filePath = args[0];

  try {
    // Read the file using VFS
    if (!context.vfs) {
      return {
        stdout: '',
        stderr: 'source: VFS not available',
        exitCode: 1
      };
    }

    if (!context.vfs.exists(filePath)) {
      return {
        stdout: '',
        stderr: `source: ${filePath}: No such file or directory`,
        exitCode: 1
      };
    }

    const stat = context.vfs.stat(filePath);
    if (stat.type === 'directory') {
      return {
        stdout: '',
        stderr: `source: ${filePath}: Is a directory`,
        exitCode: 1
      };
    }

    const content = await context.vfs.read(filePath);

    // Store the commands to execute in the context
    // The shell will need to handle these after the builtin returns
    const lines = content.split('\n').filter((line: string) => {
      const trimmed = line.trim();
      // Skip empty lines and comments
      return trimmed !== '' && !trimmed.startsWith('#');
    });

    // Store the source commands in the context for the shell to execute
    (context as any).sourceCommands = lines;

    return {
      stdout: '',
      stderr: '',
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: `source: ${filePath}: ${(error as Error).message}`,
      exitCode: 1
    };
  }
};

/**
 * The dot (.) command is an alias for source.
 * It executes commands from a file in the current shell environment.
 */
export const dot: BuiltinCommand = source;
