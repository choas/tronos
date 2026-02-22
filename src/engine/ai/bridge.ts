/**
 * @fileoverview AI Bridge - Multi-provider LLM API communication.
 *
 * The AIBridge class provides a unified interface for communicating with
 * various Large Language Model (LLM) APIs:
 *
 * Supported providers:
 * - **TronOS**: Built-in provider (no API key required) using https://tronos.dev/api/ai
 * - **Anthropic Claude**: Primary provider using the Messages API
 * - **OpenAI**: Uses the Chat Completions API
 * - **Ollama**: Local LLM server with OpenAI-compatible API
 * - **OpenRouter**: Unified API for multiple model providers
 *
 * Features:
 * - Automatic system prompt generation based on AI mode
 * - Code extraction from markdown and various formats
 * - Error handling and response parsing
 * - Token usage tracking
 *
 * @module engine/ai/bridge
 *
 * @example
 * const bridge = new AIBridge(aiConfig);
 * const response = await bridge.execute('create', 'a countdown timer', context, 'timer');
 * const parsed = bridge.parseResponse(response, 'create');
 * if (parsed.success && parsed.code) {
 *   // Save the generated code
 * }
 */

import type { AIConfig } from '../../stores/ai';
import type { AIMode } from './parser';
import type { PromptContext } from './prompts';
import { buildSystemPrompt, buildUserMessage } from './prompts';

/**
 * Response from an AI API call
 */
export interface AIResponse {
  /** Whether the request was successful */
  success: boolean;
  /** The AI's response content (may be code or text) */
  content: string;
  /** Error message if success is false */
  error?: string;
  /** Usage information (tokens used) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Parsed response from AI with extracted code and message
 */
export interface ParsedResponse {
  /** Whether parsing was successful */
  success: boolean;
  /** Extracted code (for create/edit/fix modes) */
  code: string | null;
  /** Message or explanation (for chat/explain modes, or fix explanations) */
  message: string | null;
  /** Error message if parsing failed */
  error?: string;
}

/**
 * Message format for API calls
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Anthropic API message format
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Anthropic API request body
 */
interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  temperature?: number;
}

/**
 * Anthropic API response
 */
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic API error response
 */
interface AnthropicError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/**
 * OpenAI-compatible API message format
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenAI-compatible API request body
 */
interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

/**
 * OpenAI-compatible API response
 */
interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI-compatible API error response
 */
interface OpenAIError {
  error: {
    message: string;
    type?: string;
    code?: string;
  };
}

/**
 * Ollama API response format
 * Ollama uses a different response structure than OpenAI
 */
interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * AIBridge class - Unified interface for LLM API communication.
 *
 * Handles the complexities of different LLM provider APIs,
 * providing a consistent interface for:
 * - Building appropriate system prompts
 * - Making API requests with correct headers and formats
 * - Parsing responses to extract code or messages
 *
 * @example
 * const bridge = new AIBridge(config);
 *
 * // Execute a chat request
 * const response = await bridge.execute('chat', 'What is AIOS?', context);
 * console.log(response.content);
 *
 * // Execute a code generation request
 * const codeResponse = await bridge.execute('create', 'a hello world program', context, 'hello');
 * const parsed = bridge.parseResponse(codeResponse, 'create');
 * console.log(parsed.code);
 */
export class AIBridge {
  private config: AIConfig;

  /**
   * Create a new AIBridge instance.
   *
   * @param config - AI configuration with provider, API key, model, etc.
   */
  constructor(config: AIConfig) {
    this.config = config;
  }

  /**
   * Update the configuration
   */
  setConfig(config: AIConfig): void {
    this.config = config;
  }

  /**
   * Build messages array for API call
   * Includes conversation history if provided
   */
  buildMessages(
    mode: AIMode,
    prompt: string,
    context: PromptContext,
    programName?: string | null,
    conversationHistory?: Message[]
  ): { systemPrompt: string; messages: Message[] } {
    const systemPrompt = buildSystemPrompt(mode, context);
    const userMessage = buildUserMessage(mode, prompt, programName);

    // Build messages array with conversation history
    const messages: Message[] = [];

    // Include conversation history if provided
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }

    // Add the current user message
    messages.push({ role: 'user', content: userMessage });

