import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSystemPrompt,
  buildUserMessage,
  getTerminalAPIReference,
  getExecutableFormatSpec,
  type PromptContext
} from '../src/engine/ai/prompts';
import { InMemoryVFS } from '../src/vfs/memory';

describe('AI Prompts', () => {
  let vfs: InMemoryVFS;
  let context: PromptContext;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test');
    await vfs.init();
    context = {
      cwd: '/home/tronos',
      env: {
        USER: 'tronos',
        HOME: '/home/tronos',
        PATH: '/bin'
      },
      vfs
    };
  });

  describe('buildSystemPrompt', () => {
    it('should build a create mode prompt', () => {
      const prompt = buildSystemPrompt('create', context);

      expect(prompt).toContain('generates TronOS executable programs');
      // Now uses comprehensive AI context with numbered sections
      expect(prompt).toContain('## 2. Executable Format');
      expect(prompt).toContain('## 1. Terminal API');
      expect(prompt).toContain('## Current Environment');
      expect(prompt).toContain('Working directory: /home/tronos');
    });

    it('should build an edit mode prompt', () => {
      context.fileContent = '// @name: test\nasync function main(t) {}';
      context.targetFile = '/home/tronos/test.trx';

      const prompt = buildSystemPrompt('edit', context);

      expect(prompt).toContain('modifies TronOS executable programs');
      expect(prompt).toContain('## Current File Content');
      expect(prompt).toContain('test.trx');
      expect(prompt).toContain('// @name: test');
    });

    it('should build an explain mode prompt', () => {
      context.fileContent = '// @name: test\nasync function main(t) { t.writeln("hello"); }';
      context.targetFile = '/home/tronos/test.trx';

      const prompt = buildSystemPrompt('explain', context);

      expect(prompt).toContain('explains TronOS executable programs');
      expect(prompt).toContain('## File Content');
      expect(prompt).toContain('t.writeln');
    });

    it('should build a fix mode prompt', () => {
      context.fileContent = 'async function main(t) { t.writ("hello"); }';
      context.targetFile = '/home/tronos/broken.trx';
      context.errorContext = 't.writ is not a function';

      const prompt = buildSystemPrompt('fix', context);

      expect(prompt).toContain('diagnoses and fixes issues');
      expect(prompt).toContain('## Error Context');
      expect(prompt).toContain('t.writ is not a function');
    });

    it('should build a chat mode prompt', () => {
      const prompt = buildSystemPrompt('chat', context);

      expect(prompt).toContain('AI assistant for TronOS');
      expect(prompt).toContain('browser-based operating system');
      expect(prompt).toContain('## About TronOS');
      expect(prompt).toContain('## Your Role');
    });

    it('should include environment info in context', () => {
      const prompt = buildSystemPrompt('chat', context);

      // The context uses 'tronos' as the user (from test context setup)
      expect(prompt).toContain('USER: tronos');
      expect(prompt).toContain('HOME: /home/tronos');
      expect(prompt).toContain('PATH: /bin');
    });

    it('should list files in cwd when VFS is provided', () => {
      vfs.write('/home/tronos/hello.trx', '// @name: hello');
      vfs.write('/home/tronos/readme.txt', 'Hello world');

      const prompt = buildSystemPrompt('create', context);

      expect(prompt).toContain('hello.trx');
    });
  });

  describe('buildUserMessage', () => {
    it('should build create message with program name', () => {
      const message = buildUserMessage('create', 'make a calculator', 'calc');

      expect(message).toContain('Create an executable program named "calc"');
      expect(message).toContain('make a calculator');
    });

    it('should build create message without program name', () => {
      const message = buildUserMessage('create', 'make a calculator', null);

      expect(message).toContain('Create an executable program');
      expect(message).toContain('make a calculator');
    });

    it('should build edit message', () => {
      const message = buildUserMessage('edit', 'add color to output');

      expect(message).toContain('Edit this file');
      expect(message).toContain('add color to output');
    });

    it('should build explain message with default', () => {
      const message = buildUserMessage('explain', '');

      expect(message).toBe('Explain this code.');
    });

    it('should build explain message with custom prompt', () => {
      const message = buildUserMessage('explain', 'focus on the loop');

      expect(message).toBe('focus on the loop');
    });

    it('should build fix message with default', () => {
      const message = buildUserMessage('fix', '');

      expect(message).toContain('Find and fix any issues');
    });

    it('should build fix message with custom prompt', () => {
      const message = buildUserMessage('fix', 'the loop never terminates');

      expect(message).toBe('the loop never terminates');
    });

    it('should build chat message', () => {
      const message = buildUserMessage('chat', 'how do I read a file?');

      expect(message).toBe('how do I read a file?');
    });
  });

  describe('getTerminalAPIReference', () => {
    it('should return terminal API documentation', () => {
      const reference = getTerminalAPIReference();

      expect(reference).toContain('## Terminal API Reference');
      expect(reference).toContain('t.write(text)');
      expect(reference).toContain('t.writeln(text)');
      expect(reference).toContain('await t.readLine');
      expect(reference).toContain('await t.readKey');
      expect(reference).toContain('t.fs.read');
      expect(reference).toContain('t.fs.write');
      expect(reference).toContain('t.exit');
      expect(reference).toContain('t.sleep');
      expect(reference).toContain('t.args');
    });

    it('should include ANSI styling reference', () => {
      const reference = getTerminalAPIReference();

      // Updated to check for new Styling Helpers section
      expect(reference).toContain('Styling Helpers');
      expect(reference).toContain('t.style.bold');
      expect(reference).toContain('t.style.red');
    });
  });

  describe('getExecutableFormatSpec', () => {
    it('should return executable format documentation', () => {
      const spec = getExecutableFormatSpec();

      expect(spec).toContain('## Executable Format (.trx)');
      expect(spec).toContain('@name');
      expect(spec).toContain('@description');
      expect(spec).toContain('@version');
      expect(spec).toContain('@author');
      expect(spec).toContain('async function main(t)');
    });

    it('should include code examples', () => {
      const spec = getExecutableFormatSpec();

      expect(spec).toContain('Interactive Greeting');
      expect(spec).toContain('File Reader');
      expect(spec).toContain('Countdown Timer');
    });
  });
});
