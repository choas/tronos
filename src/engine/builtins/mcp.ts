/**
 * @fileoverview MCP builtin command for TronOS.
 *
 * Commands:
 *   mcp connect <name> <url>     — connect a server and mount it
 *   mcp list                     — show connected servers
 *   mcp disconnect <name>        — unmount and disconnect
 *   mcp tools <name>             — list tools for a server
 *   mcp invoke <name> <tool> [json] — invoke a tool directly
 *
 * @module engine/builtins/mcp
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import { getMCPClient } from "../../mcp/client";

export const mcp: BuiltinCommand = async (
  args: string[],
  context: ExecutionContext,
): Promise<CommandResult> => {
  if (args.length === 0) {
    return {
      stdout: "",
      stderr:
        "Usage: mcp <connect|list|disconnect|tools|invoke> [args...]\n" +
        "  mcp connect <name> <url>           Connect an MCP server\n" +
        "  mcp list                            Show connected servers\n" +
        "  mcp disconnect <name>               Disconnect a server\n" +
        "  mcp tools <name>                    List tools for a server\n" +
        "  mcp invoke <name> <tool> [json]     Invoke a tool\n",
      exitCode: 1,
    };
  }

  const subcommand = args[0];
  const client = getMCPClient();

  switch (subcommand) {
    case "connect": {
      const name = args[1];
      const url = args[2];
      if (!name || !url) {
        return {
          stdout: "",
          stderr: "Usage: mcp connect <name> <url>\n",
          exitCode: 1,
        };
      }

      // Show connecting message
      if (context.terminal) {
        context.terminal.write(`Connecting to ${name} at ${url}...`);
      }

      try {
        await client.connect(name, url);

        if (context.terminal) {
          context.terminal.write("\r\x1b[K");
        }

        const server = client.getServer(name);
        const toolCount = server?.tools.length || 0;

        // Save to /etc/mcp.json if VFS available
        if (context.vfs) {
          try {
            await saveMCPConfig(context);
          } catch {
            // Non-critical
          }
        }

        return {
          stdout: `Connected to ${name} (${toolCount} tools available)\nMounted at /proc/mcp/${name}/\n`,
          stderr: "",
          exitCode: 0,
        };
      } catch (err) {
        if (context.terminal) {
          context.terminal.write("\r\x1b[K");
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          stdout: "",
          stderr: `Failed to connect to ${name}: ${msg}\n`,
          exitCode: 1,
        };
      }
    }

    case "list": {
      const servers = client.listServers();
      if (servers.length === 0) {
        return {
          stdout:
            'No MCP servers connected.\nUse "mcp connect <name> <url>" to connect one.\n',
          stderr: "",
          exitCode: 0,
        };
      }

      const lines = ["NAME            STATUS       TOOLS  URL"];
      for (const server of servers) {
        const status =
          server.status === "connected"
            ? "\x1b[32mconnected\x1b[0m   "
            : server.status === "error"
              ? "\x1b[31merror\x1b[0m       "
              : `${server.status.padEnd(12)}`;
        lines.push(
          `${server.name.padEnd(16)}${status}${String(server.tools.length).padEnd(7)}${server.url}`,
        );
      }
      return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
    }

    case "disconnect": {
      const name = args[1];
      if (!name) {
        return {
          stdout: "",
          stderr: "Usage: mcp disconnect <name>\n",
          exitCode: 1,
        };
      }
      try {
        await client.disconnect(name);
        return {
          stdout: `Disconnected from ${name}\n`,
          stderr: "",
          exitCode: 0,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { stdout: "", stderr: `${msg}\n`, exitCode: 1 };
      }
    }

    case "tools": {
      const name = args[1];
      if (!name) {
        return { stdout: "", stderr: "Usage: mcp tools <name>\n", exitCode: 1 };
      }
      try {
        const tools = client.listTools(name);
        if (tools.length === 0) {
          return {
            stdout: `No tools available for ${name}.\n`,
            stderr: "",
            exitCode: 0,
          };
        }

        const lines = [`Tools for ${name}:\n`];
        for (const tool of tools) {
          lines.push(`  ${tool.name}`);
          if (tool.description) {
            lines.push(`    ${tool.description}`);
          }
        }
        return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { stdout: "", stderr: `${msg}\n`, exitCode: 1 };
      }
    }

    case "invoke": {
      const name = args[1];
      const tool = args[2];
      const jsonStr = args.slice(3).join(" ") || "{}";

      if (!name || !tool) {
        return {
          stdout: "",
          stderr: "Usage: mcp invoke <name> <tool> [json]\n",
          exitCode: 1,
        };
      }

      try {
        let input: unknown;
        try {
          input = JSON.parse(jsonStr);
        } catch {
          input = { input: jsonStr };
        }

        const result = await client.invokeTool(name, tool, input);
        return {
          stdout: JSON.stringify(result, null, 2) + "\n",
          stderr: "",
          exitCode: 0,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { stdout: "", stderr: `${msg}\n`, exitCode: 1 };
      }
    }

    default:
      return {
        stdout: "",
        stderr: `mcp: unknown subcommand: ${subcommand}\n`,
        exitCode: 1,
      };
  }
};

/**
 * Save MCP config to /etc/mcp.json
 */
async function saveMCPConfig(context: ExecutionContext): Promise<void> {
  const client = getMCPClient();
  const servers = client.listServers();
  const config = {
    servers: servers.map((s) => ({
      name: s.name,
      url: s.url,
      transport: s.transport,
      autoconnect: s.autoconnect,
    })),
  };

  if (context.vfs) {
    context.vfs.write("/etc/mcp.json", JSON.stringify(config, null, 2));
  }
}
