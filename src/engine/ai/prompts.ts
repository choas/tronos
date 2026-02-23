/**
 * AI System Prompts
 *
 * Builds system prompts for AI interactions, including:
 * - Terminal API reference for .trx files
 * - Executable format specification
 * - Context about the current environment (cwd, files)
 *
 * Uses comprehensive documentation from tronos-ai-context.ts
 */

import type { AIMode } from './parser';
import type { InMemoryVFS } from '../../vfs/memory';
import { getAIContext, getCondensedAIContext } from './tronos-ai-context';

/**
 * Context information for AI prompts
 */
export interface PromptContext {
  /** Current working directory */
  cwd: string;
  /** Environment variables */
  env: Record<string, string>;
  /** VFS instance for file context */
  vfs?: InMemoryVFS;
  /** File content for edit/explain/fix modes */
  fileContent?: string;
  /** Target file path */
  targetFile?: string;
  /** Error context for fix mode */
  errorContext?: string;
}

/**
 * Terminal API reference documentation for AI
 * This is a condensed version; full docs are in tronos-ai-context.ts
 */
const TERMINAL_API_REFERENCE = `
## Terminal API Reference

Your code runs in an async function with a \`t\` parameter (SandboxTerminalAPI). Use \`await\` for async operations.

### Output Methods
- \`t.write(text)\` - Write text to terminal (no newline)
- \`t.writeln(text)\` - Write text with newline
- \`t.clear()\` - Clear the terminal screen
- \`t.clearLine()\` - Clear the current line

### Cursor Control
- \`t.moveTo(x, y)\` - Move cursor to absolute position (0-indexed)
- \`t.moveBy(dx, dy)\` - Move cursor relative to current position
- \`t.getCursor()\` - Returns { x: number, y: number } cursor position
- \`t.getSize()\` - Returns { cols: number, rows: number } terminal size

### Input Methods
- \`await t.readLine(prompt?)\` - Read a line of input (optional prompt)
- \`await t.readKey()\` - Read a single keypress, returns { key: string, domEvent?: KeyboardEvent }
- \`await t.readChar()\` - Read a single printable character
- \`t.hasInput()\` - Check if input is available (non-blocking)

### Styling Helpers (t.style.*)
Use the built-in style helpers for colored output:
- \`t.style.bold(text)\`, \`t.style.dim(text)\`, \`t.style.italic(text)\`, \`t.style.underline(text)\`
- \`t.style.inverse(text)\`, \`t.style.hidden(text)\`, \`t.style.strikethrough(text)\`
- Colors: \`t.style.red(text)\`, \`t.style.green(text)\`, \`t.style.yellow(text)\`, \`t.style.blue(text)\`
- More: \`t.style.magenta(text)\`, \`t.style.cyan(text)\`, \`t.style.white(text)\`, \`t.style.gray(text)\`
- \`t.style.reset(text)\` - Remove all styling

Example: \`t.writeln(t.style.bold(t.style.green('Success!')))\`

### File System (via t.fs)
- \`t.fs.read(path)\` - Read file content (string | Promise<string>)
- \`t.fs.write(path, content)\` - Write content to file
- \`t.fs.append(path, content)\` - Append content to file
- \`t.fs.exists(path)\` - Check if path exists (boolean)
- \`t.fs.list(path)\` - List directory contents (string[])
- \`t.fs.mkdir(path)\` - Create directory (recursive)
- \`t.fs.remove(path)\` - Remove file/directory (recursive)
- \`t.fs.stat(path)\` - Get { type: 'file'|'directory', name: string }
- \`t.fs.cwd()\` - Get current working directory
- \`t.fs.resolve(path)\` - Resolve relative path to absolute
- \`t.fs.isFile(path)\`, \`t.fs.isDirectory(path)\` - Check type

### Network (via t.net)
- \`await t.net.fetch(url, options?)\` - Same as browser fetch API

### Program Control
- \`t.exit(code?)\` - Exit program with optional exit code (default 0)
- \`await t.sleep(ms)\` - Pause execution for milliseconds

### Context (read-only)
- \`t.args\` - Array of command-line arguments (string[])
- \`t.env\` - Environment variables ({ [key: string]: string })
- \`t.cwd\` - Current working directory (string)

### Package Config (for installed packages)
- \`t.config.get(key)\` - Get config value (string | number | boolean | undefined)
- \`t.config.set(key, value)\` - Set config value (returns boolean)

### Subprocess Execution
- \`await t.exec(command)\` - Run shell command, returns { stdout, stderr, exitCode }

### System Information
- \`t.system.version\` - Version number (e.g., "0.1.0")
- \`t.system.versionString\` - Full version (e.g., "TronOS v0.1.0")
`;

/**
 * Executable format specification for AI
 */
