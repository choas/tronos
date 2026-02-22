import { describe, it, expect, beforeEach, vi } from 'vitest';
import { theme } from '../src/engine/builtins/theme';
import {
  setThemeState,
  getTheme,
  setTheme,
  toggleTheme,
  getThemeConfig,
  getColors,
  setColor,
  applyPreset,
  resetTheme,
  getAllPresetNames,
  getPreset,
  PRESET_THEMES,
  COLOR_KEYS,
} from '../src/stores/theme';
import type { ExecutionContext } from '../src/engine/types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; })
  };
})();

// Mock document.documentElement with style.setProperty
const mockSetAttribute = vi.fn();
const mockSetProperty = vi.fn();

beforeEach(() => {
  // Reset to dark theme
  setThemeState("config", {
    theme: "dark",
    colors: { ...PRESET_THEMES.dark.colors },
  });
  localStorageMock.clear();
  mockSetAttribute.mockClear();
  mockSetProperty.mockClear();

  // Mock document for tests
  (globalThis as any).document = {
    documentElement: {
      setAttribute: mockSetAttribute,
      style: {
        setProperty: mockSetProperty,
      },
    }
  };
  (globalThis as any).localStorage = localStorageMock;
});

describe('theme store', () => {
  describe('getTheme', () => {
    it('should return current theme', () => {
      expect(getTheme()).toBe('dark');
    });
  });

  describe('getThemeConfig', () => {
    it('should return theme configuration object', () => {
      const config = getThemeConfig();
      expect(config.theme).toBe('dark');
      expect(config.colors).toBeDefined();
      expect(config.colors['bg-primary']).toBe('#1e1e1e');
    });
  });

  describe('setTheme', () => {
    it('should set theme to light', () => {
      setTheme('light');
      expect(getTheme()).toBe('light');
    });

    it('should set theme to dark', () => {
      setTheme('light');
      setTheme('dark');
      expect(getTheme()).toBe('dark');
    });

    it('should apply theme to document', () => {
      setTheme('light');
      expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should persist theme to localStorage', () => {
      setTheme('light');
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it('should apply CSS variables when setting a preset theme', () => {
      setTheme('tron');
      expect(mockSetProperty).toHaveBeenCalled();
      expect(getTheme()).toBe('tron');
    });
  });

  describe('toggleTheme', () => {
    it('should toggle from dark to light', () => {
      setThemeState("config", {
        theme: "dark",
        colors: { ...PRESET_THEMES.dark.colors },
      });
      const newTheme = toggleTheme();
      expect(newTheme).toBe('light');
      expect(getTheme()).toBe('light');
    });

    it('should toggle from light to dark', () => {
      setThemeState("config", {
        theme: "light",
        colors: { ...PRESET_THEMES.light.colors },
      });
      const newTheme = toggleTheme();
      expect(newTheme).toBe('dark');
      expect(getTheme()).toBe('dark');
    });
  });

  describe('getColors', () => {
    it('should return current color palette', () => {
      const colors = getColors();
      expect(colors['bg-primary']).toBe('#1e1e1e');
      expect(colors['accent']).toBe('#0e639c');
    });
  });

  describe('setColor', () => {
    it('should set a single color', () => {
      setColor('accent', '#ff0000');
      expect(getColors()['accent']).toBe('#ff0000');
      expect(getTheme()).toBe('custom');
    });

    it('should update CSS variable', () => {
      setColor('accent', '#ff0000');
      expect(mockSetProperty).toHaveBeenCalledWith('--accent-primary', '#ff0000');
    });
  });

  describe('applyPreset', () => {
    it('should apply a built-in preset', () => {
      const result = applyPreset('tron');
      expect(result).toBe(true);
      expect(getTheme()).toBe('tron');
      expect(getColors()['bg-primary']).toBe('#0a0a2e');
    });

    it('should return false for unknown preset', () => {
      const result = applyPreset('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('resetTheme', () => {
    it('should reset to dark theme', () => {
      setTheme('tron');
      resetTheme();
      expect(getTheme()).toBe('dark');
      expect(getColors()['bg-primary']).toBe('#1e1e1e');
    });
  });

  describe('getAllPresetNames', () => {
    it('should return all built-in preset names', () => {
      const names = getAllPresetNames();
      expect(names).toContain('dark');
      expect(names).toContain('light');
      expect(names).toContain('tron');
      expect(names).toContain('cyberpunk');
      expect(names).toContain('nord');
      expect(names).toContain('solarized');
      expect(names).toContain('monokai');
      expect(names).toContain('gruvbox');
      expect(names).toContain('dracula');
    });
  });

  describe('getPreset', () => {
    it('should return a preset by name', () => {
      const preset = getPreset('tron');
      expect(preset).toBeDefined();
      expect(preset?.name).toBe('tron');
      expect(preset?.colors['bg-primary']).toBe('#0a0a2e');
    });

    it('should return undefined for unknown preset', () => {
      expect(getPreset('nonexistent')).toBeUndefined();
    });
  });
});

describe('theme builtin command', () => {
  const createContext = (): ExecutionContext => ({
    stdin: '',
    env: {}
  });

  beforeEach(() => {
    setThemeState("config", {
      theme: "dark",
      colors: { ...PRESET_THEMES.dark.colors },
    });
  });

  describe('no arguments (show current)', () => {
    it('should display current theme', async () => {
      const result = await theme([], createContext());
      expect(result.stdout).toContain('Current theme: dark');
      expect(result.stdout).toContain('Colors:');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should display light theme when active', async () => {
      setThemeState("config", {
        theme: "light",
        colors: { ...PRESET_THEMES.light.colors },
      });
      const result = await theme([], createContext());
      expect(result.stdout).toContain('Current theme: light');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('toggle subcommand', () => {
    it('should toggle from dark to light', async () => {
      const result = await theme(['toggle'], createContext());
      expect(result.stdout).toBe('Theme switched to: light\n');
      expect(result.exitCode).toBe(0);
      expect(getTheme()).toBe('light');
    });

    it('should toggle from light to dark', async () => {
      setThemeState("config", {
        theme: "light",
        colors: { ...PRESET_THEMES.light.colors },
      });
      const result = await theme(['toggle'], createContext());
      expect(result.stdout).toBe('Theme switched to: dark\n');
      expect(result.exitCode).toBe(0);
      expect(getTheme()).toBe('dark');
    });
  });

  describe('dark subcommand', () => {
    it('should set theme to dark', async () => {
      setThemeState("config", {
        theme: "light",
        colors: { ...PRESET_THEMES.light.colors },
      });
      const result = await theme(['dark'], createContext());
      expect(result.stdout).toBe('Theme set to: dark\n');
      expect(result.exitCode).toBe(0);
      expect(getTheme()).toBe('dark');
    });
  });

  describe('light subcommand', () => {
    it('should set theme to light', async () => {
      const result = await theme(['light'], createContext());
      expect(result.stdout).toBe('Theme set to: light\n');
      expect(result.exitCode).toBe(0);
      expect(getTheme()).toBe('light');
    });
  });

  describe('apply subcommand', () => {
    it('should apply a named preset', async () => {
      const result = await theme(['apply', 'tron'], createContext());
      expect(result.stdout).toBe('Theme applied: tron\n');
      expect(result.exitCode).toBe(0);
      expect(getTheme()).toBe('tron');
    });

    it('should error for unknown preset', async () => {
      const result = await theme(['apply', 'nonexistent'], createContext());
      expect(result.stderr).toContain('Unknown preset: nonexistent');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('set subcommand', () => {
    it('should set a single color', async () => {
      const result = await theme(['set', 'accent', '#ff0000'], createContext());
      expect(result.stdout).toContain('Set accent = #ff0000');
      expect(result.exitCode).toBe(0);
    });

    it('should error for unknown color key', async () => {
      const result = await theme(['set', 'invalid-key', '#ff0000'], createContext());
      expect(result.stderr).toContain('Unknown color key');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('list subcommand', () => {
    it('should list all themes with dark as current', async () => {
      const result = await theme(['list'], createContext());
      expect(result.stdout).toContain('* dark (current)');
      expect(result.stdout).toContain('  light');
      expect(result.stdout).toContain('  tron');
      expect(result.exitCode).toBe(0);
    });

    it('should list all themes with light as current', async () => {
      setThemeState("config", {
        theme: "light",
        colors: { ...PRESET_THEMES.light.colors },
      });
      const result = await theme(['list'], createContext());
      expect(result.stdout).toContain('  dark');
      expect(result.stdout).toContain('* light (current)');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('preview subcommand', () => {
    it('should show color swatches for a preset', async () => {
      const result = await theme(['preview', 'tron'], createContext());
      expect(result.stdout).toContain('Preview: tron');
      expect(result.stdout).toContain('bg-primary');
      expect(result.stdout).toContain('#0a0a2e');
      expect(result.exitCode).toBe(0);
    });

    it('should error for unknown preset', async () => {
      const result = await theme(['preview', 'nonexistent'], createContext());
      expect(result.stderr).toContain('Unknown preset');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('reset subcommand', () => {
    it('should reset to dark theme', async () => {
      setTheme('tron');
      const result = await theme(['reset'], createContext());
      expect(result.stdout).toContain('reset to default');
      expect(result.exitCode).toBe(0);
      expect(getTheme()).toBe('dark');
    });
  });

  describe('invalid subcommand', () => {
    it('should return error for unknown command', async () => {
      const result = await theme(['invalid'], createContext());
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Unknown theme command: invalid');
      expect(result.exitCode).toBe(1);
    });
  });
});

describe('theme persistence', () => {
  it('should save theme configuration as JSON', () => {
    setTheme('light');
    expect(localStorageMock.setItem).toHaveBeenCalled();
    const savedValue = localStorageMock.setItem.mock.calls[localStorageMock.setItem.mock.calls.length - 1][1];
    const parsed = JSON.parse(savedValue);
    expect(parsed.theme).toBe('light');
    expect(parsed.colors).toBeDefined();
    expect(parsed.colors['bg-primary']).toBe('#ffffff');
  });
});
