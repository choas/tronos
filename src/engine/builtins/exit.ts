import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";

/**
 * Exit/quit builtin command.
 *
 * Usage:
 *   exit [code]  - Exit the shell with optional exit code (default: 0)
 *   quit [code]  - Alias for exit
 *
 * In CLI mode: terminates the process with the given exit code.
 * In browser mode: shows a message to close the browser tab.
 */
export const exit: BuiltinCommand = async (
  args: string[],
  context: ExecutionContext
): Promise<CommandResult> => {
  let code = 0;

  if (args.length > 0) {
    const parsed = parseInt(args[0], 10);
    if (isNaN(parsed)) {
      return {
        stdout: "",
        stderr: `exit: ${args[0]}: numeric argument required\n`,
        exitCode: 2,
      };
    }
    code = parsed;
  }

  // Signal to the shell that exit was requested
  (context as any).exitRequested = { code };

  return {
    stdout: "",
    stderr: "",
    exitCode: code,
  };
};
