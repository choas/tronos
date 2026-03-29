/**
 * @fileoverview Event builtin command for TronOS.
 *
 * Commands:
 *   event watch <path> <event-type> --call <command>
 *   event list
 *   event unwatch <id>
 *   event log [limit]
 *
 * @module engine/builtins/event
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import {
  getEventBus,
  type EventPattern,
  type OSEvent,
  type OSEventType,
} from "../../events/bus";
import { tokenize, buildAST } from "../parser";
import { executeCommand } from "../executor";

export const event: BuiltinCommand = async (
  args: string[],
  context: ExecutionContext,
): Promise<CommandResult> => {
  if (args.length === 0) {
    return {
      stdout: "",
      stderr:
        "Usage: event <watch|list|unwatch|log> [args...]\n" +
        "  event watch <path> <event-type> --call <command>\n" +
        "  event list\n" +
        "  event unwatch <id>\n" +
        "  event log [limit]\n",
      exitCode: 1,
    };
  }

  const subcommand = args[0];
  const bus = getEventBus();

  switch (subcommand) {
    case "watch": {
      // event watch <path> <event-type> --call <command>
      // or: event watch <path> --call <command> (defaults to file-changed)
      let pathPattern: string | undefined;
      let eventType: OSEventType = "file-changed";
      let command: string | undefined;

      let i = 1;
      while (i < args.length) {
        if (args[i] === "--call" && i + 1 < args.length) {
          command = args.slice(i + 1).join(" ");
          break;
        } else if (!pathPattern) {
          pathPattern = args[i];
        } else {
          // Could be event type
          const types: OSEventType[] = [
            "file-changed",
            "context-changed",
            "agent-action",
            "mcp-result",
            "session-start",
            "network-change",
          ];
          if (types.includes(args[i] as OSEventType)) {
            eventType = args[i] as OSEventType;
          }
        }
        i++;
      }

      if (!pathPattern || !command) {
        return {
          stdout: "",
          stderr: "Usage: event watch <path> [event-type] --call <command>\n",
          exitCode: 1,
        };
      }

      const pattern: EventPattern = { type: eventType };
      pattern.path = pathPattern;

      const id = bus.subscribe(
        pattern,
        (evt: OSEvent, cmd?: string) => {
          // Terminal may be closed between subscription and invocation;
          // read a fresh reference each time and bail if unavailable.
          const terminal = context.terminal;
          if (!terminal) return;

          // Log event to terminal
          terminal.writeln(
            `\x1b[33m[event] ${evt.type}: ${JSON.stringify(evt.payload)}\x1b[0m`,
          );

          // Execute the stored --call command if provided
          if (cmd) {
            (async () => {
              try {
                const tokens = tokenize(cmd);
                const commands = buildAST(tokens);
                for (const parsed of commands) {
                  const result = await executeCommand(parsed, context);
                  // Re-check terminal before each write; it may close mid-loop
                  const term = context.terminal;
                  if (!term) break;
                  if (result.stdout) {
                    term.writeln(result.stdout.replace(/\n$/, ""));
                  }
                  if (result.stderr) {
                    term.writeln(
                      `\x1b[31m${result.stderr.replace(/\n$/, "")}\x1b[0m`,
                    );
                  }
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const term = context.terminal;
                if (term) {
                  term.writeln(`\x1b[31m[event] command error: ${msg}\x1b[0m`);
                }
              }
            })();
          }
        },
        command,
      );

      return {
        stdout: `Watching ${eventType}${pathPattern ? ` on ${pathPattern}` : ""}${command ? ` → ${command}` : ""}\nSubscription ID: ${id}\n`,
        stderr: "",
        exitCode: 0,
      };
    }

    case "list": {
      const subs = bus.getSubscriptions();
      if (subs.length === 0) {
        return {
          stdout: "No active event subscriptions.\n",
          stderr: "",
          exitCode: 0,
        };
      }

      const lines = ["ID            TYPE             PATH             COMMAND"];
      for (const sub of subs) {
        const type = sub.pattern.type || "*";
        const path = sub.pattern.path || "*";
        const cmd = sub.command || "-";
        lines.push(
          `${sub.id.padEnd(14)}${type.padEnd(17)}${path.padEnd(17)}${cmd}`,
        );
      }
      return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "unwatch": {
      const id = args[1];
      if (!id) {
        return {
          stdout: "",
          stderr: "Usage: event unwatch <id>\n",
          exitCode: 1,
        };
      }
      const removed = bus.unsubscribe(id);
      return {
        stdout: removed ? `Removed subscription ${id}\n` : "",
        stderr: removed ? "" : `Subscription not found: ${id}\n`,
        exitCode: removed ? 0 : 1,
      };
    }

    case "log": {
      const parsed = parseInt(args[1]);
      const limit = !Number.isNaN(parsed) && parsed >= 0 ? parsed : 50;
      const history = bus.getHistory(limit);
      if (history.length === 0) {
        return { stdout: "No events recorded.\n", stderr: "", exitCode: 0 };
      }
      const lines = history.map((e) => JSON.stringify(e));
      return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    default:
      return {
        stdout: "",
        stderr: `event: unknown subcommand: ${subcommand}\n`,
        exitCode: 1,
      };
  }
};
