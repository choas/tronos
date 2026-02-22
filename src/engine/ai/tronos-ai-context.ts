/**
 * TronOS AI Context Documentation
 *
 * This module contains comprehensive documentation for AI code generation
 * in TronOS. It's designed to be embedded in AI system prompts to enable
 * accurate code generation for .trx programs.
 *
 * @module engine/ai/tronos-ai-context
 */

/**
 * Complete AI-friendly TronOS documentation
 * Designed to be token-efficient while providing complete API coverage
 */
export const TRONOS_AI_CONTEXT = `# TronOS AI Context

## 1. Terminal API (t.*)

Your code runs in an async function with parameter \`t\` (SandboxTerminalAPI).

### Output
\`\`\`javascript
t.write(text)      // Write without newline
t.writeln(text)    // Write with newline
t.clear()          // Clear terminal screen
t.clearLine()      // Clear current line
\`\`\`

### Cursor Control
\`\`\`javascript
t.moveTo(x, y)     // Move to absolute position (0-indexed)
t.moveBy(dx, dy)   // Move relative to current
t.getCursor()      // Returns { x: number, y: number }
t.getSize()        // Returns { cols: number, rows: number }
\`\`\`

### Input (all async)
\`\`\`javascript
await t.readLine(prompt?)  // Read line with optional prompt
await t.readKey()          // Returns { key: string, domEvent?: KeyboardEvent }
await t.readChar()         // Read single printable character
t.hasInput()               // Non-blocking check for pending input
\`\`\`

### Styling (t.style.*)
\`\`\`javascript
t.style.bold(text)       t.style.dim(text)
t.style.italic(text)     t.style.underline(text)
t.style.red(text)        t.style.green(text)
t.style.yellow(text)     t.style.blue(text)
t.style.magenta(text)    t.style.cyan(text)
t.style.white(text)      t.style.gray(text)
t.style.reset(text)
\`\`\`

### Control
\`\`\`javascript
t.exit(code?)      // Exit program (default: 0). Throws ExitSignal.
await t.sleep(ms)  // Pause execution
\`\`\`

### Context (read-only)
\`\`\`javascript
t.args             // string[] - command-line arguments
t.env              // { [key: string]: string } - environment variables
t.cwd              // string - current working directory
\`\`\`

### Filesystem (t.fs.*)
\`\`\`javascript
t.fs.read(path)              // string | Promise<string>
t.fs.write(path, content)    // void | Promise<void>
t.fs.append(path, content)   // void
t.fs.exists(path)            // boolean
t.fs.list(path)              // string[]
t.fs.mkdir(path)             // void (recursive)
t.fs.remove(path)            // void (recursive)
t.fs.stat(path)              // { type: 'file'|'directory', name: string }
t.fs.cwd()                   // string
t.fs.resolve(path)           // string - resolve relative path
t.fs.isFile(path)            // boolean
t.fs.isDirectory(path)       // boolean
\`\`\`

### Network (t.net.*)
\`\`\`javascript
await t.net.fetch(url, options?)       // Same as browser fetch()
await t.net.proxyFetch(url, options?)  // For external APIs without CORS
\`\`\`

### Package Config (t.config.*)
For installed packages only:
\`\`\`javascript
t.config.get(key)           // string | number | boolean | undefined
t.config.set(key, value)    // boolean (success)
\`\`\`

### Subprocess Execution
\`\`\`javascript
await t.exec(command)  // Returns { stdout, stderr, exitCode }
\`\`\`

### System Info (t.system.*)
\`\`\`javascript
t.system.version       // "0.1.0"
t.system.versionString // "TronOS v0.1.0"
\`\`\`

## 2. Executable Format (.trx)

### File Structure
\`\`\`javascript
// @name: program-name          // REQUIRED
// @description: Brief desc     // Optional
// @version: 1.0.0              // Optional
// @author: @ai                 // Optional
// @requires: network           // Optional: network, clipboard, storage

async function main(t) {
  // Your code here
  t.writeln('Hello!');
}
\`\`\`

### Valid Function Formats
\`\`\`javascript
// Format 1: Named function (recommended)
async function main(t) { ... }

// Format 2: Anonymous with parentheses
(async function(t) { ... })

// Format 3: Anonymous without parentheses
async function(t) { ... }
\`\`\`

### Metadata Fields
| Field | Required | Description |
|-------|----------|-------------|
| @name | YES | Program identifier |
| @description | No | Brief purpose |
| @version | No | Semantic version |
| @author | No | Author name or "@ai" |
| @requires | No | Comma-separated: network, clipboard, storage |

## 3. Virtual File System (VFS)

### Standard Directories
\`\`\`
/home/tronos/    User home directory
/bin/            Executables (PATH)
/tmp/            Temporary files
/etc/            Configuration files
/dev/            Device files (virtual)
/proc/           System information (virtual)
\`\`\`

### /proc Virtual Files (read-only)
\`\`\`
/proc/ai/model       Current AI model name
/proc/ai/provider    AI provider (anthropic, openai)
/proc/ai/status      "configured" or "not configured"
/proc/system/version TronOS version string
/proc/system/uptime  System uptime (e.g., "1h 23m 45s")
/proc/system/memory  Memory usage info
/proc/env            Environment variables (KEY=value format)
\`\`\`

### /dev Device Files
\`\`\`
/dev/null       Discards writes, reads empty
/dev/zero       Reads null bytes
/dev/random     Cryptographic random bytes
/dev/urandom    Same as /dev/random
/dev/clipboard  System clipboard read/write
\`\`\`

## 4. Shell Builtins

### File Operations
\`\`\`bash
ls [-la] [path]              # List directory
cd [path]                    # Change directory
pwd                          # Print working directory
cat [files...]               # Display file contents
head [-n N] [file]           # First N lines (default 10)
tail [-n N] [file]           # Last N lines (default 10)
mkdir [-p] path              # Create directory
touch file                   # Create empty file
rm [-rf] path                # Remove file/directory
cp [-r] src dest             # Copy
mv src dest                  # Move/rename
\`\`\`

### Text Processing
\`\`\`bash
echo [text...]               # Print text
grep [-i] pattern [files...] # Search pattern
wc [-lwc] [files...]         # Count lines/words/chars
\`\`\`

### Environment
\`\`\`bash
env                          # Show all variables
export KEY=value             # Set variable
unset KEY                    # Remove variable
alias name='command'         # Create alias
unalias name                 # Remove alias
\`\`\`

### Shell Features
\`\`\`bash
cmd1 | cmd2                  # Pipe stdout to stdin
cmd > file                   # Redirect output (overwrite)
cmd >> file                  # Redirect output (append)
cmd < file                   # Redirect input
cmd1 && cmd2                 # Run cmd2 if cmd1 succeeds
cmd1 || cmd2                 # Run cmd2 if cmd1 fails
source file                  # Execute commands from file
\`\`\`

### System Commands
\`\`\`bash
which cmd                    # Show command path
type cmd                     # Show command type
help [cmd]                   # Show help
man cmd                      # Show manual page
version                      # Show TronOS version
clear                        # Clear terminal
history                      # Show command history
\`\`\`

### Special Commands
\`\`\`bash
@ai chat <message>           # Chat with AI
@ai create <name> <desc>     # Create .trx with AI
@ai edit <file> <changes>    # Modify .trx with AI
@ai explain <file>           # Explain code
@ai fix <file>               # Fix issues in code
\`\`\`

## 5. ANSI Styling Reference

### Via t.style (recommended)
\`\`\`javascript
t.writeln(t.style.green('Success!'));
t.writeln(t.style.bold(t.style.red('Error!')));
\`\`\`

### Raw ANSI Codes
\`\`\`javascript
// Styles
'\\x1b[0m'  // Reset
'\\x1b[1m'  // Bold
'\\x1b[2m'  // Dim
'\\x1b[3m'  // Italic
'\\x1b[4m'  // Underline

// Foreground Colors (30-37)
'\\x1b[31m' // Red      '\\x1b[32m' // Green
'\\x1b[33m' // Yellow   '\\x1b[34m' // Blue
'\\x1b[35m' // Magenta  '\\x1b[36m' // Cyan
'\\x1b[37m' // White    '\\x1b[90m' // Gray

// Background Colors (40-47)
'\\x1b[41m' // Red bg   '\\x1b[42m' // Green bg
// ... (add 10 to foreground code)

// Example: Bold green text
t.writeln('\\x1b[1m\\x1b[32mBold Green\\x1b[0m');
\`\`\`

## 6. Common Patterns

### Error Handling
\`\`\`javascript
async function main(t) {
  const file = t.args[0];
  if (!file) {
    t.writeln(t.style.red('Usage: myprogram <file>'));
    t.exit(1);
  }
  if (!t.fs.exists(file)) {
    t.writeln(t.style.red(\`Error: \${file} not found\`));
    t.exit(1);
  }
  // Continue...
}
\`\`\`

### Interactive Input
\`\`\`javascript
async function main(t) {
  const name = await t.readLine('Enter name: ');
  t.writeln(\`Hello, \${name}!\`);

  t.write('Continue? [y/n] ');
  const key = await t.readChar();
  t.writeln('');
  if (key.toLowerCase() !== 'y') t.exit(0);
}
\`\`\`

### File Operations
\`\`\`javascript
async function main(t) {
  // Read file
  const content = t.fs.read('/home/tronos/data.txt');

  // Write file
  t.fs.write('/tmp/output.txt', 'Hello World');

  // List directory
  const files = t.fs.list('/home/tronos');
  files.forEach(f => t.writeln(f));
}
\`\`\`

### Progress Display
\`\`\`javascript
async function main(t) {
  const total = 10;
  for (let i = 1; i <= total; i++) {
    t.clearLine();
    t.write(\`\\rProgress: \${i}/\${total}\`);
    await t.sleep(100);
  }
  t.writeln('\\nDone!');
}
\`\`\`

### Network Request
\`\`\`javascript
async function main(t) {
  try {
    const res = await t.net.fetch('https://api.example.com/data');
    const data = await res.json();
    t.writeln(JSON.stringify(data, null, 2));
  } catch (err) {
    t.writeln(t.style.red(\`Fetch error: \${err.message}\`));
    t.exit(1);
  }
}
\`\`\`

### Subprocess Execution
\`\`\`javascript
async function main(t) {
  const result = await t.exec('ls -la /home/tronos');
  if (result.exitCode === 0) {
    t.writeln(result.stdout);
  } else {
    t.writeln(t.style.red(result.stderr));
  }
}
\`\`\`
`;

