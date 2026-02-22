import { createStore } from "solid-js/store";
import { loadAIConfig, saveAIConfig, clearAIConfig } from "../persistence/config";

/** Supported AI providers */
export type AIProvider = "tronos" | "anthropic" | "openai" | "ollama" | "openrouter";

/** AI configuration interface */
export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseURL: string;
  temperature: number;
  maxTokens: number;
}

/** Default configurations for each provider */
export const PROVIDER_DEFAULTS: Record<AIProvider, Omit<AIConfig, "apiKey">> = {
  tronos: {
    provider: "tronos",
    model: "moonshotai/kimi-k2.5",
    baseURL: (import.meta.env.VITE_TRONOS_API_BASE_URL || "https://ai.tronos.dev/api") + "/ai",
    temperature: 0.7,
    maxTokens: 4096
  },
  anthropic: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    baseURL: "https://api.anthropic.com",
    temperature: 0.7,
    maxTokens: 4096
  },
  openai: {
    provider: "openai",
    model: "gpt-4o",
    baseURL: "https://api.openai.com/v1",
    temperature: 0.7,
    maxTokens: 4096
  },
  ollama: {
    provider: "ollama",
    model: "llama3.2",
    baseURL: "http://localhost:11434",
    temperature: 0.7,
    maxTokens: 4096
  },
  openrouter: {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4-6",
    baseURL: "https://openrouter.ai/api/v1",
    temperature: 0.7,
    maxTokens: 4096
  }
};

/** AI config state interface */
interface AIConfigState {
  config: AIConfig;
  isConfigured: boolean;
}

/**
 * Check if the API key should be cleared when provider changes.
 * Reads from VITE_TRONOS_CLEAR_API_KEY_ON_PROVIDER_CHANGE env var.
 * Defaults to true if not set.
 */
export function shouldClearApiKeyOnProviderChange(): boolean {
  const env = import.meta.env;
  const envValue = env.VITE_TRONOS_CLEAR_API_KEY_ON_PROVIDER_CHANGE as string | undefined;

  // Default to true if not set
  if (envValue === undefined || envValue === "") {
    return true;
  }

  // Parse the value - only "false" or "0" disables clearing
  return envValue.toLowerCase() !== "false" && envValue !== "0";
}

/** Default configuration (TronOS - no API key required) */
const DEFAULT_CONFIG: AIConfig = {
  ...PROVIDER_DEFAULTS.tronos,
  apiKey: ""
};

export const [aiConfigState, setAIConfigState] = createStore<AIConfigState>({
  config: DEFAULT_CONFIG,
  isConfigured: !providerRequiresApiKey(DEFAULT_CONFIG.provider)
});

/**
 * Get the current AI configuration
 */
export function getAIConfig(): AIConfig {
  return aiConfigState.config;
}

/**
 * Check if AI is properly configured (has API key)
 */
export function isAIConfigured(): boolean {
  return aiConfigState.isConfigured;
}

/**
 * Check if the given provider requires an API key
 * TronOS and Ollama don't require API keys
 */
export function providerRequiresApiKey(provider: AIProvider): boolean {
  return provider !== "tronos" && provider !== "ollama";
}

/**
 * Update AI configuration
 */
export function setAIConfig(updates: Partial<AIConfig>): void {
  setAIConfigState("config", updates);

  // Update isConfigured based on provider and API key
  // TronOS and Ollama don't require API keys
  const provider = updates.provider ?? aiConfigState.config.provider;
  const hasApiKey = (updates.apiKey !== undefined ? updates.apiKey : aiConfigState.config.apiKey).length > 0;
  const isConfigured = !providerRequiresApiKey(provider) || hasApiKey;
  setAIConfigState("isConfigured", isConfigured);

  // Persist to localStorage
  saveAIConfig(aiConfigState.config);
}

/**
 * Set the AI provider, applying default configuration for that provider.
 * By default, clears the API key when provider changes (controlled by VITE_TRONOS_CLEAR_API_KEY_ON_PROVIDER_CHANGE env var).
 */
export function setAIProvider(provider: AIProvider): void {
  const defaults = PROVIDER_DEFAULTS[provider];
  const clearApiKey = shouldClearApiKeyOnProviderChange();
  const newApiKey = clearApiKey ? "" : aiConfigState.config.apiKey;

  setAIConfigState("config", {
    ...defaults,
    apiKey: newApiKey
  });

  // Update isConfigured: tronos and ollama don't require API key
  const isConfigured = !providerRequiresApiKey(provider) || newApiKey.length > 0;
  setAIConfigState("isConfigured", isConfigured);

  // Persist to localStorage
  saveAIConfig(aiConfigState.config);
}