    return {
      systemPrompt,
      messages
    };
  }

  /**
   * Call the Anthropic API
   */
  async callAnthropicAPI(
    systemPrompt: string,
    messages: Message[]
  ): Promise<AIResponse> {
    const { apiKey, model, baseURL, temperature, maxTokens } = this.config;

    if (!apiKey) {
      return {
        success: false,
        content: '',
        error: 'API key not configured. Run "config set apiKey <your-key>" to set it.'
      };
    }

    const url = `${baseURL}/v1/messages`;

    const requestBody: AnthropicRequest = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json() as AnthropicError;
        const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        return {
          success: false,
          content: '',
          error: `Anthropic API error: ${errorMessage}`
        };
      }

      const data = await response.json() as AnthropicResponse;

      // Extract text content from response
      const textContent = data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

      return {
        success: true,
        content: textContent,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        content: '',
        error: `Network error: ${errorMessage}`
      };
    }
  }

  /**
   * Call an OpenAI-compatible API (TronOS, OpenAI, Ollama, OpenRouter)
   * Uses the /chat/completions endpoint format (or /chat for TronOS and Ollama)
   */
  async callOpenAICompatibleAPI(
    systemPrompt: string,
    messages: Message[]
  ): Promise<AIResponse> {
    const { apiKey, model, baseURL, temperature, maxTokens, provider } = this.config;

    // TronOS and Ollama don't require an API key, but other providers do
    if (!apiKey && provider !== 'tronos' && provider !== 'ollama') {
      return {
        success: false,
        content: '',
        error: 'API key not configured. Run "config set apiKey <your-key>" to set it.'
      };
    }

    // Build the endpoint URL
    // For TronOS, use /chat; for Ollama, use /api/chat; for others, use /chat/completions
    let endpoint: string;
    if (provider === 'tronos') {
      endpoint = `${baseURL}/chat`;
    } else if (provider === 'ollama') {
      endpoint = `${baseURL}/api/chat`;
    } else {
      endpoint = `${baseURL}/chat/completions`;
    }

    // Build messages array with system prompt as first message
    const openAIMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))
    ];

    const requestBody: OpenAIRequest = {
      model,
      messages: openAIMessages,
      max_tokens: maxTokens,
      temperature,
      stream: false
    };

    // Serialize body once for both HMAC signing and the fetch request
    const bodyStr = JSON.stringify(requestBody);

    // Build headers based on provider
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (provider === 'tronos') {
      // TronOS doesn't require authentication - it's the built-in provider
      headers['X-TronOS-Client'] = 'TronOS Terminal';

      // HMAC request signing (if secret is configured)
      const hmacSecret = import.meta.env.VITE_TRONOS_HMAC_SECRET;
      if (hmacSecret) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const payload = `${timestamp}:${bodyStr}`;

        // Use SubtleCrypto for HMAC-SHA256 in the browser
        const encoder = new TextEncoder();
        const keyData = encoder.encode(hmacSecret);
        const key = await crypto.subtle.importKey(
          'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
        const signature = Array.from(new Uint8Array(sig))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        headers['X-TronOS-Timestamp'] = timestamp;
        headers['X-TronOS-Signature'] = signature;
      }
    } else if (provider === 'openai') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (provider === 'openrouter') {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['HTTP-Referer'] = 'https://tronos.dev';
      headers['X-Title'] = 'TronOS Terminal';
    } else if (provider === 'ollama' && apiKey) {
      // Ollama can optionally use an API key if configured
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: bodyStr
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json() as OpenAIError;
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // Use the default HTTP error message
        }
        return {
          success: false,
          content: '',
          error: `${provider} API error: ${errorMessage}`
        };
      }

      const data = await response.json();

      // Ollama returns { message: { content: '...' } }
      // OpenAI/OpenRouter return { choices: [{ message: { content } }] }
      let content: string;
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      if (provider === 'ollama' && 'message' in data && data.message?.content !== undefined) {
        // Ollama response format
        const ollamaData = data as OllamaResponse;
        content = ollamaData.message.content;

        // Ollama provides token counts in different fields
        if (ollamaData.prompt_eval_count !== undefined && ollamaData.eval_count !== undefined) {
          usage = {
            inputTokens: ollamaData.prompt_eval_count,
            outputTokens: ollamaData.eval_count
          };
        }
      } else {
        // OpenAI/OpenRouter response format
        const openAIData = data as OpenAIResponse;
        content = openAIData.choices?.[0]?.message?.content || '';

        // Build usage info if available
        if (openAIData.usage) {
          usage = {
            inputTokens: openAIData.usage.prompt_tokens,
            outputTokens: openAIData.usage.completion_tokens
          };
        }
      }

      return {
        success: true,
        content,
        usage
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let hint = '';
      if (provider === 'ollama') {
        const origin = typeof window !== 'undefined' ? window.location.origin : '*';
        hint = `\nQuit the Ollama desktop app, then run: OLLAMA_ORIGINS="${origin}" ollama serve`;
      }
      return {
        success: false,
        content: '',
        error: `Network error: ${errorMessage}${hint}`
      };
    }
  }

  /**
   * Execute an AI request - main entry point.
   *
   * Routes the request to the appropriate provider API and returns
   * the raw response. Use `parseResponse()` to extract code or messages.
   *
   * @param mode - The AI mode (create, edit, explain, fix, chat)
   * @param prompt - User's prompt or request
   * @param context - Environment context (cwd, env, vfs)
   * @param programName - For 'create' mode, the program name to generate
   * @param conversationHistory - Previous messages for context (optional)
   * @returns Promise resolving to the AI response
   */
  async execute(
    mode: AIMode,
    prompt: string,
    context: PromptContext,
    programName?: string | null,
    conversationHistory?: Message[]
  ): Promise<AIResponse> {
    const { systemPrompt, messages } = this.buildMessages(mode, prompt, context, programName, conversationHistory);

    switch (this.config.provider) {
      case 'anthropic':
        return this.callAnthropicAPI(systemPrompt, messages);
      case 'tronos':
      case 'openai':
      case 'ollama':
      case 'openrouter':
        return this.callOpenAICompatibleAPI(systemPrompt, messages);
      default:
        return {
          success: false,
          content: '',
          error: `Unknown provider: ${this.config.provider}`
        };
    }
  }

  /**
   * Parse code from AI response
   * Extracts code from markdown code blocks or returns raw content
   */
  parseCode(response: string): string {
    // Try to extract from ```javascript or ``` blocks
    const codeBlockMatch = response.match(/```(?:javascript|js|typescript|ts)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // If response starts with shebang or metadata comment, treat as raw code
    if (response.trim().startsWith('//') || response.trim().startsWith('async function')) {
      return response.trim();
    }

    // Check for <code> tags (from fix mode)
    const codeTagMatch = response.match(/<code>\s*([\s\S]*?)\s*<\/code>/);
    if (codeTagMatch) {
      return codeTagMatch[1].trim();
    }

    // Return as-is for non-code responses
    return response;
  }

  /**
   * Parse explanation from fix mode response
   */
  parseFixExplanation(response: string): string | null {
    const explanationMatch = response.match(/<explanation>\s*([\s\S]*?)\s*<\/explanation>/);
    return explanationMatch ? explanationMatch[1].trim() : null;
  }

  /**
   * Check if content looks like executable code
   * Detects shebang lines, metadata comments, and async function declarations
   */
  private isCodeLike(content: string): boolean {
    const trimmed = content.trim();

    // Check for shebang (#!/...)
    if (trimmed.startsWith('#!')) {
      return true;
    }

    // Check for metadata comments (// @name:, // @description:, etc.)
    if (/^\/\/\s*@\w+:/.test(trimmed)) {
      return true;
    }

    // Check for regular comments followed by code patterns
    if (trimmed.startsWith('//') && trimmed.includes('async function')) {
      return true;
    }

    // Check for async function declaration
    if (trimmed.startsWith('async function')) {
      return true;
    }

    // Check for function declaration
    if (trimmed.startsWith('function ')) {
      return true;
    }

    return false;
  }

  /**
   * Parse AI response and extract code or message based on mode
   *
   * For code-generating modes (create, edit, fix):
   * - Extracts code from markdown code blocks (```javascript, ```js, ```)
   * - Handles shebang-starting responses (#!/...)
   * - Handles responses starting with metadata comments (// @name:)
   * - For fix mode, also extracts explanation if present
   *
   * For non-code modes (chat, explain):
   * - Returns content as message
   */
  parseResponse(response: AIResponse, mode: AIMode): ParsedResponse {
    // Handle API errors
    if (!response.success) {
      return {
        success: false,
        code: null,
        message: null,
        error: response.error || 'Unknown API error'
      };
    }

    const content = response.content;

    // Handle empty response
    if (!content || content.trim() === '') {
      return {
        success: false,
        code: null,
        message: null,
        error: 'Empty response from AI'
      };
    }

    // For chat and explain modes, return content as message
    if (mode === 'chat' || mode === 'explain') {
      return {
        success: true,
        code: null,
        message: content.trim()
      };
    }

    // For code-generating modes (create, edit, fix), extract code
    const extractedCode = this.extractCode(content);

    // For fix mode, also extract explanation if present
    if (mode === 'fix') {
      const explanation = this.parseFixExplanation(content);
      return {
        success: true,
        code: extractedCode,
        message: explanation
      };
    }

    // For create and edit modes
    return {
      success: true,
      code: extractedCode,
      message: null
    };
  }

  /**
   * Extract code from AI response content
   * Handles multiple formats:
   * - Markdown code blocks (```javascript, ```js, ```typescript, ```ts, ```)
   * - Shebang-starting content (#!/...)
   * - Metadata comment-starting content (// @name:)
   * - <code> tags
   * - Raw async function declarations
   */
  private extractCode(content: string): string {
    const trimmed = content.trim();

    // Try to extract from markdown code blocks (```javascript, ```js, etc.)
    const codeBlockMatch = trimmed.match(/```(?:javascript|js|typescript|ts)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to extract from <code> tags (used in fix mode)
    const codeTagMatch = trimmed.match(/<code>\s*([\s\S]*?)\s*<\/code>/);
    if (codeTagMatch) {
      return codeTagMatch[1].trim();
    }

    // Check if content looks like raw code
    if (this.isCodeLike(trimmed)) {
      return trimmed;
    }

    // If nothing matched, return the trimmed content as-is
    // This handles edge cases where the AI returns code without wrapping
    return trimmed;
  }
}

/**
 * Create an AIBridge instance with the given config
 */
export function createAIBridge(config: AIConfig): AIBridge {
  return new AIBridge(config);
}
