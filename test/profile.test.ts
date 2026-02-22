import { describe, it, expect, beforeEach } from 'vitest';
import ShellEngine from '../src/engine/shell';
import { createMockTerminal } from './helpers/terminal';

describe('.profile execution', () => {
  let shell: ShellEngine;
  let mockTerm: ReturnType<typeof createMockTerminal>;

  beforeEach(async () => {
    mockTerm = createMockTerminal();
    // Skip boot animation for faster tests
    shell = new ShellEngine(mockTerm, { skipBootAnimation: true });

    // Initialize VFS before tests (this creates default filesystem with /home/tronos)
    await (shell as any).vfs.init();
  });

  it('should execute .profile on boot if it exists', async () => {
    const vfs = (shell as any).vfs;

    // Overwrite the default .profile with test content
    vfs.write('/home/tronos/.profile', 'export TEST_VAR=hello\nexport ANOTHER_VAR=world');

    // Boot the shell (run in background, don't await the infinite loop)
    const bootPromise = shell.boot();

    // Wait a bit for boot to execute .profile
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify environment variables were set from .profile
    const env = (shell as any).env;
    expect(env.TEST_VAR).toBe('hello');
    expect(env.ANOTHER_VAR).toBe('world');
  });

  it('should skip comments and empty lines in .profile', async () => {
    const vfs = (shell as any).vfs;

    vfs.write('/home/tronos/.profile', '# This is a comment\n\nexport TEST_VAR=value\n# Another comment\n\nexport OTHER=test');

    const bootPromise = shell.boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    const env = (shell as any).env;
    expect(env.TEST_VAR).toBe('value');
    expect(env.OTHER).toBe('test');
  });

  it('should handle missing .profile gracefully', async () => {
    const vfs = (shell as any).vfs;

    // Remove the default .profile to simulate missing profile
    vfs.remove('/home/tronos/.profile');

    // Boot should succeed even without .profile
    const bootPromise = shell.boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Shell should still be operational
    const env = (shell as any).env;
    expect(env.HOME).toBe('/home/tronos');
    expect(env.PATH).toBe('/bin');
  });

  it('should handle .profile being a directory gracefully', async () => {
    const vfs = (shell as any).vfs;

    // Remove existing .profile file and create as directory instead
    vfs.remove('/home/tronos/.profile');
    vfs.mkdir('/home/tronos/.profile');

    // Boot should succeed even if .profile is a directory
    const bootPromise = shell.boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Shell should still be operational
    const env = (shell as any).env;
    expect(env.HOME).toBe('/home/tronos');
  });

  it('should execute aliases defined in .profile', async () => {
    const vfs = (shell as any).vfs;

    vfs.write('/home/tronos/.profile', 'alias gs=\'echo git status\'');

    const bootPromise = shell.boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    const aliases = (shell as any).aliases;
    expect(aliases.get('gs')).toBe('echo git status');
  });

  it('should execute multiple commands from .profile', async () => {
    const vfs = (shell as any).vfs;

    vfs.write('/home/tronos/.profile', 'export VAR1=a\nexport VAR2=b\nexport VAR3=c\nalias test=\'echo hello\'');

    const bootPromise = shell.boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    const env = (shell as any).env;
    expect(env.VAR1).toBe('a');
    expect(env.VAR2).toBe('b');
    expect(env.VAR3).toBe('c');

    const aliases = (shell as any).aliases;
    expect(aliases.get('test')).toBe('echo hello');
  });

  it('should handle errors in .profile gracefully', async () => {
    const vfs = (shell as any).vfs;

    // Create a .profile with a command that would error
    vfs.write('/home/tronos/.profile', 'export GOOD=value\ncd /nonexistent\nexport AFTER=stillworks');

    const bootPromise = shell.boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Good exports should still work
    const env = (shell as any).env;
    expect(env.GOOD).toBe('value');
    // Command after error should still execute
    expect(env.AFTER).toBe('stillworks');
  });

  it('should execute default .profile aliases on boot', async () => {
    // Test with the default .profile that is created by initDefaultFS()
    const bootPromise = shell.boot();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Default .profile contains: alias ll='ls -l', alias la='ls -la', alias ..='cd ..'
    const aliases = (shell as any).aliases;
    expect(aliases.get('ll')).toBe('ls -l');
    expect(aliases.get('la')).toBe('ls -la');
    expect(aliases.get('..')).toBe('cd ..');
  });
});
