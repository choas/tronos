import type { BuiltinCommand } from '../types';
import { getDB } from '../../persistence/db';
import { clearAIConfig } from '../../persistence/config';
import { clearTheme } from '../../persistence/theme';
import { clearTermsConfig } from '../../persistence/terms';
import { removeBatchManager } from '../../persistence/batch';

/**
 * Factory reset command - restores AIOS to its default state.
 *
 * Usage:
 *   reset           - Prompts for confirmation before resetting
 *   reset --force   - Resets immediately without confirmation
 *   reset -f        - Alias for --force
 *
 * The reset command:
 * 1. Clears all IndexedDB data (files, sessions, config)
 * 2. Clears localStorage (AI config, theme preferences)
 * 3. Reloads the application to reinitialize with defaults
 */
export const reset: BuiltinCommand = async (args, context) => {
  // Check for --force or -f flag
  let force = false;

  for (const arg of args) {
    if (arg === '-f' || arg === '--force') {
      force = true;
    } else if (arg.startsWith('-')) {
      return {
        stdout: '',
        stderr: `reset: invalid option '${arg}'\nUsage: reset [--force|-f]`,
        exitCode: 1
      };
    }
  }

  // If not forced, request confirmation via UI
  if (!force) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      uiRequest: 'showFactoryResetDialog'
    };
  }

  // Perform factory reset
  return await performFactoryReset(context);
};

/**
 * Performs the actual factory reset operation.
 * Exported so it can be called from the UI confirmation dialog.
 */
export async function performFactoryReset(context?: { vfs?: any }): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    // Step 1: Clear IndexedDB stores
    try {
      const db = getDB();

      // Clear files store
      const filesTx = db.transaction('files', 'readwrite');
      await filesTx.store.clear();
      await filesTx.done;

      // Clear sessions store
      const sessionsTx = db.transaction('sessions', 'readwrite');
      await sessionsTx.store.clear();
      await sessionsTx.done;

      // Clear config store
      const configTx = db.transaction('config', 'readwrite');
      await configTx.store.clear();
      await configTx.done;
    } catch (dbError) {
      // Database might not be initialized in test environment
      console.warn('Failed to clear IndexedDB:', dbError);
    }

    // Step 2: Clear localStorage
    try {
      clearAIConfig();
      clearTheme();
      clearTermsConfig();
    } catch (localStorageError) {
      console.warn('Failed to clear localStorage:', localStorageError);
    }

    // Step 3: Remove any batch managers
    if (context?.vfs?.namespace) {
      removeBatchManager(context.vfs.namespace);
    }

    // Step 4: Reload the application
    if (typeof window !== 'undefined' && window.location) {
      // Brief delay to allow message display
      setTimeout(() => {
        // Re-check window.location in case it becomes undefined (test environments)
        if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
          window.location.reload();
        }
      }, 500);
    }

    return {
      stdout: 'Factory reset complete. Reloading application...\n',
      stderr: '',
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: `reset: ${(error as Error).message}`,
      exitCode: 1
    };
  }
}

// Alias for 'factory-reset' command
export const factoryReset: BuiltinCommand = reset;
