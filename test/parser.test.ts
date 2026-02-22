import { describe, it, expect } from 'vitest';
import { tokenize, buildAST, expandVariables } from '../src/engine/parser';
import type { Token, SimpleCommand, Pipeline, LogicalSequence } from '../src/engine/types';

describe('tokenize', () => {
  describe('basic tokenization', () => {
    it('should tokenize a simple command', () => {
      const tokens = tokenize('echo hello');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'hello' }
      ]);
    });

    it('should tokenize a command with multiple arguments', () => {
      const tokens = tokenize('ls -la /home');
      expect(tokens).toEqual([
        { type: 'word', value: 'ls' },
        { type: 'word', value: '-la' },
        { type: 'word', value: '/home' }
      ]);
    });

    it('should handle empty input', () => {
      const tokens = tokenize('');
      expect(tokens).toEqual([]);
    });

    it('should handle whitespace-only input', () => {
      const tokens = tokenize('   \t\n  ');
      expect(tokens).toEqual([]);
    });

    it('should handle multiple spaces between words', () => {
      const tokens = tokenize('echo   hello    world');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'hello' },
        { type: 'word', value: 'world' }
      ]);
    });

    it('should handle leading and trailing whitespace', () => {
      const tokens = tokenize('   echo hello   ');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'hello' }
      ]);
    });
  });

  describe('string tokenization', () => {
    it('should tokenize double-quoted strings', () => {
      const tokens = tokenize('echo "hello world"');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'dstring', value: 'hello world' }
      ]);
    });

    it('should tokenize single-quoted strings', () => {
      const tokens = tokenize("echo 'hello world'");
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'sstring', value: 'hello world' }
      ]);
    });

    it('should handle empty double-quoted strings', () => {
      const tokens = tokenize('echo ""');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'dstring', value: '' }
      ]);
    });

    it('should handle empty single-quoted strings', () => {
      const tokens = tokenize("echo ''");
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'sstring', value: '' }
      ]);
    });

    it('should handle escaped quotes in double-quoted strings', () => {
      const tokens = tokenize('echo "hello \\"world\\""');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'dstring', value: 'hello "world"' }
      ]);
    });

    it('should handle escaped backslashes in double-quoted strings', () => {
      const tokens = tokenize('echo "path\\\\file"');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'dstring', value: 'path\\file' }
      ]);
    });

    it('should throw on unterminated double-quoted string', () => {
      expect(() => tokenize('echo "hello')).toThrow('Unterminated string');
    });

    it('should throw on unterminated single-quoted string', () => {
      expect(() => tokenize("echo 'hello")).toThrow('Unterminated string');
    });

    it('should handle mixed quotes', () => {
      const tokens = tokenize('echo "hello" \'world\'');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'dstring', value: 'hello' },
        { type: 'sstring', value: 'world' }
      ]);
    });

    it('should handle quotes with special characters inside', () => {
      const tokens = tokenize('echo "a|b&&c||d;e>f>>g"');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'dstring', value: 'a|b&&c||d;e>f>>g' }
      ]);
    });
  });

  describe('operator tokenization', () => {
    it('should tokenize pipe operator', () => {
      const tokens = tokenize('ls | grep test');
      expect(tokens).toEqual([
        { type: 'word', value: 'ls' },
        { type: 'pipe', value: '|' },
        { type: 'word', value: 'grep' },
        { type: 'word', value: 'test' }
      ]);
    });

    it('should tokenize and operator', () => {
      const tokens = tokenize('true && echo success');
      expect(tokens).toEqual([
        { type: 'word', value: 'true' },
        { type: 'and', value: '&&' },
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'success' }
      ]);
    });

    it('should tokenize or operator', () => {
      const tokens = tokenize('false || echo fallback');
      expect(tokens).toEqual([
        { type: 'word', value: 'false' },
        { type: 'or', value: '||' },
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'fallback' }
      ]);
    });

    it('should tokenize redirect operator', () => {
      const tokens = tokenize('echo hello > file.txt');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'hello' },
        { type: 'redirect', value: '>' },
        { type: 'word', value: 'file.txt' }
      ]);
    });

    it('should tokenize append operator', () => {
      const tokens = tokenize('echo hello >> file.txt');
      expect(tokens).toEqual([
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'hello' },
        { type: 'append', value: '>>' },
        { type: 'word', value: 'file.txt' }
      ]);
    });

    it('should tokenize semicolon operator', () => {
      const tokens = tokenize('ls; pwd');
      expect(tokens).toEqual([
        { type: 'word', value: 'ls' },
        { type: 'semicolon', value: ';' },
        { type: 'word', value: 'pwd' }
      ]);
    });

    it('should handle operators without spaces', () => {
      const tokens = tokenize('ls|grep test');
      expect(tokens).toEqual([
        { type: 'word', value: 'ls' },
        { type: 'pipe', value: '|' },
        { type: 'word', value: 'grep' },
        { type: 'word', value: 'test' }
      ]);
    });

    it('should handle multiple operators in sequence', () => {
      const tokens = tokenize('a | b && c || d');
      expect(tokens).toEqual([
        { type: 'word', value: 'a' },
        { type: 'pipe', value: '|' },
        { type: 'word', value: 'b' },
        { type: 'and', value: '&&' },
        { type: 'word', value: 'c' },
        { type: 'or', value: '||' },
        { type: 'word', value: 'd' }
      ]);
    });
  });

  describe('embedded quotes in words', () => {
    it('should handle embedded single quotes in word', () => {
      const tokens = tokenize("alias ll='ls -la'");
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toEqual({ type: 'word', value: 'alias' });
      expect(tokens[1].type).toBe('word');
      expect(tokens[1].value).toContain("'ls -la'");
    });

    it('should handle embedded double quotes in word', () => {
      const tokens = tokenize('alias ll="ls -la"');
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toEqual({ type: 'word', value: 'alias' });
      expect(tokens[1].type).toBe('word');
      expect(tokens[1].value).toContain('"ls -la"');
    });
  });
});

