import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AIBridge, createAIBridge } from '../src/engine/ai/bridge';
import type { AIResponse } from '../src/engine/ai/bridge';
import type { AIConfig } from '../src/stores/ai';
import type { PromptContext } from '../src/engine/ai/prompts';

describe('AIBridge', () => {
  const mockConfig: AIConfig = {
    provider: 'anthropic',
    apiKey: 'test-api-key-12345678',
    model: 'claude-sonnet-4-6',
    baseURL: 'https://api.anthropic.com',
    temperature: 0.7,
    maxTokens: 4096
  };

  const mockContext: PromptContext = {
    cwd: '/home/tronos',
    env: { USER: 'testuser', HOME: '/home/tronos' }
  };

  describe('buildMessages', () => {
    it('should build messages for chat mode', () => {
      const bridge = new AIBridge(mockConfig);
      const result = bridge.buildMessages('chat', 'Hello, how are you?', mockContext);

      expect(result.systemPrompt).toContain('TronOS');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello, how are you?');
    });

    it('should build messages for create mode with program name', () => {
      const bridge = new AIBridge(mockConfig);
      const result = bridge.buildMessages('create', 'A countdown timer', mockContext, 'countdown');

      expect(result.systemPrompt).toContain('Terminal API');
      expect(result.systemPrompt).toContain('Executable Format');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('countdown');
      expect(result.messages[0].content).toContain('countdown timer');
    });

    it('should build messages for edit mode with file content', () => {
      const contextWithFile: PromptContext = {
        ...mockContext,
        targetFile: 'test.trx',
        fileContent: '// @name: test\nasync function main(t) {}'
      };

      const bridge = new AIBridge(mockConfig);
      const result = bridge.buildMessages('edit', 'Add error handling', contextWithFile);

      expect(result.systemPrompt).toContain('test.trx');
      expect(result.systemPrompt).toContain('// @name: test');
      expect(result.messages[0].content).toContain('Add error handling');
    });

    it('should build messages for explain mode', () => {
      const contextWithFile: PromptContext = {
        ...mockContext,
        targetFile: 'helper.trx',
        fileContent: 'async function main(t) { t.writeln("hi"); }'
      };

      const bridge = new AIBridge(mockConfig);
      const result = bridge.buildMessages('explain', 'What does this do?', contextWithFile);

      expect(result.systemPrompt).toContain('explain');
      expect(result.messages[0].content).toBe('What does this do?');
    });

    it('should build messages for fix mode with error context', () => {
      const contextWithError: PromptContext = {
        ...mockContext,
        targetFile: 'broken.trx',
        fileContent: 'async function main(t { t.writeln("hi"); }',
        errorContext: 'SyntaxError: Unexpected token'
      };

      const bridge = new AIBridge(mockConfig);
      const result = bridge.buildMessages('fix', 'Fix the syntax error', contextWithError);

      expect(result.systemPrompt).toContain('SyntaxError');
      expect(result.systemPrompt).toContain('broken.trx');
    });
  });

  describe('parseCode', () => {
    it('should extract code from javascript code blocks', () => {
      const bridge = new AIBridge(mockConfig);
      const response = '```javascript\n// @name: test\nasync function main(t) {}\n```';

      expect(bridge.parseCode(response)).toBe('// @name: test\nasync function main(t) {}');
    });

    it('should extract code from js code blocks', () => {
      const bridge = new AIBridge(mockConfig);
      const response = '```js\nasync function main(t) { t.writeln("hi"); }\n```';

      expect(bridge.parseCode(response)).toBe('async function main(t) { t.writeln("hi"); }');
    });

    it('should extract code from plain code blocks', () => {
      const bridge = new AIBridge(mockConfig);
      const response = '```\n// code here\n```';

      expect(bridge.parseCode(response)).toBe('// code here');
    });

    it('should handle responses starting with comments', () => {
      const bridge = new AIBridge(mockConfig);
      const response = '// @name: test\n// @description: A test\nasync function main(t) {}';

      expect(bridge.parseCode(response)).toBe(response.trim());
    });

    it('should handle responses starting with async function', () => {
      const bridge = new AIBridge(mockConfig);
      const response = 'async function main(t) {\n  t.writeln("hello");\n}';

      expect(bridge.parseCode(response)).toBe(response.trim());
    });

    it('should extract code from <code> tags', () => {
      const bridge = new AIBridge(mockConfig);
      const response = `<explanation>Fixed the bug</explanation>
<code>
// @name: fixed
async function main(t) {}
</code>`;

      expect(bridge.parseCode(response)).toBe('// @name: fixed\nasync function main(t) {}');
    });

    it('should return plain text as-is for non-code responses', () => {
      const bridge = new AIBridge(mockConfig);
      const response = 'This is just a text explanation about TronOS.';

      expect(bridge.parseCode(response)).toBe(response);
    });
  });

  describe('parseFixExplanation', () => {
    it('should extract explanation from fix mode response', () => {
      const bridge = new AIBridge(mockConfig);
      const response = `<explanation>
The syntax error was caused by a missing parenthesis.
</explanation>
<code>// fixed code</code>`;

      expect(bridge.parseFixExplanation(response)).toBe('The syntax error was caused by a missing parenthesis.');
    });

    it('should return null if no explanation tag', () => {
      const bridge = new AIBridge(mockConfig);
      const response = 'Just some code without explanation tags';

      expect(bridge.parseFixExplanation(response)).toBeNull();
    });
  });

  describe('setConfig', () => {
    it('should update the configuration', () => {
      const bridge = new AIBridge(mockConfig);
      const newConfig: AIConfig = {
        ...mockConfig,
        model: 'gpt-4o',
        provider: 'openai'
      };

      bridge.setConfig(newConfig);

      // Execute should now reject because openai is not yet supported
      // This is a way to verify config was updated
    });
  });

  describe('createAIBridge', () => {
    it('should create an AIBridge instance', () => {
      const bridge = createAIBridge(mockConfig);

      expect(bridge).toBeInstanceOf(AIBridge);
    });
  });

  describe('execute', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should return error when API key is not configured', async () => {
      const configNoKey = { ...mockConfig, apiKey: '' };
      const bridge = new AIBridge(configNoKey);

      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key not configured');
    });

it('should call OpenAI API with correct headers and format', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: string = '';

      const mockFetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = options.headers as Record<string, string>;
        capturedBody = options.body as string;
        return {
          ok: true,
          json: async () => ({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1234567890,
            model: 'gpt-4o',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Hello from OpenAI!' },
              finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
          })
        };
      });
      globalThis.fetch = mockFetch;

      const openaiConfig = {
        ...mockConfig,
        provider: 'openai' as const,
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o'
      };
      const bridge = new AIBridge(openaiConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions');
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${mockConfig.apiKey}`);
      expect(capturedHeaders['Content-Type']).toBe('application/json');

      const body = JSON.parse(capturedBody);
      expect(body.model).toBe('gpt-4o');
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toBe('Hello');

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello from OpenAI!');
      expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 25 });
    });

    it('should call OpenRouter API with correct headers', async () => {
      let capturedHeaders: Record<string, string> = {};

      const mockFetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
        capturedHeaders = options.headers as Record<string, string>;
        return {
          ok: true,
          json: async () => ({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            model: 'anthropic/claude-sonnet-4-6',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }]
          })
        };
      });
      globalThis.fetch = mockFetch;

      const openrouterConfig = {
        ...mockConfig,
        provider: 'openrouter' as const,
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-sonnet-4-6'
      };
      const bridge = new AIBridge(openrouterConfig);
      await bridge.execute('chat', 'Hello', mockContext);

      expect(capturedHeaders['Authorization']).toBe(`Bearer ${mockConfig.apiKey}`);
      expect(capturedHeaders['HTTP-Referer']).toBe('https://tronos.dev');
      expect(capturedHeaders['X-Title']).toBe('TronOS Terminal');
    });

    it('should call Ollama API without requiring API key', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      // Ollama returns { message: { content: '...' } } format
      const mockFetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = options.headers as Record<string, string>;
        return {
          ok: true,
          json: async () => ({
            model: 'llama3.2',
            created_at: '2024-01-01T00:00:00Z',
            message: { role: 'assistant', content: 'Hello from Ollama!' },
            done: true,
            prompt_eval_count: 50,
            eval_count: 25
          })
        };
      });
      globalThis.fetch = mockFetch;

      const ollamaConfig = {
        ...mockConfig,
        provider: 'ollama' as const,
        apiKey: '', // No API key required for Ollama
        baseURL: 'http://localhost:11434',
        model: 'llama3.2'
      };
      const bridge = new AIBridge(ollamaConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(capturedUrl).toBe('http://localhost:11434/api/chat');
      expect(capturedHeaders['Authorization']).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello from Ollama!');
      expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 25 });
    });

    it('should handle Ollama response without usage info', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          created_at: '2024-01-01T00:00:00Z',
          message: { role: 'assistant', content: 'Response without usage' },
          done: true
          // No prompt_eval_count or eval_count
        })
      });
      globalThis.fetch = mockFetch;

      const ollamaConfig = {
        ...mockConfig,
        provider: 'ollama' as const,
        apiKey: '',
        baseURL: 'http://localhost:11434',
        model: 'llama3.2'
      };
      const bridge = new AIBridge(ollamaConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Response without usage');
      expect(result.usage).toBeUndefined();
    });

    it('should call TronOS API without requiring API key', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      // TronOS returns OpenAI-compatible format
      const mockFetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = options.headers as Record<string, string>;
        return {
          ok: true,
          json: async () => ({
            id: 'tronos-123',
            object: 'chat.completion',
            model: 'claude-3-haiku',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Hello from TronOS!' },
              finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }
          })
        };
      });
      globalThis.fetch = mockFetch;

      const tronosConfig = {
        ...mockConfig,
        provider: 'tronos' as const,
        apiKey: '', // No API key required for TronOS
        baseURL: 'https://tronos.dev/api/ai',
        model: 'claude-3-haiku'
      };
      const bridge = new AIBridge(tronosConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(capturedUrl).toBe('https://tronos.dev/api/ai/chat');
      expect(capturedHeaders['Authorization']).toBeUndefined();
      expect(capturedHeaders['X-TronOS-Client']).toBe('TronOS Terminal');
      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello from TronOS!');
      expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 15 });
    });

    it('should handle OpenAI API error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          error: {
            message: 'Invalid API key',
            type: 'invalid_request_error',
            code: 'invalid_api_key'
          }
        })
      });
      globalThis.fetch = mockFetch;

      const openaiConfig = { ...mockConfig, provider: 'openai' as const };
      const bridge = new AIBridge(openaiConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid API key');
    });

    it('should handle OpenAI response without usage info', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }]
          // No usage field
        })
      });
      globalThis.fetch = mockFetch;

      const openaiConfig = { ...mockConfig, provider: 'openai' as const };
      const bridge = new AIBridge(openaiConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Response');
      expect(result.usage).toBeUndefined();
    });

    it('should return error when OpenAI API key is not configured', async () => {
      const configNoKey = { ...mockConfig, apiKey: '', provider: 'openai' as const };
      const bridge = new AIBridge(configNoKey);

      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key not configured');
    });

    it('should return error when OpenRouter API key is not configured', async () => {
      const configNoKey = { ...mockConfig, apiKey: '', provider: 'openrouter' as const };
      const bridge = new AIBridge(configNoKey);

      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key not configured');
    });

    it('should handle network errors for OpenAI-compatible APIs', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      globalThis.fetch = mockFetch;

      const openaiConfig = { ...mockConfig, provider: 'openai' as const };
      const bridge = new AIBridge(openaiConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('Connection refused');
    });

    it('should call Anthropic API with correct headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! I am Claude.' }],
          model: 'claude-sonnet-4-6',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      });
      globalThis.fetch = mockFetch;

      const bridge = new AIBridge(mockConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-key': 'test-api-key-12345678',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          })
        })
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello! I am Claude.');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('should include system prompt and messages in request body', async () => {
      let capturedBody: string = '';
      const mockFetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
        capturedBody = options.body as string;
        return {
          ok: true,
          json: async () => ({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 50, output_tokens: 25 }
          })
        };
      });
      globalThis.fetch = mockFetch;

      const bridge = new AIBridge(mockConfig);
      await bridge.execute('chat', 'What is TronOS?', mockContext);

      const body = JSON.parse(capturedBody);
      expect(body.model).toBe('claude-sonnet-4-6');
      expect(body.max_tokens).toBe(4096);
      expect(body.temperature).toBe(0.7);
      expect(body.system).toContain('TronOS');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toBe('What is TronOS?');
    });

    it('should handle API error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'Invalid API key'
          }
        })
      });
      globalThis.fetch = mockFetch;

      const bridge = new AIBridge(mockConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid API key');
    });

    it('should handle network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network unavailable'));
      globalThis.fetch = mockFetch;

      const bridge = new AIBridge(mockConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('Network unavailable');
    });

    it('should handle API response without error message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({})
      });
      globalThis.fetch = mockFetch;

      const bridge = new AIBridge(mockConfig);
      const result = await bridge.execute('chat', 'Hello', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });
  });

  describe('parseResponse', () => {
    describe('error handling', () => {
      it('should return error for failed API response', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: false,
          content: '',
          error: 'API rate limit exceeded'
        };

        const result = bridge.parseResponse(response, 'chat');

        expect(result.success).toBe(false);
        expect(result.code).toBeNull();
        expect(result.message).toBeNull();
        expect(result.error).toBe('API rate limit exceeded');
      });

      it('should return error for empty response', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: ''
        };

        const result = bridge.parseResponse(response, 'chat');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Empty response from AI');
      });

      it('should return error for whitespace-only response', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '   \n\t  '
        };

        const result = bridge.parseResponse(response, 'chat');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Empty response from AI');
      });
    });

    describe('chat mode', () => {
      it('should return content as message', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: 'TronOS is an AI-powered operating system in your browser.'
        };

        const result = bridge.parseResponse(response, 'chat');

        expect(result.success).toBe(true);
        expect(result.code).toBeNull();
        expect(result.message).toBe('TronOS is an AI-powered operating system in your browser.');
      });

      it('should trim whitespace from message', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '\n  Hello world!  \n'
        };

        const result = bridge.parseResponse(response, 'chat');

        expect(result.success).toBe(true);
        expect(result.message).toBe('Hello world!');
      });
    });

    describe('explain mode', () => {
      it('should return content as message', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: 'This function counts down from 10 to 0 with a 1-second delay.'
        };

        const result = bridge.parseResponse(response, 'explain');

        expect(result.success).toBe(true);
        expect(result.code).toBeNull();
        expect(result.message).toBe('This function counts down from 10 to 0 with a 1-second delay.');
      });
    });

    describe('create mode', () => {
      it('should extract code from javascript code block', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: 'Here is your program:\n\n```javascript\n// @name: hello\nasync function main(t) {\n  t.writeln("Hello!");\n}\n```'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// @name: hello\nasync function main(t) {\n  t.writeln("Hello!");\n}');
        expect(result.message).toBeNull();
      });

      it('should extract code from js code block', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '```js\nasync function main(t) {}\n```'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('async function main(t) {}');
      });

      it('should extract code from plain code block', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '```\n// code here\n```'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// code here');
      });

      it('should handle shebang-starting response', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '#!/usr/bin/env node\n// @name: script\nasync function main(t) {}'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('#!/usr/bin/env node\n// @name: script\nasync function main(t) {}');
      });

      it('should handle metadata comment-starting response', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '// @name: countdown\n// @description: A countdown timer\nasync function main(t) {}'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// @name: countdown\n// @description: A countdown timer\nasync function main(t) {}');
      });

      it('should handle async function starting response', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: 'async function main(t) {\n  t.writeln("test");\n}'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('async function main(t) {\n  t.writeln("test");\n}');
      });
    });

    describe('edit mode', () => {
      it('should extract code from code block', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: 'Here is the updated code:\n\n```javascript\n// @name: updated\nasync function main(t) {\n  t.writeln("Updated!");\n}\n```'
        };

        const result = bridge.parseResponse(response, 'edit');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// @name: updated\nasync function main(t) {\n  t.writeln("Updated!");\n}');
        expect(result.message).toBeNull();
      });
    });

    describe('fix mode', () => {
      it('should extract both code and explanation', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '<explanation>The syntax error was caused by a missing parenthesis.</explanation>\n<code>// @name: fixed\nasync function main(t) {}</code>'
        };

        const result = bridge.parseResponse(response, 'fix');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// @name: fixed\nasync function main(t) {}');
        expect(result.message).toBe('The syntax error was caused by a missing parenthesis.');
      });

      it('should handle fix response with only code', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '```javascript\n// @name: fixed\nasync function main(t) {}\n```'
        };

        const result = bridge.parseResponse(response, 'fix');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// @name: fixed\nasync function main(t) {}');
        expect(result.message).toBeNull();
      });

      it('should extract code from <code> tags', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '<code>\n// @name: fixed\nasync function main(t) { t.writeln("fixed"); }\n</code>'
        };

        const result = bridge.parseResponse(response, 'fix');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// @name: fixed\nasync function main(t) { t.writeln("fixed"); }');
      });
    });

    describe('edge cases', () => {
      it('should handle response with multiple code blocks (uses first)', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '```javascript\n// first\n```\n\n```javascript\n// second\n```'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('// first');
      });

      it('should handle typescript code blocks', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '```typescript\nasync function main(t: TerminalAPI) {}\n```'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('async function main(t: TerminalAPI) {}');
      });

      it('should handle ts code blocks', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: '```ts\nasync function main(t: TerminalAPI) {}\n```'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('async function main(t: TerminalAPI) {}');
      });

      it('should handle regular function declarations', () => {
        const bridge = new AIBridge(mockConfig);
        const response: AIResponse = {
          success: true,
          content: 'function helper() {\n  return 42;\n}'
        };

        const result = bridge.parseResponse(response, 'create');

        expect(result.success).toBe(true);
        expect(result.code).toBe('function helper() {\n  return 42;\n}');
      });
    });
  });
});
