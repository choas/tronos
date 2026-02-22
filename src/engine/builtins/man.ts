import type { BuiltinCommand } from '../types';

/**
 * ANSI escape codes for terminal formatting
 */
const ANSI = {
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

/**
 * Format text with bold ANSI styling
 */
function bold(text: string): string {
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

/**
 * Man page section names in standard order
 */
const SECTION_ORDER = ['NAME', 'SYNOPSIS', 'DESCRIPTION', 'OPTIONS', 'EXAMPLES', 'SEE ALSO', 'ENVIRONMENT', 'EXIT STATUS'];

/**
 * Extended man page data for builtin commands
 * Each entry contains structured sections following the standard man page format
 */
interface ManPageSection {
  name: string;
  content: string[];
}

interface ManPage {
  name: string;
  section: string;
  sections: ManPageSection[];
}

/**
 * Complete man pages for all builtin commands
 */
const MAN_PAGES: Record<string, ManPage> = {
  ls: {
    name: 'ls',
    section: '1',
    sections: [
      { name: 'NAME', content: ['ls - list directory contents'] },
      { name: 'SYNOPSIS', content: ['ls [-l] [-a] [-h] [path...]'] },
      { name: 'DESCRIPTION', content: [
        'List information about files and directories (the current directory by default).',
        'Entries are sorted alphabetically.'
      ]},
      { name: 'OPTIONS', content: [
        '-l    Use long listing format showing permissions, size, and modification time',
        '-a    Do not ignore entries starting with . (dot files)',
        '-h    With -l, print sizes in human readable format (e.g., 1K, 234M)'
      ]},
      { name: 'EXAMPLES', content: [
        'ls              List current directory',
        'ls -la          List all files in long format',
        'ls -lh /bin     List /bin with human-readable sizes'
      ]},
      { name: 'SEE ALSO', content: ['cd(1), pwd(1), mkdir(1)'] }
    ]
  },
  cd: {
    name: 'cd',
    section: '1',
    sections: [
      { name: 'NAME', content: ['cd - change the working directory'] },
      { name: 'SYNOPSIS', content: ['cd [directory]'] },
      { name: 'DESCRIPTION', content: [
        'Change the current working directory to the specified directory.',
        'If no directory is specified, changes to the home directory ($HOME).',
        'The special path ~ expands to the home directory.',
        'The special path - changes to the previous working directory.'
      ]},
      { name: 'EXAMPLES', content: [
        'cd           Change to home directory',
        'cd ~         Same as above',
        'cd /tmp      Change to /tmp directory',
        'cd ..        Move up one directory',
        'cd -         Return to previous directory'
      ]},
      { name: 'ENVIRONMENT', content: [
        'HOME    The home directory used when cd is called without arguments',
        'OLDPWD  The previous working directory, used by cd -'
      ]},
      { name: 'SEE ALSO', content: ['pwd(1), ls(1)'] }
    ]
  },
  pwd: {
    name: 'pwd',
    section: '1',
    sections: [
      { name: 'NAME', content: ['pwd - print name of current/working directory'] },
      { name: 'SYNOPSIS', content: ['pwd'] },
      { name: 'DESCRIPTION', content: [
        'Print the full filename of the current working directory.'
      ]},
      { name: 'SEE ALSO', content: ['cd(1), ls(1)'] }
    ]
  },
  cat: {
    name: 'cat',
    section: '1',
    sections: [
      { name: 'NAME', content: ['cat - concatenate files and print on the standard output'] },
      { name: 'SYNOPSIS', content: ['cat [file...]'] },
      { name: 'DESCRIPTION', content: [
        'Concatenate FILE(s) to standard output.',
        'If no files are specified, reads from standard input.'
      ]},
      { name: 'EXAMPLES', content: [
        'cat file.txt              Display contents of file.txt',
        'cat file1.txt file2.txt   Display contents of both files',
        'echo "text" | cat         Read from stdin'
      ]},
      { name: 'SEE ALSO', content: ['head(1), tail(1), echo(1)'] }
    ]
  },
  echo: {
    name: 'echo',
    section: '1',
    sections: [
      { name: 'NAME', content: ['echo - display a line of text'] },
      { name: 'SYNOPSIS', content: ['echo [-n] [-e] [string...]'] },
      { name: 'DESCRIPTION', content: [
        'Echo the STRING(s) to standard output.',
        'Strings are separated by spaces.'
      ]},
      { name: 'OPTIONS', content: [
        '-n    Do not output a trailing newline',
        '-e    Enable interpretation of backslash escapes:'
      ]},
      { name: 'EXAMPLES', content: [
        'echo hello world          Output: hello world',
        'echo -n "no newline"      Output without trailing newline',
        'echo -e "line1\\nline2"   Output with newline in the middle'
      ]},
      { name: 'SEE ALSO', content: ['cat(1), printf(1)'] }
    ]
  },
  mkdir: {
    name: 'mkdir',
    section: '1',
    sections: [
      { name: 'NAME', content: ['mkdir - make directories'] },
      { name: 'SYNOPSIS', content: ['mkdir [-p] directory...'] },
      { name: 'DESCRIPTION', content: [
        'Create the DIRECTORY(ies), if they do not already exist.'
      ]},
      { name: 'OPTIONS', content: [
        '-p    Make parent directories as needed, no error if existing'
      ]},
      { name: 'EXAMPLES', content: [
        'mkdir mydir                Create a single directory',
        'mkdir -p path/to/nested    Create nested directories'
      ]},
      { name: 'SEE ALSO', content: ['rm(1), rmdir(1), ls(1)'] }
    ]
  },
  touch: {
    name: 'touch',
    section: '1',
    sections: [
      { name: 'NAME', content: ['touch - change file timestamps or create empty files'] },
      { name: 'SYNOPSIS', content: ['touch file...'] },
      { name: 'DESCRIPTION', content: [
        'Update the access and modification times of each FILE to the current time.',
        'A FILE that does not exist is created empty.'
      ]},
      { name: 'EXAMPLES', content: [
        'touch newfile.txt         Create new empty file',
        'touch file1 file2 file3   Create multiple files'
      ]},
      { name: 'SEE ALSO', content: ['mkdir(1), rm(1)'] }
    ]
  },
  rm: {
    name: 'rm',
    section: '1',
    sections: [
      { name: 'NAME', content: ['rm - remove files or directories'] },
      { name: 'SYNOPSIS', content: ['rm [-r] [-f] file...'] },
      { name: 'DESCRIPTION', content: [
        'Remove (unlink) the FILE(s).',
        'By default, rm does not remove directories.'
      ]},
      { name: 'OPTIONS', content: [
        '-r    Remove directories and their contents recursively',
        '-f    Ignore nonexistent files and arguments, never prompt'
      ]},
      { name: 'EXAMPLES', content: [
        'rm file.txt         Remove a single file',
        'rm -r mydir         Remove directory and contents',
        'rm -rf unwanted/    Force remove without errors'
      ]},
      { name: 'SEE ALSO', content: ['mkdir(1), touch(1), cp(1), mv(1)'] }
    ]
  },
  cp: {
    name: 'cp',
    section: '1',
    sections: [
      { name: 'NAME', content: ['cp - copy files and directories'] },
      { name: 'SYNOPSIS', content: ['cp [-r] source destination'] },
      { name: 'DESCRIPTION', content: [
        'Copy SOURCE to DEST, or multiple SOURCE(s) to DIRECTORY.'
      ]},
      { name: 'OPTIONS', content: [
        '-r    Copy directories recursively'
      ]},
      { name: 'EXAMPLES', content: [
        'cp file.txt backup.txt    Copy file to new name',
        'cp -r dir1 dir2           Copy directory recursively'
      ]},
      { name: 'SEE ALSO', content: ['mv(1), rm(1), mkdir(1)'] }
    ]
  },
  mv: {
    name: 'mv',
    section: '1',
    sections: [
      { name: 'NAME', content: ['mv - move (rename) files'] },
      { name: 'SYNOPSIS', content: ['mv source destination'] },
      { name: 'DESCRIPTION', content: [
        'Rename SOURCE to DEST, or move SOURCE(s) to DIRECTORY.'
      ]},
      { name: 'EXAMPLES', content: [
        'mv oldname.txt newname.txt    Rename a file',
        'mv file.txt /home/user/       Move file to directory'
      ]},
      { name: 'SEE ALSO', content: ['cp(1), rm(1)'] }
    ]
  },
  head: {
    name: 'head',
    section: '1',
    sections: [
      { name: 'NAME', content: ['head - output the first part of files'] },
      { name: 'SYNOPSIS', content: ['head [-n count] [file]'] },
      { name: 'DESCRIPTION', content: [
        'Print the first 10 lines of each FILE to standard output.',
        'With more than one FILE, precede each with a header giving the file name.',
        'If no file is specified, reads from standard input.'
      ]},
      { name: 'OPTIONS', content: [
        '-n count    Print the first COUNT lines instead of the first 10'
      ]},
      { name: 'EXAMPLES', content: [
        'head file.txt           Show first 10 lines',
        'head -n 5 file.txt      Show first 5 lines',
        'cat file | head -n 3    Read from stdin'
      ]},
      { name: 'SEE ALSO', content: ['tail(1), cat(1)'] }
    ]
  },
  tail: {
    name: 'tail',
    section: '1',
    sections: [
      { name: 'NAME', content: ['tail - output the last part of files'] },
      { name: 'SYNOPSIS', content: ['tail [-n count] [file]'] },
      { name: 'DESCRIPTION', content: [
        'Print the last 10 lines of each FILE to standard output.',
        'If no file is specified, reads from standard input.'
      ]},
      { name: 'OPTIONS', content: [
        '-n count    Print the last COUNT lines instead of the last 10'
      ]},
      { name: 'EXAMPLES', content: [
        'tail file.txt           Show last 10 lines',
        'tail -n 20 file.txt     Show last 20 lines',
        'cat file | tail -n 5    Read from stdin'
      ]},
      { name: 'SEE ALSO', content: ['head(1), cat(1)'] }
    ]
  },
  grep: {
    name: 'grep',
    section: '1',
    sections: [
      { name: 'NAME', content: ['grep - print lines that match patterns'] },
      { name: 'SYNOPSIS', content: ['grep [-i] [-v] [-n] [-c] pattern [file...]'] },
      { name: 'DESCRIPTION', content: [
        'Search for PATTERN in each FILE.',
        'PATTERN is a regular expression.',
        'If no files are given, reads from standard input.'
      ]},
      { name: 'OPTIONS', content: [
        '-i    Ignore case distinctions in patterns and data',
        '-v    Select non-matching lines',
        '-n    Prefix each line of output with the line number',
        '-c    Print only a count of matching lines per FILE'
      ]},
      { name: 'EXAMPLES', content: [
        'grep "error" log.txt        Find lines containing "error"',
        'grep -i "warning" *.log     Case-insensitive search',
        'grep -n "TODO" file.txt     Show line numbers',
        'cat file | grep pattern     Filter stdin'
      ]},
      { name: 'SEE ALSO', content: ['cat(1), head(1), tail(1), wc(1)'] }
    ]
  },
  wc: {
    name: 'wc',
    section: '1',
    sections: [
      { name: 'NAME', content: ['wc - print newline, word, and byte counts'] },
      { name: 'SYNOPSIS', content: ['wc [-l] [-w] [-c] [file...]'] },
      { name: 'DESCRIPTION', content: [
        'Print newline, word, and byte counts for each FILE.',
        'If no files are specified, reads from standard input.'
      ]},
      { name: 'OPTIONS', content: [
        '-l    Print the newline counts',
        '-w    Print the word counts',
        '-c    Print the byte counts'
      ]},
      { name: 'EXAMPLES', content: [
        'wc file.txt          Show lines, words, and bytes',
        'wc -l file.txt       Count lines only',
        'wc -w file.txt       Count words only',
        'cat file | wc -l     Count lines from stdin'
      ]},
      { name: 'SEE ALSO', content: ['cat(1), grep(1)'] }
    ]
  },
  clear: {
    name: 'clear',
    section: '1',
    sections: [
      { name: 'NAME', content: ['clear - clear the terminal screen'] },
      { name: 'SYNOPSIS', content: ['clear'] },
      { name: 'DESCRIPTION', content: [
        'Clear the terminal screen and move cursor to the top-left corner.'
      ]},
      { name: 'SEE ALSO', content: ['reset(1)'] }
    ]
  },
  history: {
    name: 'history',
    section: '1',
    sections: [
      { name: 'NAME', content: ['history - display command history'] },
      { name: 'SYNOPSIS', content: ['history [count]'] },
      { name: 'DESCRIPTION', content: [
        'Display the command history list with line numbers.',
        'If count is specified, only the last COUNT commands are displayed.'
      ]},
      { name: 'EXAMPLES', content: [
        'history           Show all command history',
        'history 10        Show last 10 commands'
      ]},
      { name: 'SEE ALSO', content: ['help(1)'] }
    ]
  },
  whoami: {
    name: 'whoami',
    section: '1',
    sections: [
      { name: 'NAME', content: ['whoami - print effective user name'] },
      { name: 'SYNOPSIS', content: ['whoami'] },
      { name: 'DESCRIPTION', content: [
        'Print the user name associated with the current effective user ID.'
      ]},
      { name: 'ENVIRONMENT', content: [
        'USER    The environment variable used to determine the current user'
      ]},
      { name: 'SEE ALSO', content: ['env(1)'] }
    ]
  },
  env: {
    name: 'env',
    section: '1',
    sections: [
      { name: 'NAME', content: ['env - print environment variables'] },
      { name: 'SYNOPSIS', content: ['env'] },
      { name: 'DESCRIPTION', content: [
        'Print all environment variables in NAME=value format.',
        'Variables are displayed one per line.'
      ]},
      { name: 'SEE ALSO', content: ['export(1), unset(1)'] }
    ]
  },
  export: {
    name: 'export',
    section: '1',
    sections: [
      { name: 'NAME', content: ['export - set environment variables'] },
      { name: 'SYNOPSIS', content: ['export [NAME=value]'] },
      { name: 'DESCRIPTION', content: [
        'Set an environment variable NAME to value.',
        'Without arguments, lists all exported variables.',
        'Variables persist for the current session.'
      ]},
      { name: 'EXAMPLES', content: [
        'export              List all variables',
        'export PATH=/bin    Set PATH variable',
        'export MY_VAR=test  Set custom variable'
      ]},
      { name: 'SEE ALSO', content: ['env(1), unset(1)'] }
    ]
  },
  unset: {
    name: 'unset',
    section: '1',
    sections: [
      { name: 'NAME', content: ['unset - remove environment variables'] },
      { name: 'SYNOPSIS', content: ['unset NAME...'] },
      { name: 'DESCRIPTION', content: [
        'Remove each variable NAME from the environment.',
        'Multiple variables can be unset in one command.'
      ]},
      { name: 'EXAMPLES', content: [
        'unset MY_VAR           Remove single variable',
        'unset VAR1 VAR2 VAR3   Remove multiple variables'
      ]},
      { name: 'SEE ALSO', content: ['env(1), export(1)'] }
    ]
  },
  alias: {
    name: 'alias',
    section: '1',
    sections: [
      { name: 'NAME', content: ['alias - define or display aliases'] },
      { name: 'SYNOPSIS', content: ["alias [name[='command']]"] },
      { name: 'DESCRIPTION', content: [
        'Define aliases for commands or display existing aliases.',
        'Without arguments, lists all defined aliases.',
        'With a name only, shows that alias definition.',
        'With name=command, defines a new alias.'
      ]},
      { name: 'EXAMPLES', content: [
        "alias                   List all aliases",
        "alias ll                Show alias 'll'",
        "alias ll='ls -la'       Define alias 'll'"
      ]},
      { name: 'SEE ALSO', content: ['unalias(1), which(1), type(1)'] }
    ]
  },
  unalias: {
    name: 'unalias',
    section: '1',
    sections: [
      { name: 'NAME', content: ['unalias - remove aliases'] },
      { name: 'SYNOPSIS', content: ['unalias [-a] name...'] },
      { name: 'DESCRIPTION', content: [
        'Remove each NAME from the list of defined aliases.',
        'Use -a to remove all aliases.'
      ]},
      { name: 'OPTIONS', content: [
        '-a    Remove all alias definitions'
      ]},
      { name: 'EXAMPLES', content: [
        'unalias ll      Remove alias ll',
        'unalias -a      Remove all aliases'
      ]},
      { name: 'SEE ALSO', content: ['alias(1)'] }
    ]
  },
  which: {
    name: 'which',
    section: '1',
    sections: [
      { name: 'NAME', content: ['which - locate a command'] },
      { name: 'SYNOPSIS', content: ['which command...'] },
      { name: 'DESCRIPTION', content: [
        'Locate a command and display its type and location.',
        'For builtins, shows "shell builtin".',
        'For executables, shows the full path.',
        'For aliases, shows the alias definition.'
      ]},
      { name: 'EXAMPLES', content: [
        'which ls          Shows: ls: shell builtin',
        'which help        Shows: /bin/help.trx'
      ]},
      { name: 'SEE ALSO', content: ['type(1), alias(1)'] }
    ]
  },
  type: {
    name: 'type',
    section: '1',
    sections: [
      { name: 'NAME', content: ['type - display information about command type'] },
      { name: 'SYNOPSIS', content: ['type command...'] },
      { name: 'DESCRIPTION', content: [
        'Indicate how each NAME would be interpreted if used as a command.',
        'Shows whether command is a builtin, alias, or executable.'
      ]},
      { name: 'EXAMPLES', content: [
        'type ls          Show type of ls',
        'type ll cd       Show types of multiple commands'
      ]},
      { name: 'SEE ALSO', content: ['which(1)'] }
    ]
  },
  help: {
    name: 'help',
    section: '1',
    sections: [
      { name: 'NAME', content: ['help - display help for shell commands'] },
      { name: 'SYNOPSIS', content: ['help [command]'] },
      { name: 'DESCRIPTION', content: [
        'Display helpful information about builtin commands.',
        'Without arguments, lists all available commands.',
        'With a command name, shows usage and examples for that command.'
      ]},
      { name: 'EXAMPLES', content: [
        'help          List all commands',
        'help ls       Show help for ls command',
        'help cd       Show help for cd command'
      ]},
      { name: 'SEE ALSO', content: ['man(1)'] }
    ]
  },
  source: {
    name: 'source',
    section: '1',
    sections: [
      { name: 'NAME', content: ['source - execute commands from a file in the current shell'] },
      { name: 'SYNOPSIS', content: ['source filename', '. filename'] },
      { name: 'DESCRIPTION', content: [
        'Read and execute commands from filename in the current shell environment.',
        'Commonly used to load shell configuration files like .profile.',
        'The . (dot) command is an alias for source.'
      ]},
      { name: 'EXAMPLES', content: [
        'source ~/.profile      Load profile settings',
        '. ~/.profile           Same as above'
      ]},
      { name: 'SEE ALSO', content: ['alias(1), export(1)'] }
    ]
  },
  session: {
    name: 'session',
    section: '1',
    sections: [
      { name: 'NAME', content: ['session - manage shell sessions'] },
      { name: 'SYNOPSIS', content: ['session [list|switch|new|delete] [name]'] },
      { name: 'DESCRIPTION', content: [
        'Manage multiple shell sessions with separate histories and state.',
        'Each session has its own filesystem namespace and environment.'
      ]},
      { name: 'OPTIONS', content: [
        'list            List all available sessions',
        'switch <name>   Switch to an existing session',
        'new <name>      Create a new session',
        'delete <name>   Delete a session'
      ]},
      { name: 'EXAMPLES', content: [
        'session list          Show all sessions',
        'session new work      Create "work" session',
        'session switch work   Switch to "work" session'
      ]},
      { name: 'SEE ALSO', content: ['config(1)'] }
    ]
  },
  config: {
    name: 'config',
    section: '1',
    sections: [
      { name: 'NAME', content: ['config - configure TronOS settings'] },
      { name: 'SYNOPSIS', content: ['config [show|set|reset] [key] [value]'] },
      { name: 'DESCRIPTION', content: [
        'View and modify TronOS configuration settings.',
        'Settings include AI provider, API key, model selection, and more.'
      ]},
      { name: 'OPTIONS', content: [
        'show            Display current configuration',
        'set <key> <val> Set a configuration value',
        'reset           Reset to default settings'
      ]},
      { name: 'EXAMPLES', content: [
        'config show                    Show all settings',
        'config set provider anthropic  Set AI provider',
        'config set apiKey <key>        Set API key',
        'config reset                   Reset to defaults'
      ]},
      { name: 'SEE ALSO', content: ['session(1), @ai(1)'] }
    ]
  },
  '@ai': {
    name: '@ai',
    section: '1',
    sections: [
      { name: 'NAME', content: ['@ai - interact with the AI assistant'] },
      { name: 'SYNOPSIS', content: ['@ai <request>'] },
      { name: 'DESCRIPTION', content: [
        'Send a request to the AI assistant to get help or generate code.',
        'The AI can create programs, explain code, fix bugs, and answer questions.',
        'Requires API key configuration (see config command).'
      ]},
      { name: 'EXAMPLES', content: [
        '@ai create hello            Create a hello program',
        '@ai explain /bin/help.trx   Explain how help.trx works',
        '@ai fix /bin/broken.trx     Fix bugs in a program',
        '@ai how do I list files?    Ask a question'
      ]},
      { name: 'SEE ALSO', content: ['config(1), help(1)'] }
    ]
  },
  curl: {
    name: 'curl',
    section: '1',
    sections: [
      { name: 'NAME', content: ['curl - transfer data from a URL'] },
      { name: 'SYNOPSIS', content: ['curl [options] URL'] },
      { name: 'DESCRIPTION', content: [
        'Fetch data from a URL and output to stdout.',
        'Supports HTTP and HTTPS protocols.'
      ]},
      { name: 'OPTIONS', content: [
        '-o <file>    Write output to <file> instead of stdout',
        '-v           Verbose mode, show request details'
      ]},
      { name: 'EXAMPLES', content: [
        'curl https://example.com           Fetch and display content',
        'curl -o file.html https://...      Save to file'
      ]},
      { name: 'SEE ALSO', content: ['fetch(1)'] }
    ]
  },
  fetch: {
    name: 'fetch',
    section: '1',
    sections: [
      { name: 'NAME', content: ['fetch - fetch resources from the network'] },
      { name: 'SYNOPSIS', content: ['fetch URL'] },
      { name: 'DESCRIPTION', content: [
        'Fetch content from a URL using the browser fetch API.',
        'Similar to curl but uses native browser capabilities.'
      ]},
      { name: 'EXAMPLES', content: [
        'fetch https://api.example.com/data    Fetch JSON data'
      ]},
      { name: 'SEE ALSO', content: ['curl(1)'] }
    ]
  },
  theme: {
    name: 'theme',
    section: '1',
    sections: [
      { name: 'NAME', content: ['theme - change terminal color theme'] },
      { name: 'SYNOPSIS', content: ['theme [name]'] },
      { name: 'DESCRIPTION', content: [
        'Change the terminal color theme.',
        'Without arguments, lists available themes.',
        'With a theme name, switches to that theme.'
      ]},
      { name: 'EXAMPLES', content: [
        'theme              List available themes',
        'theme dark         Switch to dark theme',
        'theme solarized    Switch to solarized theme'
      ]},
      { name: 'SEE ALSO', content: ['config(1)'] }
    ]
  },
  reset: {
    name: 'reset',
    section: '1',
    sections: [
      { name: 'NAME', content: ['reset - reset the terminal'] },
      { name: 'SYNOPSIS', content: ['reset'] },
      { name: 'DESCRIPTION', content: [
        'Reset the terminal to its initial state.',
        'Clears the screen and resets terminal modes.'
      ]},
      { name: 'SEE ALSO', content: ['clear(1), factory-reset(1)'] }
    ]
  },
  'factory-reset': {
    name: 'factory-reset',
    section: '1',
    sections: [
      { name: 'NAME', content: ['factory-reset - restore TronOS to initial state'] },
      { name: 'SYNOPSIS', content: ['factory-reset'] },
      { name: 'DESCRIPTION', content: [
        'Completely reset TronOS to its factory default state.',
        'This removes all files, settings, and sessions.',
        'WARNING: This action cannot be undone!'
      ]},
      { name: 'SEE ALSO', content: ['reset(1), config(1)'] }
    ]
  },
  boot: {
    name: 'boot',
    section: '1',
    sections: [
      { name: 'NAME', content: ['boot - configure boot sequence settings'] },
      { name: 'SYNOPSIS', content: ['boot [show|skip|noskip|toggle]'] },
      { name: 'DESCRIPTION', content: [
        'Configure the TronOS boot sequence animation settings.',
        'Control whether the boot animation is shown on startup.'
      ]},
      { name: 'OPTIONS', content: [
        'show      Display current boot configuration',
        'skip      Skip boot animation on next startup',
        'noskip    Show boot animation on next startup',
        'toggle    Toggle the skip preference'
      ]},
      { name: 'EXAMPLES', content: [
        'boot              Show current configuration',
        'boot skip         Skip boot animation',
        'boot noskip       Show boot animation'
      ]},
      { name: 'SEE ALSO', content: ['config(1), reset(1)'] }
    ]
  },
  man: {
    name: 'man',
    section: '1',
    sections: [
      { name: 'NAME', content: ['man - display manual pages'] },
      { name: 'SYNOPSIS', content: ['man [command]'] },
      { name: 'DESCRIPTION', content: [
        'Format and display the online manual pages.',
        'Without arguments, shows usage information.',
        'Manual pages contain detailed documentation for commands.'
      ]},
      { name: 'EXAMPLES', content: [
        'man ls         Display manual page for ls',
        'man grep       Display manual page for grep',
        'man man        Display this manual page'
      ]},
      { name: 'SEE ALSO', content: ['help(1)'] }
    ]
  }
};

/**
 * Format a man page for display with ANSI styling
 */
function formatManPage(page: ManPage): string {
  const output: string[] = [];

  // Header line with command name and section
  output.push(`${bold(page.name.toUpperCase())}(${page.section})${' '.repeat(20)}User Commands${' '.repeat(20)}${bold(page.name.toUpperCase())}(${page.section})`);
  output.push('');

  // Format each section in order
  for (const sectionName of SECTION_ORDER) {
    const section = page.sections.find(s => s.name === sectionName);
    if (section) {
      // Section header in bold
      output.push(bold(section.name));

      // Section content with proper indentation
      for (const line of section.content) {
        output.push(`       ${line}`);
      }
      output.push('');
    }
  }

  return output.join('\n');
}

/**
 * man - Display manual pages for commands
 * Usage: man [command]
 * Without arguments: displays usage information
 * With a command name: displays the manual page for that command
 */
export const man: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    // Show usage information
    const output: string[] = [];
    output.push('What manual page do you want?');
    output.push('');
    output.push('Usage: man <command>');
    output.push('');
    output.push('Examples:');
    output.push('  man ls      Display manual page for ls');
    output.push('  man grep    Display manual page for grep');
    output.push('');
    output.push('Available manual pages:');

    // List available man pages in columns
    const commands = Object.keys(MAN_PAGES).sort();
    const columnWidth = 16;
    const columnsPerRow = 4;

    for (let i = 0; i < commands.length; i += columnsPerRow) {
      const row = commands.slice(i, i + columnsPerRow);
      output.push('  ' + row.map(cmd => cmd.padEnd(columnWidth)).join(''));
    }

    return {
      stdout: output.join('\n'),
      stderr: '',
      exitCode: 0
    };
  }

  const command = args[0];

  // Check for man page in our built-in collection
  const manPage = MAN_PAGES[command];
  if (manPage) {
    return {
      stdout: formatManPage(manPage),
      stderr: '',
      exitCode: 0
    };
  }

  // Check for man page in /usr/share/man/man1 if VFS is available
  if (context.vfs) {
    const manPath = `/usr/share/man/man1/${command}.1`;
    if (context.vfs.exists(manPath) && context.vfs.isFile(manPath)) {
      try {
        const content = context.vfs.read(manPath);
        // Handle async read if needed
        const resolvedContent = content instanceof Promise ? await content : content;
        return {
          stdout: resolvedContent,
          stderr: '',
          exitCode: 0
        };
      } catch (err) {
        // Fall through to not found
      }
    }
  }

  // Check if it's an executable in /bin
  if (context.vfs) {
    const exePath = `/bin/${command}.trx`;
    if (context.vfs.exists(exePath) && context.vfs.isFile(exePath)) {
      return {
        stdout: '',
        stderr: `No manual entry for ${command}\nSee 'help ${command}' for basic usage information.`,
        exitCode: 1
      };
    }
  }

  return {
    stdout: '',
    stderr: `No manual entry for ${command}`,
    exitCode: 1
  };
};
