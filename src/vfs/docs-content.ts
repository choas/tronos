/**
 * Inline content for /docs virtual files.
 *
 * Each export is the full markdown string served when a user runs
 * `cat /docs/<name>.md` inside TronOS.
 */

export const TRONOS_CONTENT = `# TronOS

A browser-based terminal operating system where an LLM serves as the compiler, assistant, and system intelligence. Describe what you want in natural language, and the AI generates executable programs that run natively in the browser.

## Core Principles

- **Everything is a file** — standard Unix-like virtual filesystem
- **Everything is modifiable** — full read/write access
- **LLM is the compiler** — natural language to executable code
- **Browser is the VM** — runs entirely client-side, no server required

## Features

- Full-featured shell with pipes, redirects, and command chaining
- Virtual filesystem persisted in IndexedDB
- 40+ builtin commands (ls, cd, cat, grep, curl, cron, …)
- AI-powered code generation via \`@ai\` commands
- Multiple session support with tabs
- 9 built-in theme presets with full color customization
- Import/export sessions as disk images
- Cron job scheduling (standard cron syntax + shorthands)
- File version control via \`timewarp\`
- Package management via \`tpkg\`
- System updates with rollback

## Quick Start

\`\`\`
# Create a program
@ai create countdown "A countdown timer that takes seconds as argument"

# Run it
countdown.trx 10

# Edit it
@ai edit /bin/countdown.trx "Add color to the output"

# Explore
help            # list all commands
man ls          # manual for a command
cat /docs/commands.md   # full command reference
cat /docs/api.md        # executable API reference
\`\`\`

## Virtual Filesystem

| Path | Description |
|------|-------------|
| \`/home/user\` | User home directory |
| \`/bin\` | Executable programs (.trx) |
| \`/tmp\` | Temporary files |
| \`/etc\` | Configuration files |
| \`/proc\` | System information (virtual, read-only) |
| \`/dev\` | Device files (virtual) |
| \`/docs\` | Documentation (virtual, read-only) |

### Special Files

- \`/proc/ai/model\` — current AI model
- \`/proc/ai/provider\` — current AI provider
- \`/proc/system/version\` — TronOS version
- \`/proc/system/uptime\` — system uptime
- \`/proc/env\` — environment variables
- \`/proc/cron/jobs\` — active cron jobs
- \`/proc/theme/active\` — current theme name
- \`/proc/theme/colors/*\` — individual color values (read/write)
- \`/dev/null\` — discards all writes
- \`/dev/random\` — random bytes
- \`/dev/clipboard\` — system clipboard (read/write)

## AI Providers

| Provider | Default Model | API Key Required |
|----------|---------------|-----------------|
| \`tronos\` | (built-in) | No |
| \`anthropic\` | claude-sonnet-4-6 | Yes |
| \`openai\` | gpt-4o | Yes |
| \`ollama\` | llama3.2 | No (local) |
| \`openrouter\` | anthropic/claude-sonnet-4-6 | Yes |

Configure with: \`config set provider <name>\` and \`config set apiKey <key>\`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+L | Clear screen |
| Ctrl+C | Cancel current input |
| Ctrl+D | Exit (when input empty) |
| Ctrl+A | Move to beginning of line |
| Ctrl+E | Move to end of line |
| Ctrl+U | Delete to beginning of line |
| Ctrl+K | Delete to end of line |
| Tab | Autocomplete |
| Up/Down | Navigate history |

## License

Apache 2.0
`;

