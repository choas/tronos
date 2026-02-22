/**
 * @fileoverview Shell command parser with lexer and AST builder.
 *
 * This module provides the parsing infrastructure for the AIOS shell:
 * - `tokenize()`: Lexical analysis converting command strings to tokens
 * - `buildAST()`: Syntax analysis building an abstract syntax tree
 * - `expandAliases()`: Alias expansion with cycle detection
 * - `expandVariables()`: Environment variable expansion
 *
 * The parser supports:
 * - Simple commands with arguments
 * - Pipes (`|`) for command chaining
 * - Output redirection (`>`, `>>`)
 * - Logical operators (`&&`, `||`)
 * - Command sequences (`;`)
 * - Single and double quoted strings
 * - Environment variable expansion (`$VAR`, `${VAR}`)
 *
 * @module engine/parser
 */

import type { Token, ParsedCommand, SimpleCommand, Redirect } from './types';

/**
 * Build an Abstract Syntax Tree from a token array.
 *
 * Parses tokens according to shell grammar with proper operator precedence:
 * 1. Simple commands (lowest)
 * 2. Pipelines (`|`)
 * 3. Logical sequences (`&&`, `||`)
 * 4. Command sequences (`;`) (highest)
 *
 * @param tokens - Array of tokens from `tokenize()`
 * @returns Array of parsed command AST nodes
 * @throws Error if syntax is invalid (unexpected token, missing filename, etc.)
 *
 * @example
 * const tokens = tokenize('echo hello | grep h');
 * const ast = buildAST(tokens);
 * // Returns: [{ type: 'Pipeline', commands: [...] }]
 *
 * @example
 * const tokens = tokenize('mkdir dir && cd dir');
 * const ast = buildAST(tokens);
 * // Returns: [{ type: 'LogicalSequence', left: {...}, operator: 'and', right: {...} }]
 */
export function buildAST(tokens: Token[]): ParsedCommand[] {
  if (!tokens.length) {
    return [];
  }
  
  const commands: ParsedCommand[] = [];
  let current = 0;

  function peek(): Token | undefined {
    return tokens[current];
  }

  function consume(): Token {
    return tokens[current++];
  }

  function parseSimpleCommand(): SimpleCommand {
    if (!peek() || (peek()?.type !== 'word' && peek()?.type !== 'dstring' && peek()?.type !== 'sstring')) {
      throw new Error(`Expected command name but got ${peek()?.type}`);
    }
    const command = consume().value;
    const args: string[] = [];
    const redirects: Redirect[] = [];

    while (peek()) {
      const token = peek()!;
      if (token.type === 'word' || token.type === 'dstring' || token.type === 'sstring') {
        args.push(consume().value);
      } else if (token.type === 'redirect' || token.type === 'append') {
        consume(); // consume the redirect operator
        const fileToken = peek();
        if (!fileToken || (fileToken.type !== 'word' && fileToken.type !== 'dstring' && fileToken.type !== 'sstring')) {
          throw new Error('Expected filename for redirection');
        }
        redirects.push({ type: token.type, file: consume().value });
      } else {
        break; // End of simple command
      }
    }

    return { type: 'Command', command, args, redirects };
  }

  function parsePipeline(): ParsedCommand {
    const commands: SimpleCommand[] = [parseSimpleCommand()];

    while (peek()?.type === 'pipe') {
      consume(); // consume '|'
      commands.push(parseSimpleCommand());
    }

    if (commands.length > 1) {
      return { type: 'Pipeline', commands };
    }

    return commands[0];
  }

  function parseLogicalSequence(): ParsedCommand {
    let left = parsePipeline();

    while (peek()?.type === 'and' || peek()?.type === 'or') {
      const operator = consume().type as 'and' | 'or';
      const right = parsePipeline();
      left = { type: 'LogicalSequence', left, operator, right };
    }

    return left;
  }

  while (current < tokens.length) {
    commands.push(parseLogicalSequence());
    if (peek()?.type === 'semicolon') {
      consume();
    } else if (peek()) {
      throw new Error(`Unexpected token: ${peek()?.type}`);
    }
  }

  return commands;
}

