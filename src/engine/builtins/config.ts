import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import {
  getAIConfig,
  setAIConfig,
  setAIProvider,
  resetAIConfig,
  maskApiKey
} from "../../stores";
import type { AIProvider } from "../../stores";

const VALID_KEYS = ["provider", "model", "baseURL", "apiKey", "temperature", "maxTokens"] as const;
const VALID_PROVIDERS: AIProvider[] = ["tronos", "anthropic", "openai", "ollama", "openrouter"];

export const config: BuiltinCommand = async (args: string[], _context: ExecutionContext): Promise<CommandResult> => {
  const subcommand = args[0] || "show";

  switch (subcommand) {
    case "show": {
      const cfg = getAIConfig();
      const maskedKey = cfg.apiKey ? maskApiKey(cfg.apiKey) : "(not set)";
      const output = [
        `provider: ${cfg.provider}`,
        `model: ${cfg.model}`,
        `baseURL: ${cfg.baseURL}`,
        `apiKey: ${maskedKey}`,
        `temperature: ${cfg.temperature}`,
        `maxTokens: ${cfg.maxTokens}`
      ].join("\n");

      return { stdout: output + "\n", stderr: "", exitCode: 0 };
    }

    case "set": {
      const key = args[1];
      const value = args.slice(2).join(" ");

      if (!key || !value) {
        return {
          stdout: "",
          stderr: "Usage: config set <key> <value>\n",
          exitCode: 1
        };
      }

      if (!VALID_KEYS.includes(key as typeof VALID_KEYS[number])) {
        return {
          stdout: "",
          stderr: `Invalid key: ${key}. Valid keys: ${VALID_KEYS.join(", ")}\n`,
          exitCode: 1
        };
      }

      // Handle provider specially - use setAIProvider to apply defaults
      if (key === "provider") {
        if (!VALID_PROVIDERS.includes(value as AIProvider)) {
          return {
            stdout: "",
            stderr: `Invalid provider: ${value}. Valid providers: ${VALID_PROVIDERS.join(", ")}\n`,
            exitCode: 1
          };
        }
        setAIProvider(value as AIProvider);
        let output = `Set provider = ${value}\n`;
        if (value === "ollama") {
          const origin = typeof window !== "undefined" ? window.location.origin : "*";
          output += `\nNote: Ollama requires CORS to be enabled for ${origin}.\n`;
          output += `Quit the Ollama desktop app first, then run from terminal:\n`;
          output += `  OLLAMA_ORIGINS="${origin}" ollama serve\n`;
        }
        return {
          stdout: output,
          stderr: "",
          exitCode: 0
        };
      }

      // Parse numeric values
      let parsedValue: string | number = value;
      if (key === "temperature") {
        parsedValue = parseFloat(value);
        if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 2) {
          return {
            stdout: "",
            stderr: "Temperature must be a number between 0 and 2\n",
            exitCode: 1
          };
        }
      }
      if (key === "maxTokens") {
        parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue) || parsedValue < 1) {
          return {
            stdout: "",
            stderr: "maxTokens must be a positive integer\n",
            exitCode: 1
          };
        }
      }

      setAIConfig({ [key]: parsedValue });

      // Mask the API key in output
      const displayValue = key === "apiKey" ? maskApiKey(String(parsedValue)) : parsedValue;
      return {
        stdout: `Set ${key} = ${displayValue}\n`,
        stderr: "",
        exitCode: 0
      };
    }

    case "reset": {
      const currentProvider = getAIConfig().provider;
      resetAIConfig();
      return {
        stdout: `Configuration reset to defaults for provider '${currentProvider}'\n`,
        stderr: "",
        exitCode: 0
      };
    }

    case "ui": {
      // The ui subcommand triggers the config modal in the UI
      return {
        stdout: "Opening configuration UI...\n",
        stderr: "",
        exitCode: 0,
        uiRequest: "showConfigModal"
      };
    }

    default:
      return {
        stdout: "",
        stderr: "Usage: config [show|set <key> <value>|reset|ui]\n",
        exitCode: 1
      };
  }
};
