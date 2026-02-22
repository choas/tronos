import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import { getBootConfig, setSkipBootAnimation } from "../../stores/boot";

/**
 * Boot configuration command.
 * Controls the boot sequence animation behavior.
 *
 * Usage:
 *   boot                - Show current boot configuration
 *   boot show           - Show current boot configuration
 *   boot skip           - Skip boot animation on next startup
 *   boot noskip         - Show boot animation on next startup
 *   boot toggle         - Toggle boot animation skip preference
 */
export const boot: BuiltinCommand = async (args: string[], _context: ExecutionContext): Promise<CommandResult> => {
  const subcommand = args[0] || "show";

  switch (subcommand) {
    case "show": {
      const cfg = getBootConfig();
      const skipStatus = cfg.skipBootAnimation ? "yes (animation skipped)" : "no (animation shown)";
      const output = [
        "Boot Configuration:",
        `  Skip animation: ${skipStatus}`,
        "",
        "Commands:",
        "  boot skip    - Skip boot animation on startup",
        "  boot noskip  - Show boot animation on startup",
        "  boot toggle  - Toggle the skip preference"
      ].join("\n");

      return { stdout: output + "\n", stderr: "", exitCode: 0 };
    }

    case "skip": {
      setSkipBootAnimation(true);
      return {
        stdout: "Boot animation will be skipped on next startup.\n",
        stderr: "",
        exitCode: 0
      };
    }

    case "noskip": {
      setSkipBootAnimation(false);
      return {
        stdout: "Boot animation will be shown on next startup.\n",
        stderr: "",
        exitCode: 0
      };
    }

    case "toggle": {
      const current = getBootConfig().skipBootAnimation;
      setSkipBootAnimation(!current);
      const newStatus = !current ? "skipped" : "shown";
      return {
        stdout: `Boot animation will be ${newStatus} on next startup.\n`,
        stderr: "",
        exitCode: 0
      };
    }

    default:
      return {
        stdout: "",
        stderr: "Usage: boot [show|skip|noskip|toggle]\n",
        exitCode: 1
      };
  }
};
