/**
 * @fileoverview Agent builtin command for TronOS.
 *
 * Commands:
 *   agent start <name> "<goal>" [--read <globs>] [--write <globs>] [--every <interval>]
 *   agent list
 *   agent status <id>
 *   agent log <id>
 *   agent suspend <id>
 *   agent resume <id>
 *   agent kill <id>
 *   agent load <path>    — load a .agent manifest file
 *
 * @module engine/builtins/agent
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import {
  getAgentRuntime,
  parseTrigger,
  type AgentTrigger,
} from "../../agents/runtime";
import { parseGlobs, type AgentPermissions } from "../../agents/permissions";

export const agent: BuiltinCommand = async (
  args: string[],
  context: ExecutionContext,
): Promise<CommandResult> => {
  if (args.length === 0) {
    return {
      stdout: "",
      stderr:
        "Usage: agent <start|list|status|log|suspend|resume|kill|load> [args...]\n" +
        '  agent start <name> "<goal>" [--read <globs>] [--write <globs>] [--every <interval>]\n' +
        "  agent list                         List all agents\n" +
        "  agent status <id>                  Detailed status\n" +
        "  agent log <id>                     View action log\n" +
        "  agent suspend <id>                 Pause agent\n" +
        "  agent resume <id>                  Resume agent\n" +
        "  agent kill <id>                    Stop agent permanently\n" +
        "  agent load <path>                  Load .agent manifest\n",
      exitCode: 1,
    };
  }

  const subcommand = args[0];
  const runtime = getAgentRuntime();

  switch (subcommand) {
    case "start": {
      const name = args[1];
      if (!name) {
        return {
          stdout: "",
          stderr: 'Usage: agent start <name> "<goal>" [options...]\n',
          exitCode: 1,
        };
      }

      // Parse remaining args for goal and flags
      let goal = "";
      const permissions: AgentPermissions = {
        read: ["/proc/context/*"],
        write: [],
        mcp: [],
        network: false,
        spawn: false,
      };
      let trigger: AgentTrigger = { type: "manual" };

      let i = 2;
      while (i < args.length) {
        const arg = args[i];
        if (arg === "--read" && i + 1 < args.length) {
          permissions.read.push(...parseGlobs(args[++i]));
        } else if (arg === "--write" && i + 1 < args.length) {
          permissions.write.push(...parseGlobs(args[++i]));
        } else if (arg === "--mcp" && i + 1 < args.length) {
          permissions.mcp.push(...args[++i].split(",").map((s) => s.trim()));
        } else if (arg === "--every" && i + 1 < args.length) {
          trigger = parseTrigger(`@every ${args[++i]}`);
        } else if (arg === "--on-file" && i + 1 < args.length) {
          trigger = parseTrigger(`@file ${args[++i]}`);
        } else if (arg === "--on-context") {
          trigger = parseTrigger("@context-change");
        } else if (arg === "--network") {
          permissions.network = true;
        } else if (!goal) {
          // First non-flag argument after name is the goal
          goal = arg;
        } else {
          // Append to goal
          goal += " " + arg;
        }
        i++;
      }

      // Remove quotes from goal
      goal = goal.replace(/^["']|["']$/g, "").trim();

      if (!goal) {
        return { stdout: "", stderr: "Agent goal is required.\n", exitCode: 1 };
      }

      try {
        const id = await runtime.start(name, goal, permissions, trigger);
        const agent = runtime.getAgent(id)!;

        let output = `Agent started: ${name} (ID: ${id}, PID: ${agent.pid})\n`;
        output += `Goal: ${goal}\n`;
        output += `Trigger: ${trigger.type}${trigger.value ? ` (${trigger.value})` : ""}\n`;
        output += `Inspect: cat /proc/agents/${id}/status\n`;

        return { stdout: output, stderr: "", exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          stdout: "",
          stderr: `Failed to start agent: ${msg}\n`,
          exitCode: 1,
        };
      }
    }

    case "list": {
      const agents = runtime.listAgents();
      if (agents.length === 0) {
        return { stdout: "No agents running.\n", stderr: "", exitCode: 0 };
      }

      const lines = [
        "ID   PID   NAME                STATUS     TRIGGER       GOAL",
      ];
      for (const a of agents) {
        const statusColor =
          a.status === "running"
            ? "\x1b[32m"
            : a.status === "error"
              ? "\x1b[31m"
              : a.status === "suspended"
                ? "\x1b[33m"
                : "";
        const resetColor = statusColor ? "\x1b[0m" : "";
        const triggerStr =
          a.trigger.type + (a.trigger.value ? `(${a.trigger.value})` : "");
        const goalStr =
          a.goal.length > 40 ? a.goal.substring(0, 37) + "..." : a.goal;
        lines.push(
          `${a.id.padEnd(5)}${String(a.pid).padEnd(6)}${a.name.padEnd(20)}` +
            `${statusColor}${a.status.padEnd(11)}${resetColor}${triggerStr.padEnd(14)}${goalStr}`,
        );
      }
      return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "status": {
      const id = args[1];
      if (!id)
        return {
          stdout: "",
          stderr: "Usage: agent status <id>\n",
          exitCode: 1,
        };

      const a = runtime.getAgent(id);
      if (!a)
        return { stdout: "", stderr: `Agent not found: ${id}\n`, exitCode: 1 };

      const lines = [
        `Agent ${a.id} (${a.name})`,
        `  PID:        ${a.pid}`,
        `  Status:     ${a.status}`,
        `  Goal:       ${a.goal}`,
        `  Trigger:    ${a.trigger.type}${a.trigger.value ? ` (${a.trigger.value})` : ""}`,
        `  Created:    ${a.createdAt.toISOString()}`,
        `  Last run:   ${a.lastRunAt?.toISOString() || "never"}`,
        `  Log entries: ${a.log.length}`,
        `  Violations: ${a.violations.length}`,
        `  Read:       ${a.permissions.read.join(", ") || "(none)"}`,
        `  Write:      ${a.permissions.write.join(", ") || "(none)"}`,
        `  MCP:        ${a.permissions.mcp.join(", ") || "(none)"}`,
        `  Network:    ${a.permissions.network}`,
      ];
      return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "log": {
      const id = args[1];
      if (!id)
        return { stdout: "", stderr: "Usage: agent log <id>\n", exitCode: 1 };

      const a = runtime.getAgent(id);
      if (!a)
        return { stdout: "", stderr: `Agent not found: ${id}\n`, exitCode: 1 };

      if (a.log.length === 0) {
        return { stdout: "No log entries.\n", stderr: "", exitCode: 0 };
      }

      const lines = a.log.map((e) => JSON.stringify(e));
      return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "suspend": {
      const id = args[1];
      if (!id)
        return {
          stdout: "",
          stderr: "Usage: agent suspend <id>\n",
          exitCode: 1,
        };
      try {
        await runtime.suspend(id);
        return { stdout: `Agent ${id} suspended.\n`, stderr: "", exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { stdout: "", stderr: `${msg}\n`, exitCode: 1 };
      }
    }

    case "resume": {
      const id = args[1];
      if (!id)
        return {
          stdout: "",
          stderr: "Usage: agent resume <id>\n",
          exitCode: 1,
        };
      try {
        await runtime.resume(id);
        return { stdout: `Agent ${id} resumed.\n`, stderr: "", exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { stdout: "", stderr: `${msg}\n`, exitCode: 1 };
      }
    }

    case "kill": {
      const id = args[1];
      if (!id)
        return { stdout: "", stderr: "Usage: agent kill <id>\n", exitCode: 1 };
      try {
        await runtime.kill(id);
        return { stdout: `Agent ${id} killed.\n`, stderr: "", exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { stdout: "", stderr: `${msg}\n`, exitCode: 1 };
      }
    }

    case "load": {
      const filePath = args[1];
      if (!filePath)
        return {
          stdout: "",
          stderr: "Usage: agent load <path>\n",
          exitCode: 1,
        };
      if (!context.vfs)
        return {
          stdout: "",
          stderr: "Filesystem not available\n",
          exitCode: 1,
        };

      try {
        const resolved = context.vfs.resolve(filePath);
        if (!context.vfs.exists(resolved)) {
          return {
            stdout: "",
            stderr: `File not found: ${filePath}\n`,
            exitCode: 1,
          };
        }
        const source = await context.vfs.read(resolved);
        // Delegate to manifest parser (Phase 4)
        const { parseAgentManifest, startFromManifest } =
          await import("../../agents/manifest");
        const manifest = parseAgentManifest(source);
        if (!manifest.success) {
          return {
            stdout: "",
            stderr: `Parse error: ${manifest.error}\n`,
            exitCode: 1,
          };
        }
        const id = await startFromManifest(manifest, context.vfs);
        return {
          stdout: `Loaded agent from ${filePath} (ID: ${id})\n`,
          stderr: "",
          exitCode: 0,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          stdout: "",
          stderr: `Failed to load agent: ${msg}\n`,
          exitCode: 1,
        };
      }
    }

    default:
      return {
        stdout: "",
        stderr: `agent: unknown subcommand: ${subcommand}\n`,
        exitCode: 1,
      };
  }
};
