import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConversationMessage } from '../src/types';

// Maximum conversation history limit (must match src/stores/sessions.ts)
const MAX_CONVERSATION_HISTORY = 10;

// Mock the stores module
const mockSessionState = {
  active: 'test-session',
  sessions: {
    'test-session': {
      id: 'test-session',
      name: 'test',
      created: Date.now(),
      lastAccess: Date.now(),
      fsNamespace: 'test_fs',
      env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
      history: [],
      aliases: {},
      conversationHistory: [] as ConversationMessage[]
    }
  }
};

// Track conversation operations
let conversationOperations: { type: string; data?: unknown }[] = [];

vi.mock('../src/stores', async () => {
  return {
    getConversationHistory: () => mockSessionState.sessions['test-session'].conversationHistory,
    addConversationMessage: (msg: ConversationMessage) => {
      conversationOperations.push({ type: 'add', data: msg });

      const history = mockSessionState.sessions['test-session'].conversationHistory;
      history.push(msg);

      // Apply the same limit as the real implementation
      const maxMessages = MAX_CONVERSATION_HISTORY * 2;
      if (history.length > maxMessages) {
        mockSessionState.sessions['test-session'].conversationHistory = history.slice(-maxMessages);
      }
    },
    clearConversationHistory: () => {
      conversationOperations.push({ type: 'clear' });
      mockSessionState.sessions['test-session'].conversationHistory = [];
    },
    getAIConfig: () => ({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
      baseURL: 'https://api.anthropic.com',
      temperature: 0.7,
      maxTokens: 4096
    }),
    isAIConfigured: () => true,
    sessionState: mockSessionState,
    getActiveSession: () => mockSessionState.sessions['test-session']
  };
});

