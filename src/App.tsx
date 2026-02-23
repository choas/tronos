import { createSignal, createEffect, createRoot } from 'solid-js';
import TerminalComponent from './components/Terminal';
import { TabBar } from './components/TabBar';
import { StatusBar } from './components/StatusBar';
import { ConfigModal } from './components/ConfigModal';
import { MarketplaceModal } from './components/MarketplaceModal';
import { ResetDialog } from './components/ResetDialog';
import { Terminal } from '@xterm/xterm';
import { createTerminalAPI } from './terminal/api';
import ShellEngine from './engine/shell';
import { initDB, initStorage } from './persistence';
import { initSessions, getActiveSession, updateSession, loadPersistedAIConfig, loadEnvConfig, getAIConfig, loadPersistedTheme, loadPersistedBootConfig, loadPersistedTermsConfig } from './stores';
import { sessionState } from './stores/sessions';
import { importSession, parseDiskImage, mergeSession, formatMergeResult, diffDiskImage, recordImportHistory, type ConflictStrategy, type MergeConflict } from './engine/builtins/session';
import { performFactoryReset } from './engine/builtins/reset';
import { tpkg, getAuthStatus } from './engine/builtins/tpkg';

function App() {
  const [currentDirectory] = createSignal('/home/user');
  const [configModalOpen, setConfigModalOpen] = createSignal(false);
  const [marketplaceOpen, setMarketplaceOpen] = createSignal(false);
  const [resetDialogOpen, setResetDialogOpen] = createSignal(false);
  const aiModel = () => getAIConfig().model;
  let fileInputRef: HTMLInputElement | undefined;
  let mergeFileInputRef: HTMLInputElement | undefined;
  let diffFileInputRef: HTMLInputElement | undefined;
  let currentShell: ShellEngine | undefined;
  let pendingMergeStrategy: ConflictStrategy = 'interactive';
  let pendingConflictResolver: ((decision: 'overwrite' | 'skip') => void) | null = null;

  const handleFactoryReset = async () => {
    setResetDialogOpen(false);
    await performFactoryReset(currentShell ? { vfs: (currentShell as any).vfs } : undefined);
  };

  const handleImportFile = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    try {
      const jsonString = await file.text();
      const diskImage = parseDiskImage(jsonString);

      // Import the session (creates session, VFS, and restores files)
      const newSessionName = await importSession(diskImage);

      // Find the newly created session ID to record import history
      const sessions = Object.values((await import('./stores')).sessionState.sessions);
      const newSession = sessions.find(s => s.name === newSessionName);
      if (newSession) {
        await recordImportHistory(newSession.id, diskImage, true);
      }

      // Print success message to terminal if shell is available
      if (currentShell) {
        currentShell.writeOutput(`\nImported session '${newSessionName}' from ${file.name}\n`);
        currentShell.writeOutput(`Use 'session switch ${newSessionName}' to switch to it\n`);
      }
    } catch (error) {
      // Print error to terminal
      if (currentShell) {
        currentShell.writeOutput(`\nImport failed: ${(error as Error).message}\n`);
      }
      console.error("Import failed:", error);
    }

    // Reset the file input so the same file can be selected again
    target.value = "";
  };

  const handleMergeFile = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || !currentShell) return;

    try {
      const content = await file.text();
      const diskImage = parseDiskImage(content);
      const vfs = (currentShell as any).vfs;

      if (!vfs) {
        currentShell.writeOutput(`\nMerge failed: VFS not available\n`);
        return;
      }

      // Interactive resolver that prompts user in terminal
      const interactiveResolver = async (conflict: MergeConflict): Promise<'overwrite' | 'skip'> => {
        return new Promise((resolve) => {
          pendingConflictResolver = resolve;

          // Display conflict information
          const typeLabel = conflict.type === 'file' ? 'File' :
                           conflict.type === 'env' ? 'Environment variable' : 'Alias';
          currentShell!.writeOutput(`\n--- Conflict: ${typeLabel} "${conflict.path}" ---\n`);
          if (conflict.type === 'file') {
            currentShell!.writeOutput(`Current (${conflict.currentValue?.length || 0} chars): ${conflict.currentValue?.substring(0, 50)}${(conflict.currentValue?.length || 0) > 50 ? '...' : ''}\n`);
            currentShell!.writeOutput(`Incoming (${conflict.incomingValue?.length || 0} chars): ${conflict.incomingValue?.substring(0, 50)}${(conflict.incomingValue?.length || 0) > 50 ? '...' : ''}\n`);
          } else {
            currentShell!.writeOutput(`Current: ${conflict.currentValue}\n`);
            currentShell!.writeOutput(`Incoming: ${conflict.incomingValue}\n`);
          }
          currentShell!.writeOutput(`[o]verwrite / [s]kip? `);

          // Set up a one-time key handler for the decision
          const handleKey = (key: string) => {
            const lowerKey = key.toLowerCase();
            if (lowerKey === 'o') {
              currentShell!.writeOutput('overwrite\n');
              pendingConflictResolver = null;
              resolve('overwrite');
            } else if (lowerKey === 's') {
              currentShell!.writeOutput('skip\n');
              pendingConflictResolver = null;
              resolve('skip');
            }
            // Ignore other keys
          };

          // Register the handler with the shell
          (currentShell as any).setConflictResolver?.(handleKey);

          // Fallback: if no conflict resolver mechanism, default to skip after timeout
          setTimeout(() => {
            if (pendingConflictResolver) {
              currentShell!.writeOutput('(timeout - skipping)\n');
              pendingConflictResolver = null;
              resolve('skip');
            }
          }, 30000); // 30 second timeout
        });
      };

      // Perform the merge
      const resolver = pendingMergeStrategy === 'interactive' ? interactiveResolver : undefined;
      const result = await mergeSession(diskImage, vfs, pendingMergeStrategy, resolver);

      // Record import history for undo support
      const session = getActiveSession();
      await recordImportHistory(session.id, diskImage, false, result, pendingMergeStrategy);

      // Display results
      currentShell.writeOutput(`\n=== Merge Complete ===\n`);
      currentShell.writeOutput(formatMergeResult(result) + '\n');

      if (Object.keys(result.versionIds).length > 0) {
        currentShell.writeOutput(`\nTip: Use 'session import --undo' to revert overwritten files.\n`);
      }

      if (result.errors.length > 0) {
        currentShell.writeOutput(`\nMerge completed with ${result.errors.length} error(s)\n`);
      }
    } catch (error) {
      if (currentShell) {
        currentShell.writeOutput(`\nMerge failed: ${(error as Error).message}\n`);
      }
      console.error("Merge failed:", error);
    }

    // Reset the file input
    target.value = "";
  };

  const handleDiffFile = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || !currentShell) return;

    try {
      const content = await file.text();
      const diskImage = parseDiskImage(content);
      const vfs = (currentShell as any).vfs;
      const session = getActiveSession();

      if (!vfs) {
        currentShell.writeOutput(`\nDiff failed: VFS not available\n`);
        return;
      }

      // Perform the diff
      const diffOutput = diffDiskImage(diskImage, vfs, session.env, session.aliases);
      currentShell.writeOutput(`\n${diffOutput}\n`);
    } catch (error) {
      if (currentShell) {
        currentShell.writeOutput(`\nDiff failed: ${(error as Error).message}\n`);
      }
      console.error("Diff failed:", error);
    }

    // Reset the file input
    target.value = "";
  };

  const handleTerminalReady = async (term: Terminal) => {
    // Initialize database and storage abstraction layer
    await initDB();
    await initStorage('indexeddb');

    // Load sessions from persistence
    await initSessions();

    // Load AI config from environment variables first (takes precedence)
    // Then load from localStorage for any values not set by env vars
    const envConfigLoaded = loadEnvConfig();
    if (!envConfigLoaded) {
      // Only load from localStorage if no env vars were set
      loadPersistedAIConfig();
    }

    // Load theme from localStorage
    loadPersistedTheme();

    // Load boot config from localStorage
    loadPersistedBootConfig();

    // Load terms config from localStorage
    loadPersistedTermsConfig();

    const session = getActiveSession();
    const terminalApi = createTerminalAPI(term);

    // Create shell with session data and callbacks
    const shell = new ShellEngine(terminalApi, {
      session,
      onAliasChange: (aliases) => {
        // Persist aliases to the active session
        updateSession(session.id, { aliases });
      },
      onUIRequest: (request) => {
        // Handle UI requests from commands (e.g., config ui)
        if (request === 'showConfigModal') {
          setConfigModalOpen(true);
        } else if (request === 'showImportDialog') {
          // Trigger file input click to show file picker
          fileInputRef?.click();
        } else if (request.startsWith('showMergeDialog:')) {
          // Parse the merge strategy from the request
          const strategy = request.split(':')[1] as ConflictStrategy;
          pendingMergeStrategy = strategy;
          // Trigger merge file input click
          mergeFileInputRef?.click();
        } else if (request === 'showMarketplace') {
          setMarketplaceOpen(true);
        } else if (request === 'showFactoryResetDialog') {
          setResetDialogOpen(true);
        } else if (request.startsWith('showDiffDialog:')) {
          // Trigger diff file input click
          diffFileInputRef?.click();
        }
      }
    });
    currentShell = shell;

    // Track the initial session ID to detect switches
    let currentSessionId = session.id;

    // Reactively watch for session switches (from TabBar clicks or other sources)
    // Wrapped in createRoot since this runs inside an async callback (outside component's reactive scope)
    createRoot(() => {
      createEffect(() => {
        const activeId = sessionState.active;
        if (activeId !== currentSessionId && currentShell) {
          currentSessionId = activeId;
          const newSession = sessionState.sessions[activeId];
          if (newSession) {
            currentShell.switchToSession({
              fsNamespace: newSession.fsNamespace,
              env: newSession.env,
              aliases: newSession.aliases,
              history: newSession.history,
            });
          }
        }
      });
    });

    await shell.boot();
  };

  const getInstalledPackages = (): Set<string> => {
    try {
      const vfs = currentShell ? (currentShell as any).vfs : undefined;
      if (!vfs) return new Set();
      const raw = vfs.read('/etc/tpkg/installed.json');
      if (!raw) return new Set();
      const data = JSON.parse(raw);
      return new Set(Object.keys(data));
    } catch {
      return new Set();
    }
  };

  const handleMarketplaceInstall = async (name: string): Promise<boolean> => {
    if (!currentShell) return false;
    const session = getActiveSession();
    const result = await tpkg(['install', name], {
      env: session.env,
      vfs: (currentShell as any).vfs,
    } as any);
    if (result.stdout) currentShell.writeOutput(result.stdout);
    if (result.stderr) currentShell.writeOutput(result.stderr);
    return result.exitCode === 0;
  };

  const handleMarketplaceUninstall = async (name: string): Promise<boolean> => {
    if (!currentShell) return false;
    const session = getActiveSession();
    const result = await tpkg(['uninstall', name], {
      env: session.env,
      vfs: (currentShell as any).vfs,
    } as any);
    if (result.stdout) currentShell.writeOutput(result.stdout);
    if (result.stderr) currentShell.writeOutput(result.stderr);
    return result.exitCode === 0;
  };

  const getMarketplaceAuthStatus = (): { loggedIn: boolean; tier: string | null } | null => {
    if (!currentShell) return null;
    const vfs = (currentShell as any).vfs;
    if (!vfs) return null;
    const session = getActiveSession();
    return getAuthStatus({ env: session.env, vfs } as any);
  };

  const handleAuthLogin = () => {
    // Close marketplace and prompt user to run tpkg auth login in terminal
    setMarketplaceOpen(false);
    if (currentShell) {
      currentShell.writeOutput('\r\nRun \x1b[1mtpkg auth login\x1b[0m to authenticate for enterprise packages.\r\n\r\n');
    }
  };

  return (
    <div style={{
      display: 'flex',
      'flex-direction': 'column',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden'
    }}>
      {/* Hidden file input for session import - accepts both JSON and YAML formats */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".disk,.disk.yaml,.tronos,.yaml,.yml,application/json,application/x-yaml"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
      {/* Hidden file input for session merge - same file types */}
      <input
        ref={mergeFileInputRef}
        type="file"
        accept=".disk,.disk.yaml,.tronos,.yaml,.yml,application/json,application/x-yaml"
        style={{ display: 'none' }}
        onChange={handleMergeFile}
      />
      {/* Hidden file input for session diff - same file types */}
      <input
        ref={diffFileInputRef}
        type="file"
        accept=".disk,.disk.yaml,.tronos,.yaml,.yml,application/json,application/x-yaml"
        style={{ display: 'none' }}
        onChange={handleDiffFile}
      />
      <TabBar />
      <div style={{
        flex: '1',
        overflow: 'hidden',
        display: 'flex',
        'flex-direction': 'column'
      }}>
        <TerminalComponent onReady={handleTerminalReady} />
      </div>
      <StatusBar
        currentDirectory={currentDirectory()}
        aiModel={aiModel()}
        sessionName={getActiveSession().name}
      />
      <ConfigModal
        isOpen={configModalOpen()}
        onClose={() => setConfigModalOpen(false)}
      />
      <ResetDialog
        isOpen={resetDialogOpen()}
        onClose={() => setResetDialogOpen(false)}
        onConfirm={handleFactoryReset}
      />
      <MarketplaceModal
        isOpen={marketplaceOpen()}
        onClose={() => setMarketplaceOpen(false)}
        getInstalledPackages={getInstalledPackages}
        onInstall={handleMarketplaceInstall}
        onUninstall={handleMarketplaceUninstall}
        getAuthStatus={getMarketplaceAuthStatus}
        onAuthLogin={handleAuthLogin}
      />
    </div>
  );
}

export default App;
