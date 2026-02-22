import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import {
  getTheme,
  setTheme,
  toggleTheme,
  getColors,
  setColor,
  applyPreset,
  resetTheme,
  getAllPresetNames,
  getPreset,
  registerCustomPreset,
  COLOR_KEYS,
  type ColorKey,
  type ThemePreset,
} from "../../stores/theme";
import { refreshPresetGenerators } from "../../vfs/proc";

function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function err(stderr: string): CommandResult {
  return { stdout: "", stderr, exitCode: 1 };
}

const USAGE = `Usage: theme [subcommand]

Subcommands:
  (none)               Show current theme
  apply <preset>       Apply a named preset theme
  set <key> <value>    Set a single color value
  list                 List all available presets
  preview <preset>     Preview a preset's colors
  save <name>          Save current colors as a custom preset
  reset                Reset to default dark theme
  toggle               Toggle between dark and light
  dark                 Switch to dark theme
  light                Switch to light theme
`;

export const theme: BuiltinCommand = async (args: string[], context: ExecutionContext): Promise<CommandResult> => {
  const subcommand = args[0];

  // No args: show current theme and colors
  if (!subcommand) {
    const name = getTheme();
    const colors = getColors();
    let output = `Current theme: ${name}\n`;
    output += `\nColors:\n`;
    for (const key of COLOR_KEYS) {
      output += `  ${key}: ${colors[key]}\n`;
    }
    return ok(output);
  }

  switch (subcommand) {
    case "apply": {
      const presetName = args[1];
      if (!presetName) {
        return err("Usage: theme apply <preset>\nUse 'theme list' to see available presets.\n");
      }
      const success = applyPreset(presetName);
      if (!success) {
        return err(`Unknown preset: ${presetName}\nUse 'theme list' to see available presets.\n`);
      }
      return ok(`Theme applied: ${presetName}\n`);
    }

    case "set": {
      const colorKey = args[1];
      const colorValue = args[2];
      if (!colorKey || !colorValue) {
        return err("Usage: theme set <color-key> <hex>\n\nValid color keys:\n  " + COLOR_KEYS.join(", ") + "\n");
      }
      if (!COLOR_KEYS.includes(colorKey as ColorKey)) {
        return err(`Unknown color key: ${colorKey}\nValid keys: ${COLOR_KEYS.join(", ")}\n`);
      }
      setColor(colorKey as ColorKey, colorValue);
      return ok(`Set ${colorKey} = ${colorValue}\n`);
    }

    case "save": {
      const name = args[1];
      if (!name) {
        return err("Usage: theme save <name>\n");
      }
      const colors = getColors();
      const preset: ThemePreset = {
        name,
        colors: { ...colors },
      };
      registerCustomPreset(name, preset);
      refreshPresetGenerators();

      // Also save to /etc/themes/<name>.json in VFS
      if (context.vfs) {
        try {
          if (!context.vfs.exists('/etc/themes')) {
            context.vfs.mkdir('/etc/themes', true);
          }
          context.vfs.write(`/etc/themes/${name}.json`, JSON.stringify(preset, null, 2));
        } catch {
          // Non-fatal - preset is registered in memory regardless
        }
      }

      return ok(`Theme saved as: ${name}\n`);
    }

    case "list": {
      const currentTheme = getTheme();
      const presets = getAllPresetNames();
      let output = "Available themes:\n";
      for (const name of presets) {
        const marker = name === currentTheme ? "* " : "  ";
        const suffix = name === currentTheme ? " (current)" : "";
        output += `${marker}${name}${suffix}\n`;
      }
      return ok(output);
    }

    case "preview": {
      const presetName = args[1];
      if (!presetName) {
        return err("Usage: theme preview <preset>\n");
      }
      const preset = getPreset(presetName);
      if (!preset) {
        return err(`Unknown preset: ${presetName}\nUse 'theme list' to see available presets.\n`);
      }

      let output = `Preview: ${presetName}\n\n`;
      for (const key of COLOR_KEYS) {
        const hex = preset.colors[key];
        // Use ANSI escape codes to show the color as a swatch
        const rgb = hexToRgb(hex);
        if (rgb) {
          const { r, g, b } = rgb;
          const swatch = `\x1b[48;2;${r};${g};${b}m    \x1b[0m`;
          output += `  ${swatch} ${key}: ${hex}\n`;
        } else {
          output += `  [  ] ${key}: ${hex}\n`;
        }
      }
      return ok(output);
    }

    case "reset": {
      resetTheme();
      return ok("Theme reset to default (dark)\n");
    }

    case "toggle": {
      const newTheme = toggleTheme();
      return ok(`Theme switched to: ${newTheme}\n`);
    }

    case "dark":
    case "light": {
      setTheme(subcommand);
      return ok(`Theme set to: ${subcommand}\n`);
    }

    default: {
      // Check if it's a valid preset name (shorthand for apply)
      const presets = getAllPresetNames();
      if (presets.includes(subcommand)) {
        const success = applyPreset(subcommand);
        if (success) {
          return ok(`Theme applied: ${subcommand}\n`);
        }
      }

      return err(`Unknown theme command: ${subcommand}\n${USAGE}`);
    }
  }
};

/**
 * Parse a hex color string to RGB values.
 * Supports #RRGGBB and rgba(...) formats.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Handle rgba() format
  const rgbaMatch = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
    };
  }

  // Handle hex format
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}
