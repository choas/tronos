/**
 * AI Command Parser
 *
 * Parses @ai commands to detect mode and extract target files.
 *
 * Supported modes:
 * - create: Generate a new .trx file from description
 * - edit: Modify an existing file based on instructions
 * - explain: Get an explanation of a file's code
 * - fix: Diagnose and fix issues in a file
 * - chat: General conversation (default mode)
 *
 * Command formats:
 * - @ai create <name> <description>     - Create new executable
 * - @ai edit <file> <instructions>      - Edit existing file
 * - @ai explain <file>                  - Explain file contents
 * - @ai fix <file> [error context]      - Fix issues in file
 * - @ai <question>                      - Chat mode (default)
 */

/**
 * AI command modes
 */
export type AIMode = 'create' | 'edit' | 'explain' | 'fix' | 'chat';

/**
 * Parsed AI command result
 */
export interface AICommand {
  /** The detected mode for this AI command */
  mode: AIMode;
  /** Target file path (for edit, explain, fix modes) */
  targetFile: string | null;
  /** Name for new executable (for create mode) */
  programName: string | null;
  /** The user's request/description/question */
  prompt: string;
  /** The raw command string that was parsed */
  rawCommand: string;
}

/**
 * Modes that require a file target
 */
const FILE_MODES: AIMode[] = ['edit', 'explain', 'fix'];

/**
 * Parse an @ai command string into its components
 *
 * @param input - The full command starting with @ai
 * @returns Parsed AI command or null if invalid
 */
export function parseAICommand(input: string): AICommand | null {
  // Trim and normalize whitespace
  const trimmed = input.trim();

  // Verify it starts with @ai
  if (!trimmed.startsWith('@ai')) {
    return null;
  }

  // Remove the @ai prefix and trim
  const afterPrefix = trimmed.slice(3).trim();

  // If nothing after @ai, return null (need at least a prompt)
  if (!afterPrefix) {
    return null;
  }

  // Split into words for parsing
  const words = tokenizeAIInput(afterPrefix);

  if (words.length === 0) {
    return null;
  }

  // Check if first word is a mode keyword
  const firstWord = words[0].toLowerCase();

  // Parse based on detected mode
  if (firstWord === 'create') {
    return parseCreateCommand(words, trimmed);
  }

  if (firstWord === 'edit') {
    return parseFileCommand('edit', words, trimmed);
  }

  if (firstWord === 'explain') {
    return parseFileCommand('explain', words, trimmed);
  }

  if (firstWord === 'fix') {
    return parseFileCommand('fix', words, trimmed);
  }

  // Default to chat mode - entire input after @ai is the prompt
  return {
    mode: 'chat',
    targetFile: null,
    programName: null,
    prompt: afterPrefix,
    rawCommand: trimmed
  };
}

/**
 * Parse a 'create' mode command
 * Format: @ai create <name> <description>
 */
function parseCreateCommand(words: string[], rawCommand: string): AICommand {
  // words[0] is 'create'
  // words[1] should be the program name
  // words[2+] is the description

  if (words.length < 2) {
    // No name provided, treat the prompt as description
    return {
      mode: 'create',
      targetFile: null,
      programName: null,
      prompt: words.slice(1).join(' '),
      rawCommand
    };
  }

  const programName = words[1];
  const description = words.slice(2).join(' ');

  return {
    mode: 'create',
    targetFile: null,
    programName: programName || null,
    prompt: description || `Create a program called ${programName}`,
    rawCommand
  };
}

/**
 * Parse a file-based command (edit, explain, fix)
 * Format: @ai <mode> <file> [instructions/context]
 */
function parseFileCommand(mode: AIMode, words: string[], rawCommand: string): AICommand {
  // words[0] is the mode
  // words[1] should be the file path
  // words[2+] is the instructions/context (optional for explain)

  if (words.length < 2) {
    // No file provided - return with null targetFile
    // The caller should handle this error case
    return {
      mode,
      targetFile: null,
      programName: null,
      prompt: '',
      rawCommand
    };
  }

  const targetFile = words[1];
  const prompt = words.slice(2).join(' ');

  return {
    mode,
    targetFile,
    programName: null,
    prompt: prompt || getDefaultPrompt(mode, targetFile),
    rawCommand
  };
}

/**
 * Get a default prompt for a mode when none is provided
 */
function getDefaultPrompt(mode: AIMode, targetFile: string): string {
  switch (mode) {
    case 'explain':
      return `Explain the code in ${targetFile}`;
    case 'fix':
      return `Find and fix issues in ${targetFile}`;
    case 'edit':
      return `Edit ${targetFile}`;
    default:
      return '';
  }
}

/**
 * Tokenize AI input, respecting quoted strings
 *
 * Handles:
 * - Single quotes: 'some text'
 * - Double quotes: "some text"
 * - Unquoted words separated by whitespace
 */
function tokenizeAIInput(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote) {
        // End of single quote - add token
        tokens.push(current);
        current = '';
        inSingleQuote = false;
      } else {
        // Start of single quote
        if (current) {
          tokens.push(current);
          current = '';
        }
        inSingleQuote = true;
      }
    } else if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote) {
        // End of double quote - add token
        tokens.push(current);
        current = '';
        inDoubleQuote = false;
      } else {
        // Start of double quote
        if (current) {
          tokens.push(current);
          current = '';
        }
        inDoubleQuote = true;
      }
    } else if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      // Whitespace outside quotes - token boundary
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  // Add final token if any
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Check if a command is an AI command (starts with @ai or @)
 */
export function isAICommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.startsWith('@ai') || trimmed.startsWith('@');
}

/**
 * Extract the AI command prefix (@ai, @ask, etc.)
 */
export function getAICommandPrefix(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^@\w*/);
  return match ? match[0] : '@ai';
}

/**
 * Validate that an AI command has required fields based on mode
 */
export function validateAICommand(cmd: AICommand): { valid: boolean; error?: string } {
  // Check if mode requires a file target
  if (FILE_MODES.includes(cmd.mode) && !cmd.targetFile) {
    return {
      valid: false,
      error: `The '${cmd.mode}' command requires a target file. Usage: @ai ${cmd.mode} <file>${cmd.mode !== 'explain' ? ' <instructions>' : ''}`
    };
  }

  // Check if create mode has a program name
  if (cmd.mode === 'create' && !cmd.programName) {
    return {
      valid: false,
      error: "The 'create' command requires a program name. Usage: @ai create <name> <description>"
    };
  }

  // Check if we have a prompt for modes that need it
  if (cmd.mode === 'create' && !cmd.prompt) {
    return {
      valid: false,
      error: "The 'create' command requires a description. Usage: @ai create <name> <description>"
    };
  }

  if (cmd.mode === 'edit' && !cmd.prompt) {
    return {
      valid: false,
      error: "The 'edit' command requires instructions. Usage: @ai edit <file> <instructions>"
    };
  }

  return { valid: true };
}
