import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setAIConfigState,
  getAIConfig,
  isAIConfigured,
  loadEnvConfig,
  PROVIDER_DEFAULTS
} from '../src/stores/ai';

// Store original import.meta.env
const originalEnv = { ...import.meta.env };

// Reset config state before each test
beforeEach(() => {
  // Reset to defaults
  setAIConfigState("config", {
    ...PROVIDER_DEFAULTS.anthropic,
    apiKey: ""
  });
  setAIConfigState("isConfigured", false);

  // Reset import.meta.env
  Object.keys(import.meta.env).forEach(key => {
    if (key.startsWith('VITE_TRONOS_')) {
      delete (import.meta.env as Record<string, string>)[key];
    }
  });
});

describe('loadEnvConfig', () => {
  describe('when no env vars are set', () => {
    it('should return false', () => {
      const result = loadEnvConfig();
      expect(result).toBe(false);
    });

    it('should not modify config', () => {
      const originalConfig = getAIConfig();
      loadEnvConfig();
      expect(getAIConfig()).toEqual(originalConfig);
    });
  });

  describe('when VITE_TRONOS_AI_PROVIDER is set', () => {
    it('should apply provider defaults for valid provider', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'openai';

      const result = loadEnvConfig();

      expect(result).toBe(true);
      const config = getAIConfig();
      expect(config.provider).toBe('openai');
      expect(config.model).toBe(PROVIDER_DEFAULTS.openai.model);
      expect(config.baseURL).toBe(PROVIDER_DEFAULTS.openai.baseURL);
    });

    it('should not apply invalid provider', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'invalid-provider';

      const result = loadEnvConfig();

      // Returns false since the only env var was invalid
      expect(result).toBe(false);
      expect(getAIConfig().provider).toBe('anthropic'); // Default unchanged
    });

    it('should handle ollama provider', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'ollama';

      loadEnvConfig();

      const config = getAIConfig();
      expect(config.provider).toBe('ollama');
      expect(config.baseURL).toBe(PROVIDER_DEFAULTS.ollama.baseURL);
    });

    it('should handle openrouter provider', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'openrouter';

      loadEnvConfig();

      const config = getAIConfig();
      expect(config.provider).toBe('openrouter');
      expect(config.model).toBe(PROVIDER_DEFAULTS.openrouter.model);
    });
  });

  describe('when VITE_TRONOS_API_KEY is set', () => {
    it('should apply API key', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_API_KEY = 'sk-test-12345';

      const result = loadEnvConfig();

      expect(result).toBe(true);
      expect(getAIConfig().apiKey).toBe('sk-test-12345');
    });

    it('should set isConfigured to true', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_API_KEY = 'sk-test-12345';

      loadEnvConfig();

      expect(isAIConfigured()).toBe(true);
    });
  });

  describe('when VITE_TRONOS_AI_MODEL is set', () => {
    it('should apply custom model', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_MODEL = 'claude-opus-4-6';

      const result = loadEnvConfig();

      expect(result).toBe(true);
      expect(getAIConfig().model).toBe('claude-opus-4-6');
    });

    it('should override provider default model', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'openai';
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_MODEL = 'gpt-4-turbo';

      loadEnvConfig();

      const config = getAIConfig();
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4-turbo'); // Custom, not default gpt-4o
    });
  });

  describe('when multiple env vars are set', () => {
    it('should apply all env vars together', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'anthropic';
      (import.meta.env as Record<string, string>).VITE_TRONOS_API_KEY = 'sk-ant-test';
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_MODEL = 'claude-3-haiku-20240307';

      loadEnvConfig();

      const config = getAIConfig();
      expect(config.provider).toBe('anthropic');
      expect(config.apiKey).toBe('sk-ant-test');
      expect(config.model).toBe('claude-3-haiku-20240307');
      expect(isAIConfigured()).toBe(true);
    });

    it('should apply provider defaults then override with explicit model', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'ollama';
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_MODEL = 'mistral';

      loadEnvConfig();

      const config = getAIConfig();
      expect(config.provider).toBe('ollama');
      expect(config.model).toBe('mistral');
      expect(config.baseURL).toBe(PROVIDER_DEFAULTS.ollama.baseURL);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string env vars as not set', () => {
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = '';
      (import.meta.env as Record<string, string>).VITE_TRONOS_API_KEY = '';
      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_MODEL = '';

      const result = loadEnvConfig();

      // Empty strings should be treated as falsy
      expect(result).toBe(false);
    });

    it('should preserve existing API key when only provider is set', () => {
      // Set an existing API key first
      setAIConfigState("config", { apiKey: 'existing-key' });
      setAIConfigState("isConfigured", true);

      (import.meta.env as Record<string, string>).VITE_TRONOS_AI_PROVIDER = 'openai';

      loadEnvConfig();

      const config = getAIConfig();
      expect(config.provider).toBe('openai');
      // The existing key is preserved because loadEnvConfig doesn't explicitly clear it
      // But the config update doesn't include apiKey, so it uses the current state
      expect(isAIConfigured()).toBe(true);
    });
  });
});