/**
 * Reset AI configuration to defaults for current provider
 */
export function resetAIConfig(): void {
  const currentProvider = aiConfigState.config.provider;
  const defaults = PROVIDER_DEFAULTS[currentProvider];
  setAIConfigState("config", {
    ...defaults,
    apiKey: "" // Clear API key on reset
  });
  setAIConfigState("isConfigured", false);

  // Clear from localStorage
  clearAIConfig();
}

/**
 * Initialize AI configuration from external source (e.g., persistence)
 */
export function initAIConfig(config: AIConfig): void {
  setAIConfigState("config", config);
  // TronOS and Ollama don't require API keys
  const isConfigured = !providerRequiresApiKey(config.provider) || config.apiKey.length > 0;
  setAIConfigState("isConfigured", isConfigured);
}

/**
 * Load AI configuration from localStorage on startup
 * Returns true if config was loaded, false if using defaults
 */
export function loadPersistedAIConfig(): boolean {
  const storedConfig = loadAIConfig();
  if (storedConfig) {
    initAIConfig(storedConfig);
    return true;
  }
  return false;
}

/**
 * Mask API key for display (show first 4 and last 4 characters)
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) {
    return apiKey ? "****" : "";
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

/**
 * Check if Ollama is reachable and CORS is configured.
 * Sends a lightweight GET to the Ollama API tags endpoint.
 * Returns { ok, error } — error describes what went wrong.
 */
export async function checkOllamaConnection(
  baseURL: string = PROVIDER_DEFAULTS.ollama.baseURL
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${baseURL}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: `Ollama returned HTTP ${response.status}` };
  } catch {
    return {
      ok: false,
      error:
        "Cannot reach Ollama. Make sure Ollama is running and CORS is enabled:\n" +
        'OLLAMA_ORIGINS="https://tronos.dev" ollama serve',
    };
  }
}

/**
 * Load AI configuration from environment variables (Vite import.meta.env)
 *
 * Supported environment variables:
 * - VITE_TRONOS_AI_PROVIDER: AI provider (anthropic, openai, ollama, openrouter)
 * - VITE_TRONOS_API_KEY: API key for the AI provider
 * - VITE_TRONOS_AI_MODEL: AI model name
 *
 * @returns true if any env vars were found and applied, false otherwise
 */
export function loadEnvConfig(): boolean {
  const env = import.meta.env;

  const envProvider = env.VITE_TRONOS_AI_PROVIDER as string | undefined;
  const envApiKey = env.VITE_TRONOS_API_KEY as string | undefined;
  const envModel = env.VITE_TRONOS_AI_MODEL as string | undefined;

  // If no env vars are set, return false
  if (!envProvider && !envApiKey && !envModel) {
    return false;
  }

  const updates: Partial<AIConfig> = {};

  // Validate and apply provider
  if (envProvider) {
    const validProviders: AIProvider[] = ["tronos", "anthropic", "openai", "ollama", "openrouter"];
    if (validProviders.includes(envProvider as AIProvider)) {
      // Apply provider defaults first
      const defaults = PROVIDER_DEFAULTS[envProvider as AIProvider];
      updates.provider = envProvider as AIProvider;
      updates.model = defaults.model;
      updates.baseURL = defaults.baseURL;
      updates.temperature = defaults.temperature;
      updates.maxTokens = defaults.maxTokens;
    }
  }

  // Apply API key if provided
  if (envApiKey) {
    updates.apiKey = envApiKey;
  }

  // Override model if explicitly provided
  if (envModel) {
    updates.model = envModel;
  }

  // Apply updates if any were set
  if (Object.keys(updates).length > 0) {
    setAIConfigState("config", updates);

    // Update isConfigured: tronos and ollama don't require API key
    const provider = updates.provider ?? aiConfigState.config.provider;
    const hasApiKey = (updates.apiKey || aiConfigState.config.apiKey).length > 0;
    const isConfigured = !providerRequiresApiKey(provider) || hasApiKey;
    setAIConfigState("isConfigured", isConfigured);

    return true;
  }

  return false;
}
