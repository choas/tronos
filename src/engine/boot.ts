/**
 * @fileoverview Boot sequence animation for TronOS.
 *
 * Displays an animated boot sequence on startup with:
 * - TronOS ASCII art logo
 * - Simulated boot messages with delays
 * - Welcome message and help hint
 * - Skippable via any keypress
 *
 * @module engine/boot
 */

import type { TerminalAPI, KeyEvent } from '../terminal/api';
import { VERSION_STRING, REPO_URL } from '../version';

/**
 * TronOS ASCII art logo - Blocky 8-bit style
 *
 * Uses solid block characters (█ ▀ ▄) for a chunky retro look
 * inspired by C64/Amiga demoscene block fonts.
 * Each letter is 5 rows tall using full blocks for that
 * classic chunky computer look.
 * Width kept under 60 characters for mobile/narrow terminals.
 */
const TRONOS_LOGO = `\x1b[36m\x1b[1m
 ████▀ █▀▀▄  ▄▀▀▄  █▄  █  ▄▀▀▄  ▄▀▀▀
   █   █▄▄▀ █    █ █ █ █ █    █ ▀▀▀▄
   █   █  █  ▀▄▄▀  █  ▀█  ▀▄▄▀  ▄▄▄▀\x1b[0m
\x1b[90m              ${VERSION_STRING}\x1b[0m`;

/** Boot messages to display in sequence */
const BOOT_MESSAGES = [
  { text: 'Initializing kernel...', delay: 200 },
  { text: 'Loading virtual filesystem...', delay: 150 },
  { text: 'Mounting /proc...', delay: 100 },
  { text: 'Mounting /dev...', delay: 100 },
  { text: 'Starting session manager...', delay: 150 },
  { text: 'Loading user profile...', delay: 150 },
  { text: 'Initializing AI subsystem...', delay: 200 },
  { text: '\x1b[32mSystem ready.\x1b[0m', delay: 100 }
];

/** Welcome message shown after boot */
const WELCOME_MESSAGE = `
\x1b[1mWelcome to TronOS - The AI-Native Operating System\x1b[0m
Type '\x1b[33mhelp\x1b[0m' for available commands or '\x1b[33m@ai\x1b[0m' to chat with AI.
\x1b[90m${REPO_URL}\x1b[0m
`;

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Display the boot sequence animation.
 *
 * Shows the TronOS logo, simulated boot messages with delays, and a welcome message.
 * The animation can be skipped by pressing any key.
 *
 * @param term - Terminal API for output
 * @returns Promise that resolves when boot sequence completes or is skipped
 */
export async function displayBootSequence(term: TerminalAPI): Promise<void> {
  let skipped = false;

  // Set up key handler to detect skip
  const skipPromise = new Promise<void>((resolve) => {
    const disposable = term.onKey((_key: KeyEvent) => {
      skipped = true;
      disposable.dispose();
      resolve();
    });

    // Also set up data handler for paste events
    const dataDisposable = term.onData((_data: string) => {
      skipped = true;
      dataDisposable.dispose();
      disposable.dispose();
      resolve();
    });
  });

  // Clear screen and show logo
  term.clear();
  term.writeln(TRONOS_LOGO);
  term.writeln('');
  term.flush();

  // Display boot messages with delays
  for (const message of BOOT_MESSAGES) {
    if (skipped) break;

    // Show spinner while "processing"
    term.write(`  \x1b[90m[\x1b[0m\x1b[33m*\x1b[0m\x1b[90m]\x1b[0m ${message.text}`);
    term.flush();

    // Wait for delay or skip
    const delayPromise = sleep(message.delay);
    await Promise.race([delayPromise, skipPromise]);

    if (skipped) {
      term.writeln('');
      break;
    }

    // Move to next line
    term.writeln('');
    term.flush();
  }

  // Show welcome message
  term.writeln('');
  term.writeln(WELCOME_MESSAGE);
  term.flush();

  // Small final delay unless skipped
  if (!skipped) {
    const finalDelay = sleep(300);
    await Promise.race([finalDelay, skipPromise]);
  }
}

/**
 * Display a quick boot sequence (no animation).
 * Used when skip boot animation preference is enabled.
 *
 * @param term - Terminal API for output
 */
export function displayQuickBoot(term: TerminalAPI): void {
  term.clear();
  term.writeln(`\x1b[36mTronOS\x1b[0m - AI-Native Operating System \x1b[90m(${VERSION_STRING})\x1b[0m`);
  term.writeln('Type \'\x1b[33mhelp\x1b[0m\' for available commands.');
  term.writeln(`\x1b[90m${REPO_URL}\x1b[0m`);
  term.writeln('');
}