const EXECUTABLE_FORMAT_SPEC = `
## Executable Format (.trx)

TronOS executables are JavaScript files with a specific format:

\`\`\`javascript
// @name: program-name
// @description: Brief description of what the program does
// @version: 1.0.0
// @author: @ai
// @requires: network

async function main(t) {
  // Your program code here
  // t is the SandboxTerminalAPI object

  t.writeln('Hello from my program!');
}
\`\`\`

### Header Comments (metadata)
- \`@name\` - (Required) Program name, used for identification
- \`@description\` - Brief description of functionality
- \`@version\` - Semantic version number
- \`@author\` - Author name or "@ai" for AI-generated
- \`@requires\` - Comma-separated features: network, clipboard, storage

### Main Function
- Must be named \`main\` (or anonymous function)
- Must be \`async\`
- Receives single parameter \`t\` (SandboxTerminalAPI)
- Return value is ignored; use \`t.exit(code)\` for exit status

### Example: Interactive Greeting

\`\`\`javascript
// @name: greet
// @description: Interactive greeting program
// @author: @ai

async function main(t) {
  const name = await t.readLine('What is your name? ');
  t.writeln(t.style.green(\`Hello, \${name}! Welcome to TronOS.\`));
}
\`\`\`

### Example: File Reader

\`\`\`javascript
// @name: reader
// @description: Display file contents with line numbers
// @author: @ai

async function main(t) {
  const filename = t.args[0];

  if (!filename) {
    t.writeln(t.style.yellow('Usage: reader <filename>'));
    t.exit(1);
  }

  if (!t.fs.exists(filename)) {
    t.writeln(t.style.red(\`Error: File not found: \${filename}\`));
    t.exit(1);
  }

  const content = t.fs.read(filename);
  const lines = content.split('\\n');

  lines.forEach((line, i) => {
    t.writeln(\`\${t.style.dim(String(i + 1).padStart(4) + ':')} \${line}\`);
  });
}
\`\`\`

### Example: Countdown Timer

\`\`\`javascript
// @name: countdown
// @description: Countdown timer with visual display
// @author: @ai

async function main(t) {
  const seconds = parseInt(t.args[0]) || 10;

  for (let i = seconds; i >= 0; i--) {
    t.clearLine();
    t.write(\`\\rTime remaining: \${t.style.bold(String(i))}s \`);
    if (i > 0) await t.sleep(1000);
  }

  t.writeln('\\n' + t.style.green("Time's up!"));
}
\`\`\`
`;

/**
 * Build context section describing current environment
 */
function buildContextSection(context: PromptContext): string {
  const parts: string[] = [];

  parts.push('## Current Environment\n');
  parts.push(`- Working directory: ${context.cwd}`);

  // Add relevant environment variables
  const relevantEnvVars = ['USER', 'HOME', 'PATH'];
  const envInfo = relevantEnvVars
    .filter(key => context.env[key])
    .map(key => `- ${key}: ${context.env[key]}`);

  if (envInfo.length > 0) {
    parts.push(...envInfo);
  }

  // Add file listing if VFS is available
  if (context.vfs) {
    try {
      const files = context.vfs.list(context.cwd);
      if (files.length > 0) {
        const exeFiles = files.filter(f => f.endsWith('.trx'));
        const otherFiles = files.filter(f => !f.endsWith('.trx'));

        if (exeFiles.length > 0) {
          parts.push(`\n### Executables in cwd:\n${exeFiles.map(f => `- ${f}`).join('\n')}`);
        }
        if (otherFiles.length > 0 && otherFiles.length <= 20) {
          parts.push(`\n### Files in cwd:\n${otherFiles.map(f => `- ${f}`).join('\n')}`);
        } else if (otherFiles.length > 20) {
          parts.push(`\n### Files in cwd: ${otherFiles.length} files (listing truncated)`);
        }
      }
    } catch {
      // Ignore errors listing files
    }
  }

  return parts.join('\n');
}

/**
 * Build system prompt for create mode
 * Uses comprehensive AI context for accurate code generation
 */
function buildCreatePrompt(context: PromptContext): string {
  return `You are an AI assistant that generates TronOS executable programs.

${getAIContext()}

${buildContextSection(context)}

## Instructions

Generate a complete, working TronOS executable based on the user's description.

Rules:
1. Always include the required @name metadata comment
2. Always use the async function main(t) format
3. Use the Terminal API correctly - don't use console.log or other browser APIs
4. Use t.style.* helpers for colored output (e.g., t.style.red(), t.style.green())
5. Handle edge cases and provide helpful error messages
6. Add appropriate metadata comments (@description, @version, @author: @ai)
7. Return ONLY the executable code - no explanations or markdown code blocks
8. Make the program user-friendly with clear prompts and output

Respond with just the executable code.`;
}

/**
 * Build system prompt for edit mode
 */