/**
 * Get the AI context documentation as a string
 * This is the main export for embedding in AI prompts
 */
export function getAIContext(): string {
  return TRONOS_AI_CONTEXT;
}

/**
 * Get a condensed version for token-limited contexts
 * Includes only essential API reference
 */
export function getCondensedAIContext(): string {
  return `# TronOS Quick Reference

## Terminal API (t.*)
- Output: t.write(text), t.writeln(text), t.clear(), t.clearLine()
- Input: await t.readLine(prompt?), await t.readKey(), await t.readChar()
- Cursor: t.moveTo(x,y), t.moveBy(dx,dy), t.getCursor(), t.getSize()
- Style: t.style.{bold,dim,italic,underline,red,green,yellow,blue,cyan,magenta,white,gray}(text)
- Control: t.exit(code?), await t.sleep(ms)
- Context: t.args[], t.env{}, t.cwd
- Files: t.fs.{read,write,append,exists,list,mkdir,remove,stat,cwd,resolve,isFile,isDirectory}
- Network: await t.net.fetch(url), await t.net.proxyFetch(url) (for no-CORS APIs)
- Config: t.config.get(key), t.config.set(key, value)
- System: t.system.version, t.system.versionString
- Exec: await t.exec(command) -> { stdout, stderr, exitCode }

## Executable Format
\`\`\`javascript
// @name: program-name  (REQUIRED)
// @description: Description
async function main(t) {
  t.writeln('Hello!');
}
\`\`\`
`;
}
