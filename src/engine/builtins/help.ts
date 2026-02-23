import type { BuiltinCommand } from '../types';

// Default terminal width if not available
const DEFAULT_TERMINAL_WIDTH = 80;
// Minimum width before switching to single column mode
const NARROW_SCREEN_THRESHOLD = 60;

// Help text for each builtin command
const COMMAND_HELP: Record<string, { usage: string; description: string; examples?: string[] }> = {
  ls: {
    usage: 'ls [-l] [-a] [-h] [path...]',
    description: 'List directory contents',
    examples: ['ls', 'ls -la', 'ls -lh /bin']
  },
  cd: {
    usage: 'cd [directory]',
    description: 'Change the current directory. Use ~ for home directory.',
    examples: ['cd', 'cd ~', 'cd /home/user', 'cd ..']
  },
  pwd: {
    usage: 'pwd',
    description: 'Print the current working directory'
  },
  cat: {
    usage: 'cat [file...]',
    description: 'Concatenate and display file contents',
    examples: ['cat file.txt', 'cat file1.txt file2.txt']
  },
  echo: {
    usage: 'echo [string...]',
    description: 'Display a line of text. Supports escape sequences like \\n, \\t.',
    examples: ['echo hello', 'echo "Hello World"', 'echo -e "line1\\nline2"']
  },
  mkdir: {
    usage: 'mkdir [-p] directory...',
    description: 'Create directories. Use -p to create parent directories as needed.',
    examples: ['mkdir mydir', 'mkdir -p path/to/nested/dir']
  },
  touch: {
    usage: 'touch file...',
    description: 'Create empty files or update file timestamps',
    examples: ['touch newfile.txt', 'touch file1 file2 file3']
  },
  rm: {
    usage: 'rm [-r] [-f] file...',
    description: 'Remove files or directories. Use -r for recursive, -f for force.',
    examples: ['rm file.txt', 'rm -r mydir', 'rm -rf unwanted/']
  },
  cp: {
    usage: 'cp [-r] source destination',
    description: 'Copy files or directories. Use -r for recursive copy.',
    examples: ['cp file.txt backup.txt', 'cp -r dir1 dir2']
  },
  mv: {
    usage: 'mv source destination',
    description: 'Move or rename files and directories',
    examples: ['mv oldname.txt newname.txt', 'mv file.txt /home/user/']
  },
  head: {
    usage: 'head [-n count] [file]',
    description: 'Display the first lines of a file (default: 10 lines)',
    examples: ['head file.txt', 'head -n 5 file.txt']
  },
  tail: {
    usage: 'tail [-n count] [file]',
    description: 'Display the last lines of a file (default: 10 lines)',
    examples: ['tail file.txt', 'tail -n 20 file.txt']
  },
  grep: {
    usage: 'grep pattern [file...]',
    description: 'Search for patterns in files using regular expressions',
    examples: ['grep "error" log.txt', 'grep -i "warning" *.log']
  },
  wc: {
    usage: 'wc [-l] [-w] [-c] [file...]',
    description: 'Count lines, words, and characters in files',
    examples: ['wc file.txt', 'wc -l file.txt', 'wc -w file.txt']
  },
  clear: {
    usage: 'clear',
    description: 'Clear the terminal screen'
  },
  history: {
    usage: 'history [count]',
    description: 'Display command history. Optionally limit to last N commands.',
    examples: ['history', 'history 10']
  },
  env: {
    usage: 'env',
    description: 'Display all environment variables'
  },
  export: {
    usage: 'export [NAME=value]',
    description: 'Set environment variables. Without arguments, lists all exported variables.',
    examples: ['export', 'export PATH=/bin', 'export MY_VAR="hello world"']
  },
  unset: {
    usage: 'unset NAME...',
    description: 'Remove environment variables',
    examples: ['unset MY_VAR', 'unset VAR1 VAR2']
  },
  alias: {
    usage: 'alias [name[=value]]',
    description: 'Define or display aliases. Without arguments, lists all aliases.',
    examples: ['alias', 'alias ll', "alias ll='ls -la'"]
  },
  unalias: {
    usage: 'unalias [-a] name...',
    description: 'Remove aliases. Use -a to remove all aliases.',
    examples: ['unalias ll', 'unalias -a']
  },
  which: {
    usage: 'which command...',
    description: 'Show the full path or type of a command',
    examples: ['which ls', 'which cat echo']
  },
  type: {
    usage: 'type command...',
    description: 'Display information about command type (builtin, alias, or file)',
    examples: ['type ls', 'type ll cd']
  },
  help: {
    usage: 'help [command]',
    description: 'Display help information. Without arguments, lists all commands.',
    examples: ['help', 'help ls', 'help cd']
  },
  man: {
    usage: 'man [command]',
    description: 'Display detailed manual pages for commands. Includes sections for NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXAMPLES.',
    examples: ['man ls', 'man grep', 'man man']
  },
  config: {
    usage: 'config [show|set <key> <value>|reset|ui]',
    description: 'Configure AI settings. Use "config show" to display current settings, "config set" to change values.',
    examples: ['config show', 'config set apiKey sk-...', 'config set provider anthropic', 'config set accept-terms true', 'config reset']
  },
  tpkg: {
    usage: 'tpkg <command> [arguments]',
    description: 'TronOS Package Manager - install, update, and manage packages from repositories.',
    examples: [
      'tpkg update',
      'tpkg search weather',
      'tpkg install weather',
      'tpkg list',
      'tpkg info weather',
      'tpkg config weather',
      'tpkg uninstall weather'
    ]
  },
  timewarp: {
    usage: 'timewarp <subcommand> <file> [args...]',
    description: 'File version control - list, show, revert, diff, save versions and manage branches.',
    examples: [
      'timewarp list myfile.txt',
      'timewarp show myfile.txt abc12345',
      'timewarp revert myfile.txt abc12345',
      'timewarp diff myfile.txt abc12345',
      'timewarp save myfile.txt "Added feature"',
      'timewarp branches myfile.txt'
    ]
  },
  feedback: {
    usage: 'feedback <message> | feedback list | feedback show <id> | feedback clear',
    description: 'Submit and manage user feedback. Feedback is stored in the /feedback folder.',
    examples: [
      'feedback This feature is great!',
      'feedback "I found a bug in the ls command"',
      'feedback list',
      'feedback show 2024-01',
      'feedback clear'
    ]
  },
  update: {
    usage: 'update [--apply] [--skip|--overwrite] [--rollback] [--history] [--dry-run]',
    description: 'TronOS system update mechanism. Upgrades system files while preserving user changes via timewarp versioning.',
    examples: [
      'update',
      'update --apply',
      'update --apply --skip',
      'update --apply --overwrite',
      'update --rollback',
      'update --history'
    ]
  }
};

