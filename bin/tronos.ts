#!/usr/bin/env node
/**
 * @fileoverview TronOS CLI entry point.
 *
 * This is the main entry point for running TronOS in CLI mode via npx tronos.
 * It creates a Node.js terminal interface and runs the shell engine.
 *
 * Usage:
 *   npx tronos
 *   bun run tronos
 *   npx tronos --real-fs                    # Mount home directory at /mnt/host
 *   npx tronos --real-fs /path/to/folder    # Mount specific folder
 *   npx tronos --real-fs --read-only        # Mount read-only
 *
 * @module bin/tronos
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { createNodeTerminalAPI } from '../src/cli/terminal';
import ShellEngine from '../src/engine/shell';
import { initStorage } from '../src/persistence/storage';
import type { HostMountConfig } from '../src/vfs/host';
import { VERSION_STRING } from '../src/version';

/**
 * Parse command line arguments.
 */
interface CLIArgs {
  realFs: boolean;
  hostPath?: string;
  readOnly: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    realFs: false,
    readOnly: false,
    help: false,
    version: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--real-fs':
      case '-r':
        result.realFs = true;
        // Check if next arg is a path (doesn't start with -)
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result.hostPath = path.resolve(args[i + 1]);
          i++;
        }
        break;
      case '--read-only':
      case '--ro':
        result.readOnly = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--version':
      case '-v':
        result.version = true;
        break;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`TronOS CLI - AI Operating System

Usage: tronos [options]

Options:
  --real-fs, -r [path]    Mount real filesystem at /mnt/host
                          If path is omitted, mounts user's home directory
  --read-only, --ro       Mount real filesystem as read-only
  --help, -h              Show this help message
  --version, -v           Show version information

Examples:
  tronos                           Start TronOS with virtual filesystem only
  tronos --real-fs                 Mount home directory at /mnt/host
  tronos --real-fs ~/projects      Mount ~/projects at /mnt/host
  tronos --real-fs /tmp --ro       Mount /tmp as read-only

Inside TronOS:
  ls /mnt/host                   List files in mounted directory
  cat /mnt/host/file.txt         Read a real file
  cp /mnt/host/file.txt ~/       Copy from real to virtual filesystem
`);
}

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(`TronOS CLI (${VERSION_STRING})`);
    process.exit(0);
  }

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Display version info
  console.log(`TronOS CLI (${VERSION_STRING})`);

  // Show mount info if --real-fs is enabled
  if (args.realFs) {
    const mountPath = args.hostPath ?? os.homedir();
    console.log(`Mounting real filesystem: ${mountPath} -> /mnt/host`);
    if (args.readOnly) {
      console.log('  (read-only mode)');
    }
  }

  console.log('Starting terminal...\n');

  // Initialize filesystem-based storage for CLI mode
  await initStorage('filesystem');

  // Prepare host mount config if --real-fs is enabled
  const hostMountConfig: HostMountConfig | undefined = args.realFs
    ? {
        hostPath: args.hostPath ?? os.homedir(),
        allowWrite: !args.readOnly
      }
    : undefined;

  // Create the Node.js terminal API adapter
  const terminalApi = createNodeTerminalAPI();

  // Create and boot the shell engine
  const shell = new ShellEngine(terminalApi, {
    skipBootAnimation: false, // Show boot animation in CLI
    hostMountConfig, // Pass host mount config if --real-fs is enabled
    onUIRequest: (request: string) => {
      // Handle UI requests in CLI mode
      // Most UI requests (like config modal) won't work in CLI
      if (request === 'showConfigModal') {
        terminalApi.writeln('\x1b[33mNote: Configuration UI is not available in CLI mode.\x1b[0m');
        terminalApi.writeln('Use environment variables to configure TronOS:');
        terminalApi.writeln('  ANTHROPIC_API_KEY - Set Anthropic API key');
        terminalApi.writeln('  OPENAI_API_KEY - Set OpenAI API key');
      }
    },
  });

  // Handle process termination gracefully
  process.on('SIGINT', () => {
    terminalApi.writeln('\n\x1b[33mReceived SIGINT. Shutting down...\x1b[0m');
    terminalApi.dispose();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    terminalApi.writeln('\n\x1b[33mReceived SIGTERM. Shutting down...\x1b[0m');
    terminalApi.dispose();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    terminalApi.writeln(`\n\x1b[31mUncaught exception: ${error.message}\x1b[0m`);
    terminalApi.dispose();
    process.exit(1);
  });

  try {
    // Boot the shell
    await shell.boot();
  } catch (error) {
    terminalApi.writeln(`\x1b[31mFailed to start TronOS: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
    terminalApi.dispose();
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
