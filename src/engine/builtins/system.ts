import type { BuiltinCommand } from '../types';
import { VERSION } from '../../version';

export const clear: BuiltinCommand = async (_args, context) => {
  // Clear the terminal screen by calling the terminal's clear method
  if (context.terminal && context.terminal.clear) {
    context.terminal.clear();
  }
  
  return {
    stdout: '',
    stderr: '',
    exitCode: 0
  };
};

export const history: BuiltinCommand = async (args, context) => {
  // Get history from shell context if available
  const history = (context as any).history || [];
  
  let count = history.length; // Default: show all history
  
  // Parse arguments for optional count
  if (args.length > 0) {
    const countArg = parseInt(args[0]);
    if (!isNaN(countArg) && countArg >= 0) {
      count = countArg;
    } else {
      return {
        stdout: '',
        stderr: `history: invalid argument '${args[0]}'`,
        exitCode: 1
      };
    }
  }
  
  // Get the last 'count' commands from history
  const startIndex = Math.max(0, history.length - count);
  const relevantHistory = history.slice(startIndex);
  
  // Format history with line numbers
  let output = '';
  for (let i = 0; i < relevantHistory.length; i++) {
    const lineNumber = startIndex + i + 1;
    output += `${lineNumber.toString().padStart(6)}  ${relevantHistory[i]}\n`;
  }
  
  return {
    stdout: output.trim(),
    stderr: '',
    exitCode: 0
  };
};

/**
 * Display TronOS version number.
 *
 * @example
 * version        # Output: 0.1.0
 */
export const version: BuiltinCommand = async () => {
  return {
    stdout: VERSION,
    stderr: '',
    exitCode: 0
  };
};