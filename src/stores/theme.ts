import { createStore } from "solid-js/store";
import { loadTheme, saveTheme } from "../persistence/theme";

/** Color keys used by the theme system */
export const COLOR_KEYS = [
  'bg-primary',
  'fg-primary',
  'bg-secondary',
  'fg-secondary',
  'accent',
  'accent-hover',
  'error',
  'border',
  'hover-bg',
  'overlay-bg',
  'shadow-color',
] as const;

export type ColorKey = typeof COLOR_KEYS[number];

/** Full color palette for a theme */
export type ColorPalette = Record<ColorKey, string>;

/** A named theme preset */
export interface ThemePreset {
  name: string;
  colors: ColorPalette;
}

/** Theme configuration interface */
export interface ThemeConfig {
  theme: string;
  colors: ColorPalette;
}

/** Legacy theme type for backward compat */
export type Theme = string;

/** Built-in preset themes */
export const PRESET_THEMES: Record<string, ThemePreset> = {
  dark: {
    name: 'dark',
    colors: {
      'bg-primary': '#1e1e1e',
      'fg-primary': '#d4d4d4',
      'bg-secondary': '#252526',
      'fg-secondary': '#808080',
      'accent': '#0e639c',
      'accent-hover': '#1177bb',
      'error': '#f44747',
      'border': '#3e3e42',
      'hover-bg': '#2d2d30',
      'overlay-bg': 'rgba(0, 0, 0, 0.7)',
      'shadow-color': 'rgba(0, 0, 0, 0.5)',
    },
  },
  light: {
    name: 'light',
    colors: {
      'bg-primary': '#ffffff',
      'fg-primary': '#333333',
      'bg-secondary': '#f3f3f3',
      'fg-secondary': '#6e6e6e',
      'accent': '#0066b8',
      'accent-hover': '#0078d4',
      'error': '#d32f2f',
      'border': '#e0e0e0',
      'hover-bg': '#e8e8e8',
      'overlay-bg': 'rgba(0, 0, 0, 0.4)',
      'shadow-color': 'rgba(0, 0, 0, 0.15)',
    },
  },
  tron: {
    name: 'tron',
    colors: {
      'bg-primary': '#0a0a2e',
      'fg-primary': '#00ffd5',
      'bg-secondary': '#0d0d3b',
      'fg-secondary': '#00b8ff',
      'accent': '#00b8ff',
      'accent-hover': '#00d4ff',
      'error': '#ff3366',
      'border': '#1a1a5e',
      'hover-bg': '#12124a',
      'overlay-bg': 'rgba(10, 10, 46, 0.85)',
      'shadow-color': 'rgba(0, 184, 255, 0.3)',
    },
  },
  cyberpunk: {
    name: 'cyberpunk',
    colors: {
      'bg-primary': '#1a0a2e',
      'fg-primary': '#ff2a6d',
      'bg-secondary': '#220e3d',
      'fg-secondary': '#b026ff',
      'accent': '#b026ff',
      'accent-hover': '#c94fff',
      'error': '#ff073a',
      'border': '#3d1a6e',
      'hover-bg': '#2a1248',
      'overlay-bg': 'rgba(26, 10, 46, 0.85)',
      'shadow-color': 'rgba(176, 38, 255, 0.3)',
    },
  },
  nord: {
    name: 'nord',
    colors: {
      'bg-primary': '#2e3440',
      'fg-primary': '#d8dee9',
      'bg-secondary': '#3b4252',
      'fg-secondary': '#a3be8c',
      'accent': '#88c0d0',
      'accent-hover': '#8fbcbb',
      'error': '#bf616a',
      'border': '#4c566a',
      'hover-bg': '#434c5e',
      'overlay-bg': 'rgba(46, 52, 64, 0.85)',
      'shadow-color': 'rgba(0, 0, 0, 0.4)',
    },
  },
  solarized: {
    name: 'solarized',
    colors: {
      'bg-primary': '#002b36',
      'fg-primary': '#839496',
      'bg-secondary': '#073642',
      'fg-secondary': '#586e75',
      'accent': '#268bd2',
      'accent-hover': '#2aa198',
      'error': '#dc322f',
      'border': '#094959',
      'hover-bg': '#0a4050',
      'overlay-bg': 'rgba(0, 43, 54, 0.85)',
      'shadow-color': 'rgba(0, 0, 0, 0.4)',
    },
  },
  monokai: {
    name: 'monokai',
    colors: {
      'bg-primary': '#272822',
      'fg-primary': '#f8f8f2',
      'bg-secondary': '#2d2e27',
      'fg-secondary': '#75715e',
      'accent': '#a6e22e',
      'accent-hover': '#b8f340',
      'error': '#f92672',
      'border': '#3e3d32',
      'hover-bg': '#3c3d37',
      'overlay-bg': 'rgba(39, 40, 34, 0.85)',
      'shadow-color': 'rgba(0, 0, 0, 0.4)',
    },
  },
  gruvbox: {
    name: 'gruvbox',
    colors: {
      'bg-primary': '#282828',
      'fg-primary': '#ebdbb2',
      'bg-secondary': '#3c3836',
      'fg-secondary': '#a89984',
      'accent': '#fabd2f',
      'accent-hover': '#fbd34d',
      'error': '#fb4934',
      'border': '#504945',
      'hover-bg': '#45403b',
      'overlay-bg': 'rgba(40, 40, 40, 0.85)',
      'shadow-color': 'rgba(0, 0, 0, 0.4)',
    },
  },
  dracula: {
    name: 'dracula',
    colors: {
      'bg-primary': '#282a36',
      'fg-primary': '#f8f8f2',
      'bg-secondary': '#343746',
      'fg-secondary': '#6272a4',
      'accent': '#bd93f9',
      'accent-hover': '#caa4fa',
      'error': '#ff5555',
      'border': '#44475a',
      'hover-bg': '#3c3f58',
      'overlay-bg': 'rgba(40, 42, 54, 0.85)',
      'shadow-color': 'rgba(0, 0, 0, 0.4)',
    },
  },
};