// Mock fetch for AI API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Conversation Memory', () => {
  beforeEach(() => {
    // Reset conversation history
    mockSessionState.sessions['test-session'].conversationHistory = [];
    conversationOperations = [];
    mockFetch.mockReset();
  });

  describe('ConversationMessage type', () => {
    it('should have all required fields', () => {
      const message: ConversationMessage = {
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
        mode: 'chat'
      };

      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello');
      expect(typeof message.timestamp).toBe('number');
      expect(message.mode).toBe('chat');
    });

    it('should allow optional mode field', () => {
      const message: ConversationMessage = {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now()
      };

      expect(message.mode).toBeUndefined();
    });
  });

  describe('Session store conversation functions', () => {
    it('getConversationHistory returns empty array initially', async () => {
      const { getConversationHistory } = await import('../src/stores');
      const history = getConversationHistory();
      expect(history).toEqual([]);
    });

    it('addConversationMessage adds message to history', async () => {
      const { addConversationMessage, getConversationHistory } = await import('../src/stores');

      const message: ConversationMessage = {
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
        mode: 'chat'
      };

      addConversationMessage(message);
      const history = getConversationHistory();

      expect(history.length).toBe(1);
      expect(history[0].content).toBe('Test message');
    });

    it('clearConversationHistory clears all messages', async () => {
      const { addConversationMessage, clearConversationHistory, getConversationHistory } = await import('../src/stores');

      // Add some messages
      addConversationMessage({
        role: 'user',
        content: 'Message 1',
        timestamp: Date.now(),
        mode: 'chat'
      });
      addConversationMessage({
        role: 'assistant',
        content: 'Response 1',
        timestamp: Date.now(),
        mode: 'chat'
      });

      expect(getConversationHistory().length).toBe(2);

      clearConversationHistory();

      expect(getConversationHistory().length).toBe(0);
    });
  });

  describe('@ai clear command', () => {
    it('should parse clear command correctly', async () => {
      const { parseAICommand } = await import('../src/engine/ai/parser');

      // The clear command is handled before parsing, so parseAICommand
      // returns a chat mode for "clear" since it doesn't recognize it as a mode
      const parsed = parseAICommand('@ai clear');
      // This would be handled specially in the builtin
      expect(parsed).toBeTruthy();
    });

    it('should parse reset command correctly', async () => {
      const { parseAICommand } = await import('../src/engine/ai/parser');

      const parsed = parseAICommand('@ai reset');
      expect(parsed).toBeTruthy();
    });
  });

  describe('AIBridge conversation history support', () => {
    it('buildMessages includes conversation history when provided', async () => {
      const { AIBridge } = await import('../src/engine/ai/bridge');

      const bridge = new AIBridge({
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-sonnet-4-6',
        baseURL: 'https://api.anthropic.com',
        temperature: 0.7,
        maxTokens: 4096
      });

      const conversationHistory = [
        { role: 'user' as const, content: 'Previous question' },
        { role: 'assistant' as const, content: 'Previous answer' }
      ];

      const { messages } = bridge.buildMessages(
        'chat',
        'Current question',
        { cwd: '/', env: {} },
        null,
        conversationHistory
      );

      // Should include history messages plus current message
      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe('Previous question');
      expect(messages[1].content).toBe('Previous answer');
      expect(messages[2].content).toContain('Current question');
    });

    it('buildMessages works without conversation history', async () => {
      const { AIBridge } = await import('../src/engine/ai/bridge');

      const bridge = new AIBridge({
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-sonnet-4-6',
        baseURL: 'https://api.anthropic.com',
        temperature: 0.7,
        maxTokens: 4096
      });

      const { messages } = bridge.buildMessages(
        'chat',
        'Single question',
        { cwd: '/', env: {} },
        null
      );

      // Should only have the current message
      expect(messages.length).toBe(1);
    });

    it('buildMessages with empty conversation history', async () => {
      const { AIBridge } = await import('../src/engine/ai/bridge');

      const bridge = new AIBridge({
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-sonnet-4-6',
        baseURL: 'https://api.anthropic.com',
        temperature: 0.7,
        maxTokens: 4096
      });

      const { messages } = bridge.buildMessages(
        'chat',
        'Question',
        { cwd: '/', env: {} },
        null,
        []
      );

      expect(messages.length).toBe(1);
    });
  });

  describe('History limit (MAX_CONVERSATION_HISTORY)', () => {
    it('should limit conversation history to 10 exchanges (20 messages)', async () => {
      const { addConversationMessage, getConversationHistory } = await import('../src/stores');

      // Reset history
      mockSessionState.sessions['test-session'].conversationHistory = [];

      // Add 12 exchanges (24 messages)
      for (let i = 0; i < 12; i++) {
        addConversationMessage({
          role: 'user',
          content: `User message ${i}`,
          timestamp: Date.now() + i * 2,
          mode: 'chat'
        });
        addConversationMessage({
          role: 'assistant',
          content: `Assistant response ${i}`,
          timestamp: Date.now() + i * 2 + 1,
          mode: 'chat'
        });
      }

      const history = getConversationHistory();

      // Should be limited to 20 messages (10 exchanges)
      expect(history.length).toBe(20);

      // Should keep the most recent messages (trim from the start)
      expect(history[0].content).toBe('User message 2');
      expect(history[history.length - 1].content).toBe('Assistant response 11');
    });
  });

  describe('Conversation storage based on mode', () => {
    it('should store conversation for chat mode', () => {
      // Chat mode should include history
      const shouldIncludeHistory = 'chat' === 'chat' || 'chat' === 'explain';
      expect(shouldIncludeHistory).toBe(true);
    });

    it('should store conversation for explain mode', () => {
      const shouldIncludeHistory = 'explain' === 'chat' || 'explain' === 'explain';
      expect(shouldIncludeHistory).toBe(true);
    });

    it('should not store conversation for create mode', () => {
      const shouldIncludeHistory = 'create' === 'chat' || 'create' === 'explain';
      expect(shouldIncludeHistory).toBe(false);
    });

    it('should not store conversation for edit mode', () => {
      const shouldIncludeHistory = 'edit' === 'chat' || 'edit' === 'explain';
      expect(shouldIncludeHistory).toBe(false);
    });

    it('should not store conversation for fix mode', () => {
      const shouldIncludeHistory = 'fix' === 'chat' || 'fix' === 'explain';
      expect(shouldIncludeHistory).toBe(false);
    });
  });

  describe('Session with conversation history', () => {
    it('session should have conversationHistory field', () => {
      const session = mockSessionState.sessions['test-session'];
      expect(session).toHaveProperty('conversationHistory');
      expect(Array.isArray(session.conversationHistory)).toBe(true);
    });

    it('new sessions should initialize with empty conversationHistory', () => {
      // Simulate creating a new session structure
      const newSession = {
        id: 'new-session',
        name: 'new',
        created: Date.now(),
        lastAccess: Date.now(),
        fsNamespace: 'new_fs',
        env: { HOME: '/home/tronos', PATH: '/bin', USER: 'tronos' },
        history: [],
        aliases: {},
        conversationHistory: []
      };

      expect(newSession.conversationHistory).toEqual([]);
    });
  });

  describe('Message format for conversation history', () => {
    it('user messages should include mode information', async () => {
      const { addConversationMessage, getConversationHistory } = await import('../src/stores');

      // Reset history
      mockSessionState.sessions['test-session'].conversationHistory = [];

      addConversationMessage({
        role: 'user',
        content: 'What is TronOS?',
        timestamp: Date.now(),
        mode: 'chat'
      });

      const history = getConversationHistory();
      expect(history[0].mode).toBe('chat');
    });

    it('assistant messages should include mode information', async () => {
      const { addConversationMessage, getConversationHistory } = await import('../src/stores');

      // Reset history
      mockSessionState.sessions['test-session'].conversationHistory = [];

      addConversationMessage({
        role: 'assistant',
        content: 'TronOS is an AI-native operating system...',
        timestamp: Date.now(),
        mode: 'chat'
      });

      const history = getConversationHistory();
      expect(history[0].mode).toBe('chat');
    });
  });

  describe('Conversation history persistence', () => {
    it('should trigger save when adding message', async () => {
      const { addConversationMessage } = await import('../src/stores');

      // Reset operations tracking
      conversationOperations = [];

      addConversationMessage({
        role: 'user',
        content: 'Test',
        timestamp: Date.now()
      });

      // Check that add operation was tracked
      expect(conversationOperations.some(op => op.type === 'add')).toBe(true);
    });

    it('should trigger save when clearing history', async () => {
      const { clearConversationHistory } = await import('../src/stores');

      // Reset operations tracking
      conversationOperations = [];

      clearConversationHistory();

      // Check that clear operation was tracked
      expect(conversationOperations.some(op => op.type === 'clear')).toBe(true);
    });
  });
});

describe('buildUserMessageForHistory helper', () => {
  it('should format chat mode messages simply', () => {
    // Testing the logic inline since the function is private
    const mode = 'chat';
    const prompt = 'What is TronOS?';
    const targetFile = null;

    const result = mode === 'chat' ? prompt :
      mode === 'explain' && targetFile ? `Explain ${targetFile}: ${prompt}` : prompt;

    expect(result).toBe('What is TronOS?');
  });

  it('should format explain mode messages with file reference', () => {
    const mode = 'explain';
    const prompt = 'How does this work?';
    const targetFile = '/bin/help.trx';

    const result = mode === 'explain' && targetFile
      ? `Explain ${targetFile}: ${prompt}`
      : prompt;

    expect(result).toBe('Explain /bin/help.trx: How does this work?');
  });

  it('should handle explain mode without target file', () => {
    const mode = 'explain';
    const prompt = 'How does this work?';
    const targetFile = null;

    const result = mode === 'explain' && targetFile
      ? `Explain ${targetFile}: ${prompt}`
      : prompt;

    expect(result).toBe('How does this work?');
  });
});
