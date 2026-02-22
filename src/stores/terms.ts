import { createStore } from "solid-js/store";
import { loadTermsConfig, saveTermsConfig, clearTermsConfig } from "../persistence/terms";
import { TERMS_VERSION } from "../engine/terms-content";

/** Terms configuration interface */
export interface TermsConfig {
  accepted: boolean;
  acceptedAt: number | null;
  version: string;
}

/** Terms config state interface */
interface TermsConfigState {
  config: TermsConfig;
}

/** Default configuration */
const DEFAULT_CONFIG: TermsConfig = {
  accepted: false,
  acceptedAt: null,
  version: "",
};

export const [termsConfigState, setTermsConfigState] = createStore<TermsConfigState>({
  config: DEFAULT_CONFIG,
});

/**
 * Check if the user has accepted the current version of terms
 */
export function hasAcceptedTerms(): boolean {
  return termsConfigState.config.accepted && termsConfigState.config.version === TERMS_VERSION;
}

/**
 * Accept the current terms
 */
export function acceptTerms(): void {
  const newConfig: TermsConfig = {
    accepted: true,
    acceptedAt: Date.now(),
    version: TERMS_VERSION,
  };
  setTermsConfigState("config", newConfig);
  saveTermsConfig(termsConfigState.config);
}

/**
 * Reset terms configuration to defaults
 */
export function resetTermsConfig(): void {
  setTermsConfigState("config", { ...DEFAULT_CONFIG });
  clearTermsConfig();
}

/**
 * Load terms configuration from localStorage on startup
 * Returns true if config was loaded, false if using defaults
 */
export function loadPersistedTermsConfig(): boolean {
  const storedConfig = loadTermsConfig();
  if (storedConfig) {
    setTermsConfigState("config", storedConfig);
    return true;
  }
  return false;
}