function buildEditPrompt(context: PromptContext): string {
  const fileSection = context.fileContent
    ? `\n## Current File Content (${context.targetFile})\n\n\`\`\`javascript\n${context.fileContent}\n\`\`\``
    : '';

  return `You are an AI assistant that modifies TronOS executable programs.

${EXECUTABLE_FORMAT_SPEC}

${TERMINAL_API_REFERENCE}

${buildContextSection(context)}
${fileSection}

## Instructions

Modify the existing executable according to the user's instructions.

Rules:
1. Preserve the existing metadata comments unless asked to change them
2. Maintain the async function main(t) format
3. Only modify what the user asks for
4. Keep the code working and functional
5. Return ONLY the complete modified code - no explanations

Respond with the complete modified executable code.`;
}

/**
 * Build system prompt for explain mode
 */
function buildExplainPrompt(context: PromptContext): string {
  const fileSection = context.fileContent
    ? `\n## File Content (${context.targetFile})\n\n\`\`\`javascript\n${context.fileContent}\n\`\`\``
    : '';

  return `You are an AI assistant that explains TronOS executable programs.

${TERMINAL_API_REFERENCE}

${buildContextSection(context)}
${fileSection}

## Instructions

Provide a clear, concise explanation of the code.

Include:
1. What the program does (high-level purpose)
2. How it works (step-by-step flow)
3. Key Terminal API methods used
4. Any notable techniques or patterns
5. Usage instructions and examples

Keep explanations concise but thorough. Use bullet points and code examples where helpful.`;
}

/**
 * Build system prompt for fix mode
 */
function buildFixPrompt(context: PromptContext): string {
  const fileSection = context.fileContent
    ? `\n## Current File Content (${context.targetFile})\n\n\`\`\`javascript\n${context.fileContent}\n\`\`\``
    : '';

  const errorSection = context.errorContext
    ? `\n## Error Context\n\n\`\`\`\n${context.errorContext}\n\`\`\``
    : '';

  return `You are an AI assistant that diagnoses and fixes issues in TronOS executable programs.

${EXECUTABLE_FORMAT_SPEC}

${TERMINAL_API_REFERENCE}

${buildContextSection(context)}
${fileSection}
${errorSection}

## Instructions

Analyze the code for issues and provide a fix.

Approach:
1. Identify the problem (syntax errors, logic bugs, API misuse)
2. Explain what's wrong in a brief comment
3. Provide the corrected code

Rules:
1. Fix only what's broken unless other improvements are clearly needed
2. Maintain the async function main(t) format
3. Preserve metadata comments
4. Return the complete fixed code after your brief explanation

Format your response as:
<explanation>
Brief explanation of the issue(s) found and fixed.
</explanation>

<code>
// The complete fixed code here
</code>`;
}

/**
 * Build system prompt for chat mode
 * Uses the full AI context for comprehensive knowledge
 */
function buildChatPrompt(context: PromptContext): string {
  return `You are an AI assistant for TronOS, a browser-based operating system.

${buildContextSection(context)}

## About TronOS

TronOS provides:
- A Unix-like shell with common commands (ls, cd, cat, grep, etc.)
- A virtual filesystem with persistence to IndexedDB
- Executable programs (.trx files) written in JavaScript
- Multiple sessions with isolated filesystems
- AI integration via @ai commands
- Package manager (tpkg) for installing and managing packages

## Your Role

Help users with:
- General questions about using TronOS
- Shell commands and their options
- Writing and debugging .trx programs
- Understanding the Terminal API
- File system operations
- Troubleshooting issues

Be helpful, concise, and practical. If a user asks about creating or modifying programs, you can explain how without generating full code (unless they use @ai create or @ai edit).

${getCondensedAIContext()}`;
}

/**
 * Build the complete system prompt based on mode and context
 */
export function buildSystemPrompt(mode: AIMode, context: PromptContext): string {
  switch (mode) {
    case 'create':
      return buildCreatePrompt(context);
    case 'edit':
      return buildEditPrompt(context);
    case 'explain':
      return buildExplainPrompt(context);
    case 'fix':
      return buildFixPrompt(context);
    case 'chat':
    default:
      return buildChatPrompt(context);
  }
}

/**
 * Build a user message for the AI based on the command
 */
export function buildUserMessage(
  mode: AIMode,
  prompt: string,
  programName?: string | null
): string {
  switch (mode) {
    case 'create':
      return programName
        ? `Create an executable program named "${programName}":\n\n${prompt}`
        : `Create an executable program:\n\n${prompt}`;
    case 'edit':
      return `Edit this file with the following changes:\n\n${prompt}`;
    case 'explain':
      return prompt || 'Explain this code.';
    case 'fix':
      return prompt || 'Find and fix any issues in this code.';
    case 'chat':
    default:
      return prompt;
  }
}

/**
 * Get the Terminal API reference (for export/use elsewhere)
 */
export function getTerminalAPIReference(): string {
  return TERMINAL_API_REFERENCE;
}

/**
 * Get the executable format spec (for export/use elsewhere)
 */
export function getExecutableFormatSpec(): string {
  return EXECUTABLE_FORMAT_SPEC;
}
