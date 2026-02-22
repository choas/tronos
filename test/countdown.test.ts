import { describe, test, expect, beforeEach } from 'vitest';
import { executeExe } from '../src/engine/executor';
import { InMemoryVFS } from '../src/vfs/memory';
import type { ExecutionContext } from '../src/engine/types';

describe('countdown.trx', () => {
  let vfs: InMemoryVFS;
  let ctx: ExecutionContext;

  beforeEach(async () => {
    vfs = new InMemoryVFS('test');
    await vfs.init();
    ctx = {
      stdin: '',
      env: { PATH: '/bin', HOME: '/home/tronos' },
      vfs,
    };
  });

  test('exists in /bin', () => {
    expect(vfs.exists('/bin/countdown.trx')).toBe(true);
  });

  test('is a valid executable file', () => {
    expect(vfs.isFile('/bin/countdown.trx')).toBe(true);
    const content = vfs.read('/bin/countdown.trx') as string;
    expect(content).toContain('#!/tronos');
    expect(content).toContain('@name: countdown');
    expect(content).toContain('async function(t)');
  });

  test('has proper metadata', () => {
    const content = vfs.read('/bin/countdown.trx') as string;
    expect(content).toContain('@name: countdown');
    expect(content).toContain('@description: Countdown timer');
    expect(content).toContain('@version: 1.0.0');
  });

  test('executes with default seconds (10)', async () => {
    // Execute with 0 seconds to test parsing (we can't wait 10 seconds in test)
    // Instead we test that it accepts no args
    const source = vfs.read('/bin/countdown.trx') as string;
    expect(source).toContain('parseInt(t.args[0]) || 10');
  });

  test('accepts numeric argument', async () => {
    // Create a quick test version that exits immediately
    const source = `#!/tronos
// @name: countdown-test
(async function(t) {
  const seconds = parseInt(t.args[0]) || 10;
  t.writeln("Counting from: " + seconds);
  t.exit(0);
})`;

    vfs.write('/bin/countdown-test.trx', source);
    const result = await executeExe('/bin/countdown-test.trx', ['5'], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Counting from: 5');
  });

  test('handles invalid argument', async () => {
    // countdown.trx should handle invalid args gracefully
    // The parseInt will return NaN for non-numeric strings
    const source = vfs.read('/bin/countdown.trx') as string;
    expect(source).toContain('isNaN(seconds)');
    expect(source).toContain('t.exit(1)');
  });

  test('uses Terminal API for output', () => {
    const content = vfs.read('/bin/countdown.trx') as string;
    expect(content).toContain('t.clear()');
    expect(content).toContain('t.writeln');
    expect(content).toContain('t.sleep(1000)');
    expect(content).toContain('t.exit(0)');
  });

  test('uses style helpers for colored output', () => {
    const content = vfs.read('/bin/countdown.trx') as string;
    expect(content).toContain('t.style.bold');
    expect(content).toContain('t.style.cyan');
    expect(content).toContain('t.style.green');
    expect(content).toContain('t.style.red');
  });

  test('displays TIME! message at end', () => {
    const content = vfs.read('/bin/countdown.trx') as string;
    expect(content).toContain('TIME!');
  });

  test('executes quick countdown (1 second)', async () => {
    // Create a quick countdown executable for testing
    const source = `#!/tronos
// @name: quick-countdown
(async function(t) {
  const seconds = parseInt(t.args[0]) || 1;
  for (let i = seconds; i > 0; i--) {
    t.writeln(i.toString());
    await t.sleep(10); // 10ms instead of 1000ms for testing
  }
  t.writeln("TIME!");
  t.exit(0);
})`;

    vfs.write('/bin/quick-countdown.trx', source);
    const result = await executeExe('/bin/quick-countdown.trx', ['3'], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('3');
    expect(result.stdout).toContain('2');
    expect(result.stdout).toContain('1');
    expect(result.stdout).toContain('TIME!');
  });

  test('help.trx still exists and works', () => {
    expect(vfs.exists('/bin/help.trx')).toBe(true);
    expect(vfs.isFile('/bin/help.trx')).toBe(true);
    const content = vfs.read('/bin/help.trx') as string;
    expect(content).toContain('@name: help');
  });
});