describe('buildAST', () => {
  describe('simple commands', () => {
    it('should build AST for a simple command', () => {
      const tokens = tokenize('echo hello');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(1);
      expect(ast[0].type).toBe('Command');
      const cmd = ast[0] as SimpleCommand;
      expect(cmd.command).toBe('echo');
      expect(cmd.args).toEqual(['hello']);
      expect(cmd.redirects).toEqual([]);
    });

    it('should build AST for a command with multiple arguments', () => {
      const tokens = tokenize('ls -l -a /home');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(1);
      const cmd = ast[0] as SimpleCommand;
      expect(cmd.command).toBe('ls');
      expect(cmd.args).toEqual(['-l', '-a', '/home']);
    });

    it('should handle empty input', () => {
      const ast = buildAST([]);
      expect(ast).toEqual([]);
    });

    it('should handle string arguments', () => {
      const tokens = tokenize('echo "hello world"');
      const ast = buildAST(tokens);
      const cmd = ast[0] as SimpleCommand;
      expect(cmd.args).toEqual(['hello world']);
    });
  });

  describe('redirects', () => {
    it('should parse output redirect', () => {
      const tokens = tokenize('echo hello > file.txt');
      const ast = buildAST(tokens);
      const cmd = ast[0] as SimpleCommand;
      expect(cmd.command).toBe('echo');
      expect(cmd.args).toEqual(['hello']);
      expect(cmd.redirects).toEqual([{ type: 'redirect', file: 'file.txt' }]);
    });

    it('should parse append redirect', () => {
      const tokens = tokenize('echo hello >> file.txt');
      const ast = buildAST(tokens);
      const cmd = ast[0] as SimpleCommand;
      expect(cmd.redirects).toEqual([{ type: 'append', file: 'file.txt' }]);
    });

    it('should parse multiple redirects', () => {
      const tokens = tokenize('echo hello > out.txt >> log.txt');
      const ast = buildAST(tokens);
      const cmd = ast[0] as SimpleCommand;
      expect(cmd.redirects).toHaveLength(2);
      expect(cmd.redirects[0]).toEqual({ type: 'redirect', file: 'out.txt' });
      expect(cmd.redirects[1]).toEqual({ type: 'append', file: 'log.txt' });
    });

    it('should throw on redirect without filename', () => {
      const tokens = tokenize('echo hello >');
      expect(() => buildAST(tokens)).toThrow('Expected filename for redirection');
    });

    it('should handle redirect with quoted filename', () => {
      const tokens = tokenize('echo hello > "my file.txt"');
      const ast = buildAST(tokens);
      const cmd = ast[0] as SimpleCommand;
      expect(cmd.redirects).toEqual([{ type: 'redirect', file: 'my file.txt' }]);
    });
  });

  describe('pipelines', () => {
    it('should parse simple pipeline', () => {
      const tokens = tokenize('ls | grep test');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(1);
      expect(ast[0].type).toBe('Pipeline');
      const pipeline = ast[0] as Pipeline;
      expect(pipeline.commands).toHaveLength(2);
      expect(pipeline.commands[0].command).toBe('ls');
      expect(pipeline.commands[1].command).toBe('grep');
      expect(pipeline.commands[1].args).toEqual(['test']);
    });

    it('should parse multi-stage pipeline', () => {
      const tokens = tokenize('cat file | grep pattern | head -n 5');
      const ast = buildAST(tokens);
      const pipeline = ast[0] as Pipeline;
      expect(pipeline.commands).toHaveLength(3);
      expect(pipeline.commands[0].command).toBe('cat');
      expect(pipeline.commands[1].command).toBe('grep');
      expect(pipeline.commands[2].command).toBe('head');
    });

    it('should handle pipeline with redirects on last command', () => {
      const tokens = tokenize('cat file | grep pattern > output.txt');
      const ast = buildAST(tokens);
      const pipeline = ast[0] as Pipeline;
      expect(pipeline.commands).toHaveLength(2);
      expect(pipeline.commands[1].redirects).toEqual([
        { type: 'redirect', file: 'output.txt' }
      ]);
    });
  });

  describe('logical sequences', () => {
    it('should parse and sequence', () => {
      const tokens = tokenize('mkdir dir && cd dir');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(1);
      expect(ast[0].type).toBe('LogicalSequence');
      const seq = ast[0] as LogicalSequence;
      expect(seq.operator).toBe('and');
      expect((seq.left as SimpleCommand).command).toBe('mkdir');
      expect((seq.right as SimpleCommand).command).toBe('cd');
    });

    it('should parse or sequence', () => {
      const tokens = tokenize('test -f file || echo missing');
      const ast = buildAST(tokens);
      const seq = ast[0] as LogicalSequence;
      expect(seq.operator).toBe('or');
      expect((seq.left as SimpleCommand).command).toBe('test');
      expect((seq.right as SimpleCommand).command).toBe('echo');
    });

    it('should parse chained logical sequences left-to-right', () => {
      const tokens = tokenize('a && b && c');
      const ast = buildAST(tokens);
      const outer = ast[0] as LogicalSequence;
      expect(outer.operator).toBe('and');
      expect((outer.right as SimpleCommand).command).toBe('c');
      const inner = outer.left as LogicalSequence;
      expect(inner.operator).toBe('and');
      expect((inner.left as SimpleCommand).command).toBe('a');
      expect((inner.right as SimpleCommand).command).toBe('b');
    });

    it('should parse mixed and/or sequences', () => {
      const tokens = tokenize('a && b || c');
      const ast = buildAST(tokens);
      const seq = ast[0] as LogicalSequence;
      expect(seq.operator).toBe('or');
      const left = seq.left as LogicalSequence;
      expect(left.operator).toBe('and');
    });
  });

  describe('command sequences with semicolon', () => {
    it('should parse semicolon-separated commands', () => {
      const tokens = tokenize('echo hello; echo world');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(2);
      expect((ast[0] as SimpleCommand).command).toBe('echo');
      expect((ast[0] as SimpleCommand).args).toEqual(['hello']);
      expect((ast[1] as SimpleCommand).command).toBe('echo');
      expect((ast[1] as SimpleCommand).args).toEqual(['world']);
    });

    it('should handle trailing semicolon', () => {
      const tokens = tokenize('echo hello;');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(1);
    });

    it('should parse multiple semicolon-separated commands', () => {
      const tokens = tokenize('a; b; c; d');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(4);
    });
  });

  describe('combined constructs', () => {
    it('should parse pipeline with logical sequence', () => {
      const tokens = tokenize('cat file | grep pattern && echo found');
      const ast = buildAST(tokens);
      const seq = ast[0] as LogicalSequence;
      expect(seq.type).toBe('LogicalSequence');
      expect(seq.left.type).toBe('Pipeline');
      expect(seq.right.type).toBe('Command');
    });

    it('should parse semicolon with logical sequence', () => {
      const tokens = tokenize('echo start; mkdir dir && cd dir');
      const ast = buildAST(tokens);
      expect(ast).toHaveLength(2);
      expect(ast[0].type).toBe('Command');
      expect(ast[1].type).toBe('LogicalSequence');
    });
  });

  describe('error handling', () => {
    it('should throw on unexpected token', () => {
      // Create malformed token array
      const tokens: Token[] = [
        { type: 'word', value: 'echo' },
        { type: 'word', value: 'hello' },
        { type: 'pipe', value: '|' },
        { type: 'pipe', value: '|' }  // Unexpected second pipe without command
      ];
      expect(() => buildAST(tokens)).toThrow();
    });
  });
});

