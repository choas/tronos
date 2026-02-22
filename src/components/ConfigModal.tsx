import { createSignal, Show, For, createEffect } from "solid-js";
import {
  aiConfigState,
  setAIConfig,
  setAIProvider,
  resetAIConfig,
  shouldClearApiKeyOnProviderChange,
  providerRequiresApiKey,
  checkOllamaConnection,
  PROVIDER_DEFAULTS,
  type AIProvider,
  type AIConfig
} from "../stores/ai";

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDERS: { value: AIProvider; label: string; description: string }[] = [
  { value: "tronos", label: "TronOS (Built-in)", description: "Free, no API key required" },
  { value: "anthropic", label: "Anthropic", description: "Bring your own API key" },
  { value: "openai", label: "OpenAI", description: "Bring your own API key" },
  { value: "ollama", label: "Ollama (Local)", description: "Run locally, no API key required" },
  { value: "openrouter", label: "OpenRouter", description: "Bring your own API key" }
];

export function ConfigModal(props: ConfigModalProps) {
  // Local form state
  const [provider, setProvider] = createSignal<AIProvider>(aiConfigState.config.provider);
  const [apiKey, setApiKey] = createSignal(aiConfigState.config.apiKey);
  const [model, setModel] = createSignal(aiConfigState.config.model);
  const [baseURL, setBaseURL] = createSignal(aiConfigState.config.baseURL);
  const [temperature, setTemperature] = createSignal(aiConfigState.config.temperature);
  const [maxTokens, setMaxTokens] = createSignal(aiConfigState.config.maxTokens);

  // Ollama CORS check state: null = not checked, true = ok, string = error
  const [ollamaStatus, setOllamaStatus] = createSignal<null | true | string>(null);
  const [ollamaChecking, setOllamaChecking] = createSignal(false);

  const runOllamaCheck = async (url: string) => {
    setOllamaChecking(true);
    setOllamaStatus(null);
    const result = await checkOllamaConnection(url);
    setOllamaStatus(result.ok ? true : (result.error ?? "Connection failed"));
    setOllamaChecking(false);
  };

  // Sync local state when modal opens or config changes
  createEffect(() => {
    if (props.isOpen) {
      setProvider(aiConfigState.config.provider);
      setApiKey(aiConfigState.config.apiKey);
      setModel(aiConfigState.config.model);
      setBaseURL(aiConfigState.config.baseURL);
      setTemperature(aiConfigState.config.temperature);
      setMaxTokens(aiConfigState.config.maxTokens);

      // Auto-check Ollama connectivity when modal opens with Ollama selected
      if (aiConfigState.config.provider === "ollama") {
        runOllamaCheck(aiConfigState.config.baseURL);
      } else {
        setOllamaStatus(null);
      }
    }
  });

  const handleProviderChange = (newProvider: AIProvider) => {
    setProvider(newProvider);
    // Apply provider defaults
    const defaults = PROVIDER_DEFAULTS[newProvider];
    setModel(defaults.model);
    setBaseURL(defaults.baseURL);
    setTemperature(defaults.temperature);
    setMaxTokens(defaults.maxTokens);
    // Clear API key if the env flag is set (default: true)
    if (shouldClearApiKeyOnProviderChange()) {
      setApiKey("");
    }
    // Check Ollama connectivity when switching to it
    if (newProvider === "ollama") {
      runOllamaCheck(defaults.baseURL);
    } else {
      setOllamaStatus(null);
    }
  };

  const handleSave = () => {
    const config: Partial<AIConfig> = {
      provider: provider(),
      apiKey: apiKey(),
      model: model(),
      baseURL: baseURL(),
      temperature: temperature(),
      maxTokens: maxTokens()
    };

    // First set provider to apply defaults, then override with our values
    setAIProvider(provider());
    setAIConfig(config);
    props.onClose();
  };

  const handleReset = () => {
    resetAIConfig();
    // Sync local state with reset values
    setProvider(aiConfigState.config.provider);
    setApiKey("");
    setModel(PROVIDER_DEFAULTS[aiConfigState.config.provider].model);
    setBaseURL(PROVIDER_DEFAULTS[aiConfigState.config.provider].baseURL);
    setTemperature(PROVIDER_DEFAULTS[aiConfigState.config.provider].temperature);
    setMaxTokens(PROVIDER_DEFAULTS[aiConfigState.config.provider].maxTokens);
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="config-modal-overlay" onClick={handleOverlayClick}>
        <div class="config-modal">
          <div class="config-modal-header">
            <h2>AI Configuration</h2>
            <button class="config-modal-close" onClick={props.onClose}>
              &times;
            </button>
          </div>

          <div class="config-modal-body">
            {/* Provider Selection */}
            <div class="config-field">
              <label class="config-label">Provider</label>
              <select
                class="config-select"
                value={provider()}
                onChange={(e) => handleProviderChange(e.currentTarget.value as AIProvider)}
              >
                <For each={PROVIDERS}>
                  {(p) => <option value={p.value}>{p.label}</option>}
                </For>
              </select>
            </div>

            {/* API Key Input - only show when provider requires it */}
            <Show when={providerRequiresApiKey(provider())}>
              <div class="config-field">
                <label class="config-label">API Key</label>
                <input
                  type="password"
                  class="config-input"
                  value={apiKey()}
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                  placeholder="Enter your API key"
                />
                <span class="config-hint">
                  Your API key is stored locally in your browser
                </span>
              </div>
            </Show>
            <Show when={!providerRequiresApiKey(provider())}>
              <div class="config-field">
                <span class="config-hint config-hint-success">
                  {provider() === "tronos"
                    ? "TronOS provides free AI access - no API key needed!"
                    : "Ollama runs locally and doesn't require an API key"}
                </span>
              </div>
            </Show>

            {/* Ollama CORS note + connectivity check */}
            <Show when={provider() === "ollama"}>
              <div class="config-field">
                <div class="config-ollama-note">
                  <strong>CORS required</strong>
                  <p>
                    Ollama must allow requests from <code>{window.location.origin}</code>.
                    Quit the Ollama desktop app first, then run from terminal:
                  </p>
                  <code>OLLAMA_ORIGINS="{window.location.origin}" ollama serve</code>
                </div>
                <div style={{ "margin-top": "8px" }}>
                  <Show when={ollamaChecking()}>
                    <span class="config-hint" style={{ color: "var(--fg-secondary)" }}>
                      Checking Ollama connectivity...
                    </span>
                  </Show>
                  <Show when={!ollamaChecking() && ollamaStatus() === true}>
                    <span class="config-hint config-hint-success">
                      Ollama is reachable - connection OK
                    </span>
                  </Show>
                  <Show when={!ollamaChecking() && typeof ollamaStatus() === "string"}>
                    <span class="config-hint" style={{ color: "#ffa000" }}>
                      Connection failed - is Ollama running with CORS enabled?
                    </span>
                  </Show>
                  <button
                    class="config-btn config-btn-secondary"
                    style={{ "margin-top": "6px", "font-size": "12px", padding: "4px 10px" }}
                    onClick={() => runOllamaCheck(baseURL())}
                  >
                    Test connection
                  </button>
                </div>
              </div>
            </Show>

            {/* Model Input */}
            <div class="config-field">
              <label class="config-label">Model</label>
              <input
                type="text"
                class="config-input"
                value={model()}
                onInput={(e) => setModel(e.currentTarget.value)}
                placeholder="e.g., claude-sonnet-4-6"
              />
            </div>

            {/* Base URL Input */}
            <div class="config-field">
              <label class="config-label">Base URL</label>
              <input
                type="text"
                class="config-input"
                value={baseURL()}
                onInput={(e) => setBaseURL(e.currentTarget.value)}
                placeholder="API endpoint URL"
              />
            </div>

            {/* Temperature Slider */}
            <div class="config-field">
              <label class="config-label">
                Temperature: <span class="config-value">{temperature().toFixed(1)}</span>
              </label>
              <input
                type="range"
                class="config-slider"
                min="0"
                max="2"
                step="0.1"
                value={temperature()}
                onInput={(e) => setTemperature(parseFloat(e.currentTarget.value))}
              />
              <div class="config-slider-labels">
                <span>Focused (0)</span>
                <span>Creative (2)</span>
              </div>
            </div>

            {/* Max Tokens Input */}
            <div class="config-field">
              <label class="config-label">Max Tokens</label>
              <input
                type="number"
                class="config-input"
                value={maxTokens()}
                onInput={(e) => setMaxTokens(parseInt(e.currentTarget.value) || 4096)}
                min="1"
                max="100000"
              />
            </div>
          </div>

          <div class="config-modal-footer">
            <button class="config-btn config-btn-secondary" onClick={handleReset}>
              Reset to Defaults
            </button>
            <div class="config-btn-group">
              <button class="config-btn config-btn-secondary" onClick={props.onClose}>
                Cancel
              </button>
              <button class="config-btn config-btn-primary" onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