/**
 * Wrap text to fit within a given width, respecting word boundaries.
 * @param text The text to wrap
 * @param width Maximum line width
 * @param indent Number of spaces to indent continuation lines
 * @returns Array of wrapped lines
 */
function wrapText(text: string, width: number, indent: number = 0): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  const indentStr = ' '.repeat(indent);

  for (const word of words) {
    const lineWithWord = currentLine ? `${currentLine} ${word}` : word;
    const effectiveWidth = lines.length === 0 ? width : width - indent;

    if (lineWithWord.length <= effectiveWidth) {
      currentLine = lineWithWord;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Word is longer than width, add it anyway
        lines.push(word);
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  // Add indent to continuation lines
  return lines.map((line, i) => i === 0 ? line : indentStr + line);
}

/**
 * Format a list of commands to fit the terminal width.
 * Uses multiple columns for wide screens, single column for narrow screens.
 */
function formatCommandList(commands: string[], termWidth: number, indent: number = 4): string {
  if (termWidth < NARROW_SCREEN_THRESHOLD) {
    // Single column mode for narrow screens
    const indentStr = ' '.repeat(indent);
    return commands.map(cmd => indentStr + cmd).join('\n');
  }

  // Multiple column mode - calculate optimal column width
  const maxCmdLength = Math.max(...commands.map(c => c.length));
  const columnWidth = maxCmdLength + 2; // 2 spaces between columns
  const availableWidth = termWidth - indent;
  const numColumns = Math.max(1, Math.floor(availableWidth / columnWidth));

  const lines: string[] = [];
  const indentStr = ' '.repeat(indent);

  for (let i = 0; i < commands.length; i += numColumns) {
    const row = commands.slice(i, i + numColumns);
    const formattedRow = row.map(cmd => cmd.padEnd(columnWidth)).join('');
    lines.push(indentStr + formattedRow.trimEnd());
  }

  return lines.join('\n');
}

/**
 * help - Display help for shell commands
 * Usage: help [command]
 * Without arguments: displays a list of all available commands
 * With a command name: displays detailed help for that command
 */
export const help: BuiltinCommand = async (args, context) => {
  // Get terminal width from context, or use default
  const termWidth = context.size?.cols ?? DEFAULT_TERMINAL_WIDTH;

  if (args.length === 0) {
    // List all available commands
    const output: string[] = [];

    // Header - adjust based on width
    const header = 'TronOS Shell - Available Commands';
    output.push(header);
    output.push('='.repeat(Math.min(header.length, termWidth - 1)));
    output.push('');
    output.push('Built-in commands:');

    // Group commands by category for better organization
    const categories: Record<string, string[]> = {
      'File System': ['ls', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv'],
      'Text Processing': ['echo', 'head', 'tail', 'grep', 'wc'],
      'Environment': ['env', 'export', 'unset'],
      'Shell': ['alias', 'unalias', 'which', 'type', 'clear', 'history', 'help', 'man', 'config'],
      'Package Management': ['tpkg'],
      'Version Control': ['timewarp'],
      'System': ['update'],
      'Feedback': ['feedback']
    };

    for (const [category, commands] of Object.entries(categories)) {
      output.push(`  ${category}:`);
      output.push(formatCommandList(commands, termWidth, 4));
    }

    output.push('');

    // Hint text - wrap if needed
    const hint = 'Type "help <command>" for more information on a specific command.';
    const wrappedHint = wrapText(hint, termWidth);
    output.push(...wrappedHint);

    output.push('');
    output.push('Special syntax:');

    // Syntax help - adjust formatting for narrow screens
    if (termWidth < NARROW_SCREEN_THRESHOLD) {
      // Compact format for narrow screens
      output.push('  |   Pipe output');
      output.push('  >   Redirect (overwrite)');
      output.push('  >>  Redirect (append)');
      output.push('  &&  Run if success');
      output.push('  ||  Run if failure');
    } else {
      output.push('  command1 | command2    Pipe output from command1 to command2');
      output.push('  command > file         Redirect output to file (overwrite)');
      output.push('  command >> file        Redirect output to file (append)');
      output.push('  command1 && command2   Run command2 only if command1 succeeds');
      output.push('  command1 || command2   Run command2 only if command1 fails');
    }

    output.push('');
    output.push('AI Integration:');
    output.push('  @ai <request>          Ask the AI assistant for help');

    output.push('');
    output.push('Configuration:');
    if (termWidth < NARROW_SCREEN_THRESHOLD) {
      // Compact format for narrow screens
      output.push('  Set API key:');
      output.push('    config set apiKey <key>');
      output.push('  Set provider:');
      output.push('    config set provider');
      output.push('      anthropic|openai|');
      output.push('      openrouter|ollama');
      output.push('  Show config:');
      output.push('    config show');
      output.push('  Environment vars:');
      output.push('    TRONOS_API_KEY');
      output.push('    TRONOS_AI_PROVIDER');
    } else {
      output.push('  config set apiKey <your-key>            Set your API key');
      output.push('  config set provider anthropic|openai|openrouter|ollama');
      output.push('                                          Set AI provider');
      output.push('  config show                             Display current configuration');
      output.push('  Environment variables: TRONOS_API_KEY, TRONOS_AI_PROVIDER');
    }

    return {
      stdout: output.join('\n'),
      stderr: '',
      exitCode: 0
    };
  }

  // Show help for a specific command
  const command = args[0];
  const helpInfo = COMMAND_HELP[command];

  if (!helpInfo) {
    // Check if it's an executable in /bin
    if (context.vfs) {
      const exePath = `/bin/${command}.trx`;
      if (context.vfs.exists(exePath) && context.vfs.isFile(exePath)) {
        return {
          stdout: `${command}: executable file at ${exePath}\nRun "${command}" to execute it.`,
          stderr: '',
          exitCode: 0
        };
      }
    }

    return {
      stdout: '',
      stderr: `help: no help topics match \`${command}'. Try 'help' for a list of commands.`,
      exitCode: 1
    };
  }

  const output: string[] = [];
  output.push(`${command}: ${helpInfo.description}`);
  output.push('');
  output.push(`Usage: ${helpInfo.usage}`);

  if (helpInfo.examples && helpInfo.examples.length > 0) {
    output.push('');
    output.push('Examples:');
    for (const example of helpInfo.examples) {
      output.push(`  ${example}`);
    }
  }

  return {
    stdout: output.join('\n'),
    stderr: '',
    exitCode: 0
  };
};