export const API_CONTENT = `# TronOS Executable API Reference

TronOS executables are JavaScript files with a \`.trx\` extension. They receive a terminal API object that provides I/O, filesystem access, networking, and more.

## File Format

\`\`\`javascript
// @name: program-name
// @description: Brief description
// @version: 1.0.0
// @author: @ai

async function main(t) {
  t.writeln("Hello, world!");
}
\`\`\`

The metadata comments (\`@name\`, \`@description\`, \`@version\`, \`@author\`) are optional but recommended. An optional \`@requires: network\` tag marks programs that need network access.

## Terminal API (\`t\`)

### Output

| Method | Description |
|--------|-------------|
| \`t.write(text)\` | Write text (no newline) |
| \`t.writeln(text)\` | Write text with newline |
| \`t.clear()\` | Clear the terminal screen |
| \`t.clearLine()\` | Clear the current line |

### Cursor & Screen

| Method | Description |
|--------|-------------|
| \`t.moveTo(x, y)\` | Move cursor to absolute position |
| \`t.moveBy(dx, dy)\` | Move cursor relative to current position |
| \`t.getCursor()\` | Returns \`{ x, y }\` cursor position |
| \`t.getSize()\` | Returns \`{ cols, rows }\` terminal dimensions |

### Input

| Method | Description |
|--------|-------------|
| \`await t.readLine(prompt?)\` | Read a line of text from the user |
| \`await t.readKey()\` | Read a single keypress |
| \`await t.readChar()\` | Read a single character |
| \`t.hasInput()\` | Check if input is available |

### Styling

All style methods take a string and return a styled string:

\`t.style.bold()\`, \`t.style.dim()\`, \`t.style.italic()\`, \`t.style.underline()\`

**Colors:** \`t.style.red()\`, \`t.style.green()\`, \`t.style.blue()\`, \`t.style.yellow()\`, \`t.style.magenta()\`, \`t.style.cyan()\`, \`t.style.white()\`, \`t.style.gray()\`

Example:
\`\`\`javascript
t.writeln(t.style.bold(t.style.green("Success!")));
t.writeln(t.style.dim("Loading..."));
\`\`\`

### Filesystem (\`t.fs\`)

| Method | Description |
|--------|-------------|
| \`t.fs.read(path)\` | Read file contents (returns string) |
| \`t.fs.write(path, content)\` | Write string to file |
| \`t.fs.append(path, content)\` | Append to file |
| \`t.fs.exists(path)\` | Check if path exists (returns boolean) |
| \`t.fs.list(path)\` | List directory contents (returns string[]) |
| \`t.fs.mkdir(path)\` | Create directory |
| \`t.fs.remove(path)\` | Remove file or directory |
| \`t.fs.stat(path)\` | Get file metadata |
| \`t.fs.cwd()\` | Get current working directory |
| \`t.fs.resolve(path)\` | Resolve relative path to absolute |
| \`t.fs.isFile(path)\` | Check if path is a file |
| \`t.fs.isDirectory(path)\` | Check if path is a directory |

### Network (\`t.net\`)

| Method | Description |
|--------|-------------|
| \`await t.net.fetch(url, options?)\` | Browser fetch (CORS-enabled APIs) |

The \`options\` parameter accepts standard fetch options (\`method\`, \`headers\`, \`body\`, etc.).

### Control

| Method | Description |
|--------|-------------|
| \`t.exit(code?)\` | Exit the program (0 = success) |
| \`await t.sleep(ms)\` | Pause execution for N milliseconds |

### Context

| Property | Description |
|----------|-------------|
| \`t.args\` | Command-line arguments (string[]) |
| \`t.env\` | Environment variables (object) |
| \`t.cwd\` | Current working directory (string) |

### Configuration (\`t.config\`)

| Method | Description |
|--------|-------------|
| \`t.config.get(key)\` | Read a config value |
| \`t.config.set(key, value)\` | Write a config value |

### Subprocess

| Method | Description |
|--------|-------------|
| \`await t.exec(command)\` | Execute a shell command and return its output |

### System Info (\`t.system\`)

| Property | Description |
|----------|-------------|
| \`t.system.version\` | TronOS version number |
| \`t.system.versionString\` | Full version string |

## Complete Example

\`\`\`javascript
// @name: sysinfo
// @description: Display system information
// @version: 1.0.0
// @author: @ai

async function main(t) {
  t.writeln(t.style.bold("System Information"));
  t.writeln("");

  const size = t.getSize();
  t.writeln("Terminal: " + size.cols + "x" + size.rows);
  t.writeln("Version: " + t.system.versionString);
  t.writeln("CWD: " + t.cwd);

  const files = t.fs.list("/bin");
  t.writeln("Programs: " + files.length);

  if (t.args.length > 0) {
    t.writeln("Args: " + t.args.join(", "));
  }

  t.exit(0);
}
\`\`\`

## @ai Modes

| Mode | Usage | Description |
|------|-------|-------------|
| create | \`@ai create <name> <description>\` | Generate a new .trx program |
| edit | \`@ai edit <file> <instructions>\` | Modify an existing program |
| explain | \`@ai explain <file>\` | Explain how a program works |
| fix | \`@ai fix <file> [error context]\` | Diagnose and fix issues |
| chat | \`@ai <question>\` | General conversation (default) |

Manage terms: \`@ai accept-terms\`, \`@ai show-terms\`, \`@ai clear\` (clear history)
`;