/**
 * Tokenize a shell command string into an array of tokens.
 *
 * The lexer recognizes:
 * - Words: Unquoted sequences of characters
 * - Single-quoted strings: Literal text with no escape processing
 * - Double-quoted strings: Text with escape sequences (`\\`, `\"`)
 * - Operators: `|`, `||`, `&&`, `>`, `>>`, `;`
 *
 * Whitespace is used as a delimiter and discarded. Quoted strings
 * preserve internal whitespace.
 *
 * @param input - The raw command line string to tokenize
 * @returns Array of tokens with type and value
 * @throws Error if a quoted string is not terminated
 *
 * @example
 * tokenize('echo "hello world"')
 * // Returns: [
 * //   { type: 'word', value: 'echo' },
 * //   { type: 'dstring', value: 'hello world' }
 * // ]
 *
 * @example
 * tokenize('ls | grep txt')
 * // Returns: [
 * //   { type: 'word', value: 'ls' },
 * //   { type: 'pipe', value: '|' },
 * //   { type: 'word', value: 'grep' },
 * //   { type: 'word', value: 'txt' }
 * // ]
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let current = 0;

  while (current < input.length) {
    let char = input[current];

    if (/\s/.test(char)) {
      current++;
      continue;
    }

    if (char === '|') {
      if (input[current + 1] === '|') {
        tokens.push({ type: 'or', value: '||' });
        current += 2;
        continue;
      }
      tokens.push({ type: 'pipe', value: '|' });
      current++;
      continue;
    }

    if (char === '&') {
      if (input[current + 1] === '&') {
        tokens.push({ type: 'and', value: '&&' });
        current += 2;
        continue;
      }
    }

    if (char === '>') {
      if (input[current + 1] === '>') {
        tokens.push({ type: 'append', value: '>>' });
        current += 2;
        continue;
      }
      tokens.push({ type: 'redirect', value: '>' });
      current++;
      continue;
    }
    
    if (char === ';') {
      tokens.push({ type: 'semicolon', value: ';' });
      current++;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const tokenType = quote === '"' ? 'dstring' : 'sstring';
      let value = '';
      char = input[++current];
      while (char !== quote && current < input.length) {
        if (char === '\\' && (input[current + 1] === quote || input[current + 1] === '\\')) {
          value += input[current + 1];
          current += 2;
        } else {
          value += char;
          current++;
        }
        char = input[current];
      }
      if (char !== quote) {
        throw new Error('Unterminated string');
      }
      current++; // Skip closing quote
      tokens.push({ type: tokenType, value });
      continue;
    }

    let value = '';
    while (char && !/(\s|\||&|>|;)/.test(char)) {
      // Handle quoted strings embedded in words (e.g., alias name='value with spaces')
      if (char === '"' || char === "'") {
        const quote = char;
        value += char; // Include opening quote in the word
        char = input[++current];
        while (char !== quote && current < input.length) {
          if (char === '\\' && (input[current + 1] === quote || input[current + 1] === '\\')) {
            value += char;
            value += input[current + 1];
            current += 2;
          } else {
            value += char;
            current++;
          }
          char = input[current];
        }
        if (char === quote) {
          value += char; // Include closing quote in the word
          current++;
        }
        char = input[current];
      } else {
        value += char;
        char = input[++current];
      }
    }
    tokens.push({ type: 'word', value });
  }

  return tokens;
}

/**
 * Expand aliases in a token stream.
 *
 * Aliases are only expanded in command position (first word of a simple command).
 * The function handles command boundaries created by pipes, semicolons, and
 * logical operators to correctly identify command positions.
 *
 * Features:
 * - Recursive expansion: If an alias expands to another alias, it's expanded too
 * - Cycle detection: Prevents infinite loops from self-referential aliases
 * - Boundary awareness: Restarts command position detection after `|`, `;`, `&&`, `||`
 *
 * @param tokens - Array of tokens to expand aliases in
 * @param aliases - Map of alias names to their values
 * @param expandedAliases - Set of already-expanded aliases (for cycle detection)
 * @returns New token array with aliases expanded
 *
 * @example
 * const aliases = new Map([['ll', 'ls -la']]);
 * const tokens = tokenize('ll /home');
 * const expanded = expandAliases(tokens, aliases);
 * // Returns tokens for: ls -la /home
 *
 * @example
 * // Chained aliases
 * const aliases = new Map([['l', 'ls'], ['ll', 'l -la']]);
 * const tokens = tokenize('ll');
 * const expanded = expandAliases(tokens, aliases);
 * // Returns tokens for: ls -la
 */