/** Custom user-defined presets loaded from /etc/themes */
const customPresets: Record<string, ThemePreset> = {};

/** Theme state interface */
interface ThemeState {
  config: ThemeConfig;
}

/** Default configuration (dark theme) */
const DEFAULT_CONFIG: ThemeConfig = {
  theme: "dark",
  colors: { ...PRESET_THEMES.dark.colors },
};

export const [themeState, setThemeState] = createStore<ThemeState>({
  config: { ...DEFAULT_CONFIG, colors: { ...DEFAULT_CONFIG.colors } }
});

/**
 * Get the current theme name
 */
export function getTheme(): string {
  return themeState.config.theme;
}

/**
 * Get the current theme configuration
 */
export function getThemeConfig(): ThemeConfig {
  return themeState.config;
}

/**
 * Get current color palette
 */
export function getColors(): ColorPalette {
  return themeState.config.colors;
}

/**
 * Get a single color value by key
 */
export function getColor(key: ColorKey): string {
  return themeState.config.colors[key];
}

/**
 * Map from our color keys to CSS variable names
 */
const COLOR_TO_CSS: Record<ColorKey, string> = {
  'bg-primary': '--bg-primary',
  'fg-primary': '--fg-primary',
  'bg-secondary': '--bg-secondary',
  'fg-secondary': '--fg-secondary',
  'accent': '--accent-primary',
  'accent-hover': '--accent-hover',
  'error': '--error-primary',
  'border': '--border-primary',
  'hover-bg': '--hover-bg',
  'overlay-bg': '--overlay-bg',
  'shadow-color': '--shadow-color',
};

/**
 * Apply all CSS variables from a color palette to the document
 */
function applyCSSVariables(colors: ColorPalette): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of COLOR_KEYS) {
    root.style.setProperty(COLOR_TO_CSS[key], colors[key]);
  }
}

/**
 * Set a single color and update live
 */
export function setColor(key: ColorKey, value: string): void {
  setThemeState("config", "colors", key, value);
  setThemeState("config", "theme", "custom");
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(COLOR_TO_CSS[key], value);
  }
  saveTheme(themeState.config);
}

/**
 * Apply a named preset theme
 */
export function applyPreset(name: string): boolean {
  const preset = PRESET_THEMES[name] || customPresets[name];
  if (!preset) return false;

  setThemeState("config", {
    theme: preset.name,
    colors: { ...preset.colors },
  });
  applyCSSVariables(preset.colors);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute("data-theme", preset.name);
  }
  saveTheme(themeState.config);
  return true;
}

/**
 * Set the theme by name (backward compat: 'dark' | 'light' or any preset name)
 */
export function setTheme(theme: string): void {
  const preset = PRESET_THEMES[theme] || customPresets[theme];
  if (preset) {
    applyPreset(theme);
  } else {
    // Fallback for backward compatibility
    setThemeState("config", "theme", theme);
    applyTheme(theme);
    saveTheme(themeState.config);
  }
}

/**
 * Toggle between light and dark themes
 */
export function toggleTheme(): string {
  const newTheme = themeState.config.theme === "dark" ? "light" : "dark";
  setTheme(newTheme);
  return newTheme;
}

/**
 * Apply theme to the document by setting data-theme attribute
 */
export function applyTheme(theme: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

/**
 * Get all preset names (built-in + custom)
 */
export function getAllPresetNames(): string[] {
  return [...Object.keys(PRESET_THEMES), ...Object.keys(customPresets)];
}

/**
 * Get a preset by name (built-in or custom)
 */
export function getPreset(name: string): ThemePreset | undefined {
  return PRESET_THEMES[name] || customPresets[name];
}

/**
 * Register a custom preset
 */
export function registerCustomPreset(name: string, preset: ThemePreset): void {
  customPresets[name] = preset;
}

/**
 * Get all custom presets
 */
export function getCustomPresets(): Record<string, ThemePreset> {
  return { ...customPresets };
}

/**
 * Initialize theme from persistence (localStorage)
 * Should be called on app startup
 */
export function initTheme(): void {
  const storedConfig = loadTheme();
  if (storedConfig) {
    setThemeState("config", storedConfig);
    applyCSSVariables(storedConfig.colors);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute("data-theme", storedConfig.theme);
    }
  } else {
    applyCSSVariables(DEFAULT_CONFIG.colors);
    applyTheme(DEFAULT_CONFIG.theme);
  }
}

/**
 * Load theme from localStorage on startup
 * Returns true if theme was loaded, false if using defaults
 */
export function loadPersistedTheme(): boolean {
  const storedConfig = loadTheme();
  if (storedConfig) {
    setThemeState("config", storedConfig);
    applyCSSVariables(storedConfig.colors);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute("data-theme", storedConfig.theme);
    }
    return true;
  }
  applyCSSVariables(DEFAULT_CONFIG.colors);
  applyTheme(DEFAULT_CONFIG.theme);
  return false;
}

/**
 * Reset to default dark theme
 */
export function resetTheme(): void {
  setThemeState("config", {
    theme: "dark",
    colors: { ...PRESET_THEMES.dark.colors },
  });
  applyCSSVariables(PRESET_THEMES.dark.colors);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  saveTheme(themeState.config);
}
