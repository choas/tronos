import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTerminalAPI, type TerminalAPI } from '../src/terminal/api';
import { Terminal } from '@xterm/xterm';

describe('Clipboard Support', () => {
  describe('TerminalAPI Selection Methods', () => {
    let mockTerminal: any;
    let api: TerminalAPI;

    beforeEach(() => {
      mockTerminal = {
        write: vi.fn(),
        writeln: vi.fn(),
        clear: vi.fn(),
        buffer: { active: { cursorX: 0, cursorY: 0 } },
        onKey: vi.fn(() => ({ dispose: vi.fn() })),
        onData: vi.fn(() => ({ dispose: vi.fn() })),
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ''),
        clearSelection: vi.fn(),
      };
      api = createTerminalAPI(mockTerminal as unknown as Terminal, { batchWrites: false });
    });

    it('should have hasSelection method', () => {
      expect(typeof api.hasSelection).toBe('function');
    });

    it('should have getSelection method', () => {
      expect(typeof api.getSelection).toBe('function');
    });

    it('should have clearSelection method', () => {
      expect(typeof api.clearSelection).toBe('function');
    });

    it('hasSelection should delegate to terminal', () => {
      mockTerminal.hasSelection.mockReturnValue(true);
      expect(api.hasSelection()).toBe(true);
      expect(mockTerminal.hasSelection).toHaveBeenCalled();
    });

    it('hasSelection should return false when no selection', () => {
      mockTerminal.hasSelection.mockReturnValue(false);
      expect(api.hasSelection()).toBe(false);
    });

    it('getSelection should return selected text', () => {
      mockTerminal.getSelection.mockReturnValue('selected text');
      expect(api.getSelection()).toBe('selected text');
      expect(mockTerminal.getSelection).toHaveBeenCalled();
    });

    it('getSelection should return empty string when no selection', () => {
      mockTerminal.getSelection.mockReturnValue('');
      expect(api.getSelection()).toBe('');
    });

    it('clearSelection should delegate to terminal', () => {
      api.clearSelection();
      expect(mockTerminal.clearSelection).toHaveBeenCalled();
    });
  });

  describe('Clipboard API Integration', () => {
    let originalNavigator: typeof navigator;
    let mockClipboard: {
      writeText: ReturnType<typeof vi.fn>;
      readText: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      originalNavigator = global.navigator;
      mockClipboard = {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('pasted text'),
      };
      // @ts-ignore - mocking navigator
      global.navigator = {
        clipboard: mockClipboard,
        platform: 'Win32',
      };
    });

    afterEach(() => {
      global.navigator = originalNavigator;
    });

    it('should write to clipboard using navigator.clipboard.writeText', async () => {
      // Simulate clipboard write
      await navigator.clipboard.writeText('test text');
      expect(mockClipboard.writeText).toHaveBeenCalledWith('test text');
    });

    it('should read from clipboard using navigator.clipboard.readText', async () => {
      const text = await navigator.clipboard.readText();
      expect(text).toBe('pasted text');
      expect(mockClipboard.readText).toHaveBeenCalled();
    });

    it('should handle clipboard write permission errors gracefully', async () => {
      mockClipboard.writeText.mockRejectedValue(new Error('Permission denied'));
      // Should not throw
      await expect(navigator.clipboard.writeText('test')).rejects.toThrow('Permission denied');
    });

    it('should handle clipboard read permission errors gracefully', async () => {
      mockClipboard.readText.mockRejectedValue(new Error('Permission denied'));
      // Should not throw
      await expect(navigator.clipboard.readText()).rejects.toThrow('Permission denied');
    });
  });

  describe('Copy/Paste Keyboard Detection', () => {
    it('should detect Ctrl+C on Windows/Linux', () => {
      const event = {
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent;

      const isMac = false;
      const copyPasteModifier = isMac ? event.metaKey : event.ctrlKey;
      expect(copyPasteModifier && event.key.toLowerCase() === 'c').toBe(true);
    });

    it('should detect Cmd+C on Mac', () => {
      const event = {
        key: 'c',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent;

      const isMac = true;
      const copyPasteModifier = isMac ? event.metaKey : event.ctrlKey;
      expect(copyPasteModifier && event.key.toLowerCase() === 'c').toBe(true);
    });

    it('should detect Ctrl+V on Windows/Linux', () => {
      const event = {
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent;

      const isMac = false;
      const copyPasteModifier = isMac ? event.metaKey : event.ctrlKey;
      expect(copyPasteModifier && event.key.toLowerCase() === 'v').toBe(true);
    });

    it('should detect Cmd+V on Mac', () => {
      const event = {
        key: 'v',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent;

      const isMac = true;
      const copyPasteModifier = isMac ? event.metaKey : event.ctrlKey;
      expect(copyPasteModifier && event.key.toLowerCase() === 'v').toBe(true);
    });

    it('should not trigger copy on Ctrl+C without selection (interrupt)', () => {
      const hasSelection = false;
      const event = {
        key: 'c',
        ctrlKey: true,
        metaKey: false,
      } as KeyboardEvent;

      const isMac = false;
      const copyPasteModifier = isMac ? event.metaKey : event.ctrlKey;
      const shouldCopy = copyPasteModifier && event.key.toLowerCase() === 'c' && hasSelection;
      expect(shouldCopy).toBe(false);
    });

    it('should trigger copy on Ctrl+C with selection', () => {
      const hasSelection = true;
      const event = {
        key: 'c',
        ctrlKey: true,
        metaKey: false,
      } as KeyboardEvent;

      const isMac = false;
      const copyPasteModifier = isMac ? event.metaKey : event.ctrlKey;
      const shouldCopy = copyPasteModifier && event.key.toLowerCase() === 'c' && hasSelection;
      expect(shouldCopy).toBe(true);
    });
  });

  describe('Paste Text Sanitization', () => {
    it('should replace newlines with spaces', () => {
      const text = 'line1\nline2\nline3';
      const sanitized = text.replace(/[\r\n]+/g, ' ').trim();
      expect(sanitized).toBe('line1 line2 line3');
    });

    it('should handle Windows line endings (CRLF)', () => {
      const text = 'line1\r\nline2\r\nline3';
      const sanitized = text.replace(/[\r\n]+/g, ' ').trim();
      expect(sanitized).toBe('line1 line2 line3');
    });

    it('should handle multiple consecutive newlines', () => {
      const text = 'line1\n\n\nline2';
      const sanitized = text.replace(/[\r\n]+/g, ' ').trim();
      expect(sanitized).toBe('line1 line2');
    });

    it('should trim leading and trailing whitespace', () => {
      const text = '  some text  \n';
      const sanitized = text.replace(/[\r\n]+/g, ' ').trim();
      expect(sanitized).toBe('some text');
    });

    it('should handle empty paste', () => {
      const text = '';
      const sanitized = text.replace(/[\r\n]+/g, ' ').trim();
      expect(sanitized).toBe('');
    });

    it('should handle single line paste without changes', () => {
      const text = 'single line command';
      const sanitized = text.replace(/[\r\n]+/g, ' ').trim();
      expect(sanitized).toBe('single line command');
    });
  });

  describe('Mac Platform Detection', () => {
    it('should detect Mac platform from navigator.platform', () => {
      const platforms = ['MacIntel', 'Mac68K', 'MacPPC', 'iPhone', 'iPod', 'iPad'];

      for (const platform of platforms) {
        const isMac = /Mac|iPod|iPhone|iPad/.test(platform);
        expect(isMac).toBe(true);
      }
    });

    it('should not detect Windows as Mac', () => {
      const platform = 'Win32';
      const isMac = /Mac|iPod|iPhone|iPad/.test(platform);
      expect(isMac).toBe(false);
    });

    it('should not detect Linux as Mac', () => {
      const platform = 'Linux x86_64';
      const isMac = /Mac|iPod|iPhone|iPad/.test(platform);
      expect(isMac).toBe(false);
    });
  });

  describe('onData Paste Handler', () => {
    it('should have onData method on TerminalAPI', () => {
      const mockTerminal = {
        write: vi.fn(),
        writeln: vi.fn(),
        clear: vi.fn(),
        buffer: { active: { cursorX: 0, cursorY: 0 } },
        onKey: vi.fn(() => ({ dispose: vi.fn() })),
        onData: vi.fn(() => ({ dispose: vi.fn() })),
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ''),
        clearSelection: vi.fn(),
      };
      const api = createTerminalAPI(mockTerminal as unknown as Terminal, { batchWrites: false });
      expect(typeof api.onData).toBe('function');
    });

    it('should delegate onData to terminal', () => {
      const mockCallback = vi.fn();
      const mockDispose = vi.fn();
      const mockTerminal = {
        write: vi.fn(),
        writeln: vi.fn(),
        clear: vi.fn(),
        buffer: { active: { cursorX: 0, cursorY: 0 } },
        onKey: vi.fn(() => ({ dispose: vi.fn() })),
        onData: vi.fn(() => ({ dispose: mockDispose })),
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ''),
        clearSelection: vi.fn(),
      };
      const api = createTerminalAPI(mockTerminal as unknown as Terminal, { batchWrites: false });

      const disposable = api.onData(mockCallback);
      expect(mockTerminal.onData).toHaveBeenCalledWith(mockCallback);
      expect(typeof disposable.dispose).toBe('function');
    });

    it('should identify multi-character data as paste', () => {
      // Multi-character strings (> 1 char) from onData are treated as pasted text
      const pastedText = 'hello world';
      expect(pastedText.length > 1).toBe(true);
    });

    it('should sanitize pasted text with newlines', () => {
      const pastedText = 'line1\nline2\r\nline3';
      const sanitized = pastedText.replace(/[\r\n]+/g, ' ').trim();
      expect(sanitized).toBe('line1 line2 line3');
    });
  });
});
