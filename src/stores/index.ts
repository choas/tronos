export {
  sessionState,
  setSessionState,
  getActiveSession,
  createSession,
  switchSession,
  deleteSession,
  updateSession,
  initSessions,
  addConversationMessage,
  getConversationHistory,
  clearConversationHistory
} from './sessions';

export {
  aiConfigState,
  setAIConfigState,
  getAIConfig,
  isAIConfigured,
  setAIConfig,
  setAIProvider,
  resetAIConfig,
  initAIConfig,
  loadPersistedAIConfig,
  loadEnvConfig,
  maskApiKey,
  PROVIDER_DEFAULTS
} from './ai';

export type { AIProvider, AIConfig } from './ai';

export {
  themeState,
  setThemeState,
  getTheme,
  getThemeConfig,
  getColors,
  getColor,
  setTheme,
  setColor,
  toggleTheme,
  applyTheme,
  applyPreset,
  resetTheme,
  getAllPresetNames,
  getPreset,
  registerCustomPreset,
  getCustomPresets,
  initTheme,
  loadPersistedTheme,
  COLOR_KEYS,
  PRESET_THEMES,
} from './theme';

export type { Theme, ThemeConfig, ColorKey, ColorPalette, ThemePreset } from './theme';

export {
  bootConfigState,
  setBootConfigState,
  getBootConfig,
  shouldSkipBootAnimation,
  setSkipBootAnimation,
  resetBootConfig,
  loadPersistedBootConfig
} from './boot';

export type { BootConfig } from './boot';

export {
  termsConfigState,
  setTermsConfigState,
  hasAcceptedTerms,
  acceptTerms,
  resetTermsConfig,
  loadPersistedTermsConfig
} from './terms';

export type { TermsConfig } from './terms';
