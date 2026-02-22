import { describe, it, expect } from 'vitest';
import {
  parseAICommand,
  isAICommand,
  getAICommandPrefix,
  validateAICommand,
  type AICommand
} from '../src/engine/ai/parser';

describe('AI Command Parser', () => {
  describe('parseAICommand', () => {
    describe('chat mode (default)', () => {
      it('parses a simple question as chat mode', () => {
        const result = parseAICommand('@ai what is a variable?');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('chat');
        expect(result!.prompt).toBe('what is a variable?');
        expect(result!.targetFile).toBeNull();
        expect(result!.programName).toBeNull();
      });

      it('parses multi-word questions as chat mode', () => {
        const result = parseAICommand('@ai how do I write a function that adds two numbers?');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('chat');
        expect(result!.prompt).toBe('how do I write a function that adds two numbers?');
      });

      it('handles commands with extra whitespace', () => {
        const result = parseAICommand('@ai   how do I do this?  ');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('chat');
        expect(result!.prompt).toBe('how do I do this?');
      });
    });

    describe('create mode', () => {
      it('parses create command with name and description', () => {
        const result = parseAICommand('@ai create countdown a timer that counts down from 10');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
        expect(result!.programName).toBe('countdown');
        expect(result!.prompt).toBe('a timer that counts down from 10');
        expect(result!.targetFile).toBeNull();
      });

      it('parses create command with quoted description', () => {
        const result = parseAICommand('@ai create hello "print hello world"');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
        expect(result!.programName).toBe('hello');
        expect(result!.prompt).toBe('print hello world');
      });

      it('handles create command without description', () => {
        const result = parseAICommand('@ai create myprogram');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
        expect(result!.programName).toBe('myprogram');
        expect(result!.prompt).toBe('Create a program called myprogram');
      });

      it('handles create command without name', () => {
        const result = parseAICommand('@ai create');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
        expect(result!.programName).toBeNull();
        expect(result!.prompt).toBe('');
      });
    });

    describe('edit mode', () => {
      it('parses edit command with file and instructions', () => {
        const result = parseAICommand('@ai edit myfile.trx add error handling');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('edit');
        expect(result!.targetFile).toBe('myfile.trx');
        expect(result!.prompt).toBe('add error handling');
        expect(result!.programName).toBeNull();
      });

      it('parses edit command with path', () => {
        const result = parseAICommand('@ai edit /bin/test.trx make it faster');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('edit');
        expect(result!.targetFile).toBe('/bin/test.trx');
        expect(result!.prompt).toBe('make it faster');
      });

      it('handles edit command without instructions', () => {
        const result = parseAICommand('@ai edit myfile.trx');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('edit');
        expect(result!.targetFile).toBe('myfile.trx');
        expect(result!.prompt).toBe('Edit myfile.trx');
      });

      it('handles edit command without file', () => {
        const result = parseAICommand('@ai edit');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('edit');
        expect(result!.targetFile).toBeNull();
      });
    });

    describe('explain mode', () => {
      it('parses explain command with file', () => {
        const result = parseAICommand('@ai explain myfile.trx');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('explain');
        expect(result!.targetFile).toBe('myfile.trx');
        expect(result!.prompt).toBe('Explain the code in myfile.trx');
      });

      it('parses explain command with custom prompt', () => {
        const result = parseAICommand('@ai explain myfile.trx what does the main loop do?');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('explain');
        expect(result!.targetFile).toBe('myfile.trx');
        expect(result!.prompt).toBe('what does the main loop do?');
      });

      it('handles explain command without file', () => {
        const result = parseAICommand('@ai explain');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('explain');
        expect(result!.targetFile).toBeNull();
      });
    });

    describe('fix mode', () => {
      it('parses fix command with file', () => {
        const result = parseAICommand('@ai fix myfile.trx');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('fix');
        expect(result!.targetFile).toBe('myfile.trx');
        expect(result!.prompt).toBe('Find and fix issues in myfile.trx');
      });

      it('parses fix command with error context', () => {
        const result = parseAICommand('@ai fix myfile.trx TypeError: undefined is not a function');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('fix');
        expect(result!.targetFile).toBe('myfile.trx');
        expect(result!.prompt).toBe('TypeError: undefined is not a function');
      });

      it('handles fix command without file', () => {
        const result = parseAICommand('@ai fix');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('fix');
        expect(result!.targetFile).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('returns null for empty @ai command', () => {
        const result = parseAICommand('@ai');
        expect(result).toBeNull();
      });

      it('returns null for whitespace-only after @ai', () => {
        const result = parseAICommand('@ai   ');
        expect(result).toBeNull();
      });

      it('returns null for non-@ai commands', () => {
        const result = parseAICommand('ls -la');
        expect(result).toBeNull();
      });

      it('handles case insensitivity for mode keywords', () => {
        const result = parseAICommand('@ai CREATE myprogram test');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
      });

      it('preserves original command in rawCommand', () => {
        const original = '@ai create test hello world';
        const result = parseAICommand(original);
        expect(result).not.toBeNull();
        expect(result!.rawCommand).toBe(original);
      });
    });

    describe('quoted strings', () => {
      it('handles single-quoted strings in prompts', () => {
        const result = parseAICommand("@ai create hello 'print hello world'");
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
        expect(result!.prompt).toBe('print hello world');
      });

      it('handles double-quoted strings in prompts', () => {
        const result = parseAICommand('@ai create hello "print hello world"');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
        expect(result!.prompt).toBe('print hello world');
      });

      it('handles mixed quoted and unquoted content', () => {
        const result = parseAICommand('@ai create test "make it" print things');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('create');
        expect(result!.prompt).toBe('make it print things');
      });
    });
  });

  describe('isAICommand', () => {
    it('returns true for @ai commands', () => {
      expect(isAICommand('@ai hello')).toBe(true);
      expect(isAICommand('@ai create test')).toBe(true);
    });

    it('returns true for @ commands', () => {
      expect(isAICommand('@ask something')).toBe(true);
      expect(isAICommand('@ test')).toBe(true);
    });

    it('returns false for regular commands', () => {
      expect(isAICommand('ls -la')).toBe(false);
      expect(isAICommand('echo hello')).toBe(false);
    });

    it('handles whitespace', () => {
      expect(isAICommand('  @ai hello  ')).toBe(true);
    });
  });

  describe('getAICommandPrefix', () => {
    it('returns @ai for @ai commands', () => {
      expect(getAICommandPrefix('@ai hello')).toBe('@ai');
    });

    it('returns custom prefix for other @ commands', () => {
      expect(getAICommandPrefix('@ask something')).toBe('@ask');
    });

    it('returns @ for bare @ commands', () => {
      expect(getAICommandPrefix('@ test')).toBe('@');
    });
  });

  describe('validateAICommand', () => {
    it('validates chat mode commands', () => {
      const cmd: AICommand = {
        mode: 'chat',
        targetFile: null,
        programName: null,
        prompt: 'hello',
        rawCommand: '@ai hello'
      };
      expect(validateAICommand(cmd).valid).toBe(true);
    });

    it('rejects edit mode without target file', () => {
      const cmd: AICommand = {
        mode: 'edit',
        targetFile: null,
        programName: null,
        prompt: 'do something',
        rawCommand: '@ai edit'
      };
      const result = validateAICommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires a target file');
    });

    it('rejects explain mode without target file', () => {
      const cmd: AICommand = {
        mode: 'explain',
        targetFile: null,
        programName: null,
        prompt: '',
        rawCommand: '@ai explain'
      };
      const result = validateAICommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires a target file');
    });

    it('rejects fix mode without target file', () => {
      const cmd: AICommand = {
        mode: 'fix',
        targetFile: null,
        programName: null,
        prompt: '',
        rawCommand: '@ai fix'
      };
      const result = validateAICommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires a target file');
    });

    it('rejects create mode without program name', () => {
      const cmd: AICommand = {
        mode: 'create',
        targetFile: null,
        programName: null,
        prompt: 'make something',
        rawCommand: '@ai create'
      };
      const result = validateAICommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires a program name');
    });

    it('rejects edit mode without instructions', () => {
      const cmd: AICommand = {
        mode: 'edit',
        targetFile: 'file.trx',
        programName: null,
        prompt: '',
        rawCommand: '@ai edit file.trx'
      };
      const result = validateAICommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires instructions');
    });

    it('validates complete edit command', () => {
      const cmd: AICommand = {
        mode: 'edit',
        targetFile: 'file.trx',
        programName: null,
        prompt: 'add error handling',
        rawCommand: '@ai edit file.trx add error handling'
      };
      expect(validateAICommand(cmd).valid).toBe(true);
    });

    it('validates complete create command', () => {
      const cmd: AICommand = {
        mode: 'create',
        targetFile: null,
        programName: 'test',
        prompt: 'a test program',
        rawCommand: '@ai create test a test program'
      };
      expect(validateAICommand(cmd).valid).toBe(true);
    });

    it('validates explain with target file', () => {
      const cmd: AICommand = {
        mode: 'explain',
        targetFile: 'file.trx',
        programName: null,
        prompt: 'Explain the code in file.trx',
        rawCommand: '@ai explain file.trx'
      };
      expect(validateAICommand(cmd).valid).toBe(true);
    });

    it('validates fix with target file', () => {
      const cmd: AICommand = {
        mode: 'fix',
        targetFile: 'file.trx',
        programName: null,
        prompt: 'Find and fix issues in file.trx',
        rawCommand: '@ai fix file.trx'
      };
      expect(validateAICommand(cmd).valid).toBe(true);
    });
  });
});