export const COMMANDS_CONTENT = `# TronOS Shell Commands Reference

## File System

### ls — list directory contents
\`\`\`
ls [-l] [-a] [-h] [path...]
\`\`\`
- \`-l\`  long format (permissions, size, date)
- \`-a\`  show hidden files (dotfiles)
- \`-h\`  human-readable sizes (K, M, G)

### cd — change directory
\`\`\`
cd [directory]
\`\`\`
Supports \`~\` (home), \`..\` (parent), \`-\` (previous directory).

### pwd — print working directory
\`\`\`
pwd
\`\`\`

### cat — display file contents
\`\`\`
cat [file...]
\`\`\`
Concatenates and prints one or more files.

### mkdir — create directories
\`\`\`
mkdir [-p] directory...
\`\`\`
- \`-p\`  create parent directories as needed

### touch — create empty file
\`\`\`
touch file...
\`\`\`
Creates files if they don't exist, or updates timestamps.

### rm — remove files or directories
\`\`\`
rm [-r] [-f] file...
\`\`\`
- \`-r\`  recursive (required for directories)
- \`-f\`  force (no error if file doesn't exist)

### cp — copy files
\`\`\`
cp [-r] source destination
\`\`\`
- \`-r\`  recursive copy for directories

### mv — move or rename
\`\`\`
mv source destination
\`\`\`

## Text Processing

### echo — display text
\`\`\`
echo [-e] [string...]
\`\`\`
- \`-e\`  interpret escape sequences (\\n, \\t, etc.)

### head — display first lines
\`\`\`
head [-n count] [file]
\`\`\`
Default: 10 lines.

### tail — display last lines
\`\`\`
tail [-n count] [file]
\`\`\`
Default: 10 lines.

### grep — search for patterns
\`\`\`
grep pattern [file...]
\`\`\`
Uses regular expressions. Reads from stdin if no file given.

### wc — count lines, words, characters
\`\`\`
wc [-l] [-w] [-c] [file...]
\`\`\`
- \`-l\`  lines only
- \`-w\`  words only
- \`-c\`  characters only

## Environment

### env — display environment variables
\`\`\`
env
\`\`\`

### export — set environment variable
\`\`\`
export NAME=value
\`\`\`
Without arguments, lists all exported variables.

### unset — remove environment variable
\`\`\`
unset NAME...
\`\`\`

### whoami — print current username
\`\`\`
whoami
\`\`\`

## Aliases

### alias — define or list aliases
\`\`\`
alias [name[=value]]
\`\`\`
Without arguments, lists all aliases. Example: \`alias ll='ls -la'\`

### unalias — remove aliases
\`\`\`
unalias [-a] name...
\`\`\`
- \`-a\`  remove all aliases

## Command Information

### help — list available commands
\`\`\`
help [command]
\`\`\`
Without arguments, lists all commands grouped by category.

### man — display manual page
\`\`\`
man [command]
\`\`\`
Shows detailed documentation: NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXAMPLES.

### which — show command location
\`\`\`
which command...
\`\`\`

### type — display command type
\`\`\`
type command...
\`\`\`
Shows whether a command is a builtin, alias, or file.

## Shell

### clear — clear the terminal
\`\`\`
clear
\`\`\`

### history — show command history
\`\`\`
history [count]
\`\`\`

### source — execute commands from file
\`\`\`
source file
. file
\`\`\`
Runs commands in the current shell environment.

### exit — exit the shell
\`\`\`
exit [code]
\`\`\`

### version — show TronOS version
\`\`\`
version
\`\`\`

## AI Integration

### @ai — AI-powered assistant
\`\`\`
@ai create <name> <description>     Generate a new program
@ai edit <file> <instructions>       Modify an existing file
@ai explain <file>                   Explain how code works
@ai fix <file> [error context]       Diagnose and fix issues
@ai <question>                       General chat (default)
@ai accept-terms                     Accept AI service terms
@ai show-terms                       View terms & conditions
@ai clear                            Clear conversation history
\`\`\`

### config — configure AI settings
\`\`\`
config show                          Show current settings
config set <key> <value>             Set a config value
config reset                         Reset to defaults
config ui                            Open config dialog
\`\`\`
Keys: \`provider\`, \`model\`, \`baseURL\`, \`apiKey\`, \`temperature\`, \`maxTokens\`

## Sessions

### session — manage sessions
\`\`\`
session list                         List all sessions
session new <name>                   Create new session
session switch <name>                Switch to session
session delete <name>                Delete session
session rename <old> <new>           Rename session
session export                       Export as disk image
session import                       Import disk image
session snapshots                    List snapshots
session restore <snapshot>           Restore snapshot
\`\`\`

## Scheduling

### cron — manage scheduled jobs
\`\`\`
cron list                            List all jobs
cron add '<schedule> <command>'      Add a job
cron remove <id>                     Remove a job
cron enable <id>                     Enable a job
cron disable <id>                    Disable a job
cron log [id]                        View execution log
cron edit <id>                       Edit a job interactively
cron copy <id>                       Copy job to clipboard
cron paste [id]                      Paste job from clipboard
\`\`\`
Schedule formats: standard cron (\`*/5 * * * *\`), shorthands (\`@hourly\`, \`@daily\`), intervals (\`@every 5m\`).

## Theming

### theme — manage themes
\`\`\`
theme                                Show current theme
theme apply <preset>                 Apply a theme preset
theme list                           List all presets
theme preview <preset>               Preview a theme
theme set <key> <color>              Change a single color
theme save <name>                    Save current as preset
theme reset                          Reset to default
theme toggle                         Toggle dark/light
theme dark                           Switch to dark
theme light                          Switch to light
\`\`\`
Built-in presets: dark, light, tron, cyberpunk, nord, solarized, monokai, gruvbox, dracula.

## Package Management

### tpkg — TronOS package manager
\`\`\`
tpkg update                          Update package index
tpkg search <query>                  Search packages
tpkg install <package>               Install a package
tpkg uninstall <package>             Remove a package
tpkg upgrade [package]               Upgrade packages
tpkg list                            List installed packages
tpkg info <package>                  Show package details
tpkg config                          Show tpkg configuration
\`\`\`

## Version Control

### timewarp — file version history
\`\`\`
timewarp list <file>                 List saved versions
timewarp show <file> <version>       Show a specific version
timewarp revert <file> <version>     Revert to a version
timewarp diff <file> <v1> <v2>       Diff two versions
timewarp save <file>                 Save current version
timewarp branches <file>             List branches
timewarp branch <file> <name>        Create a branch
\`\`\`

## System

### update — system updates
\`\`\`
update [--apply] [--dry-run] [--rollback] [--history]
\`\`\`

### boot — configure boot sequence
\`\`\`
boot [show|skip|noskip|toggle]
\`\`\`

### reset — factory reset
\`\`\`
reset [--force|-f]
\`\`\`
Clears all data and reinitializes TronOS.

## Network

### curl — transfer data with URLs
\`\`\`
curl [options] <url>
\`\`\`
- \`-X <method>\`  HTTP method
- \`-H <header>\`  Add header
- \`-d <data>\`    Request body
- \`-o <file>\`    Save to file
- \`-i\`           Include response headers
- \`-s\`           Silent mode

## Feedback

### feedback — submit feedback
\`\`\`
feedback <message>                   Submit feedback
feedback list                        List submitted feedback
feedback show <id>                   Show feedback details
feedback clear                       Clear all feedback
\`\`\`

## Pipes, Redirects & Chaining

\`\`\`
command1 | command2                   Pipe output
command > file                       Redirect output (overwrite)
command >> file                      Redirect output (append)
command < file                       Redirect input
command1 && command2                  Run command2 if command1 succeeds
command1 || command2                  Run command2 if command1 fails
command1 ; command2                   Run both regardless
\`\`\`
`;