describe('expandVariables', () => {
  describe('basic variable expansion', () => {
    it('should expand simple variable', () => {
      const env = { HOME: '/home/tronos' };
      const tokens = tokenize('echo $HOME');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('/home/tronos');
    });

    it('should expand braced variable', () => {
      const env = { NAME: 'Alice' };
      const tokens = tokenize('echo ${NAME}');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('Alice');
    });

    it('should expand undefined variable to empty string', () => {
      const env = {};
      const tokens = tokenize('echo $UNDEFINED');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('');
    });

    it('should expand multiple variables', () => {
      const env = { USER: 'alice', HOME: '/home/alice' };
      const tokens = tokenize('echo $USER lives in $HOME');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('alice');
      expect(expanded[2].value).toBe('lives');
      expect(expanded[3].value).toBe('in');
      expect(expanded[4].value).toBe('/home/alice');
    });

    it('should expand variable in middle of word', () => {
      const env = { NAME: 'test' };
      const tokens = tokenize('echo prefix_${NAME}_suffix');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('prefix_test_suffix');
    });
  });

  describe('variable expansion in strings', () => {
    it('should expand variable in double-quoted string', () => {
      const env = { NAME: 'world' };
      const tokens = tokenize('echo "hello $NAME"');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('hello world');
    });

    it('should NOT expand variable in single-quoted string', () => {
      const env = { NAME: 'world' };
      const tokens = tokenize("echo 'hello $NAME'");
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('hello $NAME');
    });
  });

  describe('edge cases', () => {
    it('should handle empty braced variable', () => {
      const env = { '': 'empty' };
      const tokens = tokenize('echo ${}');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('empty');
    });

    it('should handle variable with underscore', () => {
      const env = { MY_VAR: 'value' };
      const tokens = tokenize('echo $MY_VAR');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('value');
    });

    it('should handle variable with numbers', () => {
      const env = { VAR123: 'numbered' };
      const tokens = tokenize('echo $VAR123');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('numbered');
    });

    it('should stop at non-alphanumeric', () => {
      const env = { NAME: 'test' };
      const tokens = tokenize('echo $NAME:suffix');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('test:suffix');
    });

    it('should throw on unterminated braced variable', () => {
      const env = { NAME: 'test' };
      const tokens: Token[] = [{ type: 'word', value: '${NAME' }];
      expect(() => expandVariables(tokens, env)).toThrow('Unterminated variable expansion');
    });

    it('should handle multiple braced variables', () => {
      const env = { A: 'one', B: 'two' };
      const tokens = tokenize('echo ${A}/${B}');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('one/two');
    });

    it('should preserve operators', () => {
      const env = { VAR: 'test' };
      const tokens = tokenize('echo $VAR | cat');
      const expanded = expandVariables(tokens, env);
      expect(expanded[1].value).toBe('test');
      expect(expanded[2].type).toBe('pipe');
    });
  });
});
