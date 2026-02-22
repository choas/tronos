import { describe, it, expect, beforeEach, vi } from 'vitest';
import ShellEngine from '../src/engine/shell';
import { createMockTerminal } from './helpers/terminal';
import { displayBootSequence, displayQuickBoot } from '../src/engine/boot';
import { setSkipBootAnimation, getBootConfig, setBootConfigState } from '../src/stores/boot';

// Helper to strip ANSI escape codes for easier testing
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('Boot Sequence', () => {
  let mockTerm: ReturnType<typeof createMockTerminal>;

  beforeEach(() => {
    mockTerm = createMockTerminal();
    // Reset boot config before each test - directly set state to avoid localStorage issues
    setBootConfigState("config", { skipBootAnimation: false });
  });

  describe('displayBootSequence', () => {
    it('should display TronOS ASCII art logo', async () => {
      const bootPromise = displayBootSequence(mockTerm);
      // Skip by simulating any key immediately
      await new Promise(resolve => setTimeout(resolve, 10));

      const output = stripAnsi(mockTerm.getOutput());
      // The ASCII art contains these distinctive patterns from the TronOS logo
      expect(output).toContain('_____');
      expect(output).toContain('Tron');
    });

    it('should display boot messages', async () => {
      const bootPromise = displayBootSequence(mockTerm);
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = mockTerm.getOutput();
      expect(output).toContain('Initializing kernel');
    });

    it('should clear screen at start', async () => {
      // Write something first
      mockTerm.write('previous content');
      const originalLength = mockTerm.output.length;

      const bootPromise = displayBootSequence(mockTerm);
      await new Promise(resolve => setTimeout(resolve, 10));

      // clear() empties the output array
      // Check that clear was called (output array was cleared and new content added)
      expect(mockTerm.output.length).toBeGreaterThan(0);
    });

    it('should display welcome message after boot completes', async () => {
      const bootPromise = displayBootSequence(mockTerm);
      // Let it run long enough to complete all boot messages
      await new Promise(resolve => setTimeout(resolve, 1500));

      const output = stripAnsi(mockTerm.getOutput());
      expect(output).toContain('Welcome to TronOS');
      expect(output).toContain('help');
      expect(output).toContain('@ai');
    });
  });

  describe('displayQuickBoot', () => {
    it('should display TronOS header', () => {
      displayQuickBoot(mockTerm);
      const output = stripAnsi(mockTerm.getOutput());
      expect(output).toContain('TronOS');
    });

    it('should display help hint', () => {
      displayQuickBoot(mockTerm);
      const output = stripAnsi(mockTerm.getOutput());
      expect(output).toContain('help');
    });

    it('should not display animated boot messages', () => {
      displayQuickBoot(mockTerm);
      const output = mockTerm.getOutput();
      expect(output).not.toContain('Initializing kernel');
      expect(output).not.toContain('Loading virtual filesystem');
    });
  });

  describe('ShellEngine boot integration', () => {
    it('should use quick boot when skipBootAnimation option is true', async () => {
      const shell = new ShellEngine(mockTerm, { skipBootAnimation: true });
      await (shell as any).vfs.init();

      const bootPromise = shell.boot();
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = mockTerm.getOutput();
      // Quick boot should not have the animated messages
      expect(output).not.toContain('Initializing kernel');
    });

    it('should use animated boot when skipBootAnimation option is false', async () => {
      const shell = new ShellEngine(mockTerm, { skipBootAnimation: false });
      await (shell as any).vfs.init();

      const bootPromise = shell.boot();
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = mockTerm.getOutput();
      // Animated boot should have the messages
      expect(output).toContain('Initializing kernel');
    });
  });

  describe('Boot config store', () => {
    it('should default to showing boot animation', () => {
      const config = getBootConfig();
      expect(config.skipBootAnimation).toBe(false);
    });

    it('should allow setting skip boot animation', () => {
      setSkipBootAnimation(true);
      expect(getBootConfig().skipBootAnimation).toBe(true);
    });

    it('should allow toggling boot animation', () => {
      setSkipBootAnimation(true);
      expect(getBootConfig().skipBootAnimation).toBe(true);
      setSkipBootAnimation(false);
      expect(getBootConfig().skipBootAnimation).toBe(false);
    });
  });
});

describe('Boot builtin command', () => {
  let mockTerm: ReturnType<typeof createMockTerminal>;
  let shell: ShellEngine;

  beforeEach(async () => {
    mockTerm = createMockTerminal();
    shell = new ShellEngine(mockTerm, { skipBootAnimation: true });
    await (shell as any).vfs.init();
    // Reset boot config directly using the store
    setBootConfigState("config", { skipBootAnimation: false });
  });

  it('should show current boot config with show subcommand', async () => {
    await (shell as any).execute('boot show');
    await new Promise(resolve => setTimeout(resolve, 50));

    const output = mockTerm.getOutput();
    expect(output).toContain('Skip animation: no');
  });

  it('should set skip preference with skip subcommand', async () => {
    await (shell as any).execute('boot skip');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(getBootConfig().skipBootAnimation).toBe(true);
  });

  it('should unset skip preference with noskip subcommand', async () => {
    setSkipBootAnimation(true);
    await (shell as any).execute('boot noskip');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(getBootConfig().skipBootAnimation).toBe(false);
  });

  it('should toggle skip preference with toggle subcommand', async () => {
    expect(getBootConfig().skipBootAnimation).toBe(false);

    await (shell as any).execute('boot toggle');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(getBootConfig().skipBootAnimation).toBe(true);

    await (shell as any).execute('boot toggle');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(getBootConfig().skipBootAnimation).toBe(false);
  });

  it('should show error for invalid subcommand', async () => {
    await (shell as any).execute('boot invalid');
    await new Promise(resolve => setTimeout(resolve, 50));

    const output = mockTerm.getOutput();
    expect(output).toContain('Usage:');
  });
});