export function expandAliases(
  tokens: Token[],
  aliases: Map<string, string>,
  expandedAliases: Set<string> = new Set()
): Token[] {
  if (tokens.length === 0 || aliases.size === 0) {
    return tokens;
  }

  const result: Token[] = [];
  let isCommandPosition = true;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // After pipe, semicolon, &&, or || we're in command position again
    if (token.type === 'pipe' || token.type === 'semicolon' ||
        token.type === 'and' || token.type === 'or') {
      result.push(token);
      isCommandPosition = true;
      continue;
    }

    // Expand aliases only in command position (first word)
    if (isCommandPosition && token.type === 'word' && aliases.has(token.value)) {
      const aliasName = token.value;

      // Prevent infinite recursion
      if (expandedAliases.has(aliasName)) {
        result.push(token);
        isCommandPosition = false;
        continue;
      }

      // Create a new set for this expansion chain
      const newExpandedAliases = new Set(expandedAliases);
      newExpandedAliases.add(aliasName);

      const aliasValue = aliases.get(aliasName)!;

      // Tokenize the alias value and insert those tokens
      const aliasTokens = tokenize(aliasValue);

      // Recursively expand any aliases in the expanded value
      const expandedAliasTokens = expandAliases(aliasTokens, aliases, newExpandedAliases);
      result.push(...expandedAliasTokens);

      isCommandPosition = false;
      continue;
    }

    result.push(token);

    // After a word/string token, we're no longer in command position
    if (token.type === 'word' || token.type === 'dstring' || token.type === 'sstring') {
      isCommandPosition = false;
    }
  }

  return result;
}

/**
 * Expand environment variables in tokens.
 *
 * Supports two syntax forms:
 * - `$VAR`: Simple variable reference
 * - `${VAR}`: Braced variable reference (required when followed by alphanumerics)
 *
 * Variable expansion occurs in:
 * - Word tokens (unquoted)
 * - Double-quoted strings
 *
 * Single-quoted strings are NOT expanded (they preserve literal `$` characters).
 * If a variable is not defined, it expands to an empty string.
 *
 * @param tokens - Array of tokens to expand variables in
 * @param env - Environment variables as key-value pairs
 * @returns New token array with variables expanded
 * @throws Error if a braced variable reference is not terminated
 *
 * @example
 * const env = { HOME: '/home/user', NAME: 'Alice' };
 * const tokens = tokenize('echo $HOME');
 * const expanded = expandVariables(tokens, env);
 * // Returns tokens with value '/home/user'
 *
 * @example
 * const env = { PREFIX: 'test' };
 * const tokens = tokenize('echo ${PREFIX}_file.txt');
 * const expanded = expandVariables(tokens, env);
 * // Returns tokens with value 'test_file.txt'
 */
export function expandVariables(tokens: Token[], env: { [key: string]: string }): Token[] {
  const expandedTokens: Token[] = [];

  for (const token of tokens) {
    if (token.type === 'word' || token.type === 'dstring') {
      let value = '';
      let current = 0;
      while (current < token.value.length) {
        let char = token.value[current];
        if (char === '$') {
          let varName = '';
          char = token.value[++current];
          if (char === '{') {
            char = token.value[++current];
            while (char !== '}' && current < token.value.length) {
              varName += char;
              char = token.value[++current];
            }
            if (char !== '}') {
              throw new Error('Unterminated variable expansion');
            }
            current++; // Skip closing brace
          } else {
            while (char && /[a-zA-Z0-9_]/.test(char)) {
              varName += char;
              char = token.value[++current];
            }
          }
          value += env[varName] || '';
        } else {
          value += char;
          current++;
        }
      }
      expandedTokens.push({ ...token, value });
    } else {
      expandedTokens.push(token);
    }
  }

  return expandedTokens;
}

