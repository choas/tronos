import { describe, it, expect, beforeEach } from 'vitest';
import {
  readWorkspace,
  writeWorkspace,
  readFocus,
  readHistory,
  updateFocus,
  appendShellHistory,
  appendAIHistory,
  extractFilesFromCommand,
  setActiveSession,
  getContextState,
} from '../src/context/state';

describe('Context Bus', () => {
  beforeEach(() => {
    setActiveSession('test-context-' + Date.now());
  });

  describe('workspace', () => {
    it('should read default workspace as JSON', () => {
      const ws = readWorkspace();
      const parsed = JSON.parse(ws);
      expect(parsed).toHaveProperty('updated');
    });

    it('should write and read JSON workspace', () => {
      writeWorkspace(JSON.stringify({ description: 'Test task', files: ['/test.txt'] }));
      const ws = JSON.parse(readWorkspace());
      expect(ws.description).toBe('Test task');
      expect(ws.files).toEqual(['/test.txt']);
      expect(ws.updated).toBeDefined();
    });

    it('should handle non-JSON workspace input gracefully', () => {
      writeWorkspace('just a plain string');
      const ws = JSON.parse(readWorkspace());
      expect(ws.description).toBe('just a plain string');
    });
  });

  describe('focus', () => {
    it('should read default focus', () => {
      const focus = JSON.parse(readFocus());
      expect(focus.last_command).toBe('');
      expect(focus.cwd).toBe('/home/tronos');
      expect(focus.recent_files).toEqual([]);
    });

    it('should update focus after command', () => {
      updateFocus('cat report.md', '/home/user', ['/home/user/report.md']);
      const focus = JSON.parse(readFocus());
      expect(focus.last_command).toBe('cat report.md');
      expect(focus.cwd).toBe('/home/user');
      expect(focus.recent_files).toContain('/home/user/report.md');
    });

    it('should maintain sliding window of recent files', () => {
      for (let i = 0; i < 15; i++) {
        updateFocus(`cat file${i}.txt`, '/home', [`/home/file${i}.txt`]);
      }
      const focus = JSON.parse(readFocus());
      expect(focus.recent_files.length).toBeLessThanOrEqual(10);
    });
  });

  describe('history', () => {
    it('should start with empty history', () => {
      expect(readHistory()).toBe('');
    });

    it('should append shell history entries', () => {
      appendShellHistory('ls -la', '/home');
      appendShellHistory('cat file.txt', '/home');
      const lines = readHistory().trim().split('\n');
      expect(lines.length).toBe(2);
      const entry = JSON.parse(lines[0]);
      expect(entry.type).toBe('shell');
      expect(entry.cmd).toBe('ls -la');
    });

    it('should append AI history entries', () => {
      appendAIHistory('summarize this', '/home', '{"mode":"chat"}');
      const lines = readHistory().trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      expect(lastEntry.type).toBe('ai');
      expect(lastEntry.prompt).toBe('summarize this');
    });
  });

  describe('extractFilesFromCommand', () => {
    it('should extract file paths from cat command', () => {
      const files = extractFilesFromCommand('cat report.md', '/home');
      expect(files).toContain('/home/report.md');
    });

    it('should extract absolute paths', () => {
      const files = extractFilesFromCommand('cat /etc/motd', '/home');
      expect(files).toContain('/etc/motd');
    });

    it('should skip flags', () => {
      const files = extractFilesFromCommand('ls -la /home', '/');
      expect(files).toContain('/home');
    });

    it('should stop at pipe operators', () => {
      const files = extractFilesFromCommand('cat file.txt | grep hello', '/home');
      expect(files).toEqual(['/home/file.txt']);
    });
  });

  describe('getContextState', () => {
    it('should return full context state', () => {
      const state = getContextState();
      expect(state).toHaveProperty('workspace');
      expect(state).toHaveProperty('focus');
      expect(state).toHaveProperty('history');
    });
  });
});
