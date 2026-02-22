import { describe, test, expect, beforeEach } from 'vitest';
import { executeExe, executeSimpleCommand } from '../src/engine/executor';
import { ExitSignal, createSandboxTerminalAPI } from '../src/executor/sandbox';
import { InMemoryVFS } from '../src/vfs/memory';
import type { ExecutionContext, SimpleCommand } from '../src/engine/types';

describe('ExitSignal', () => {
  test('has correct code property', () => {
    const signal = new ExitSignal(42);
    expect(signal.code).toBe(42);
    expect(signal.message).toBe('Exit with code 42');
    expect(signal.name).toBe('ExitSignal');
  });

  test('defaults to code 0', () => {
    const signal = new ExitSignal();
    expect(signal.code).toBe(0);
  });
});

describe('createSandboxTerminalAPI', () => {
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

  test('provides args as read-only copy', () => {
    const args = ['arg1', 'arg2'];
    const api = createSandboxTerminalAPI(ctx, args, async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    expect(api.args).toEqual(['arg1', 'arg2']);

    // Modifying should not affect original
    api.args.push('arg3');
    expect(args).toEqual(['arg1', 'arg2']);
  });

  test('provides env as read-only copy', () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    expect(api.env.PATH).toBe('/bin');
    expect(api.env.HOME).toBe('/home/tronos');

    // Modifying should not affect original
    api.env.NEW_VAR = 'test';
    expect(ctx.env.NEW_VAR).toBeUndefined();
  });

  test('exit throws ExitSignal', () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    expect(() => api.exit(1)).toThrow(ExitSignal);
    try {
      api.exit(42);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitSignal);
      expect((e as ExitSignal).code).toBe(42);
    }
  });

  test('sleep returns a promise', async () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    const start = Date.now();
    await api.sleep(50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some timing variance
  });

  test('style helpers produce ANSI codes', () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    expect(api.style.red('test')).toContain('\x1b[31m');
    expect(api.style.bold('test')).toContain('\x1b[1m');
    expect(api.style.green('hello')).toContain('\x1b[32m');
  });

  test('fs provides VFS access', () => {
    vfs.write('/home/tronos/test.txt', 'Hello');

    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    expect(api.fs.exists('/home/tronos/test.txt')).toBe(true);
    expect(api.fs.read('/home/tronos/test.txt')).toBe('Hello');
    expect(api.fs.isFile('/home/tronos/test.txt')).toBe(true);
    expect(api.fs.isDirectory('/home/tronos')).toBe(true);
  });

  test('fs.write creates files', () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    api.fs.write('/home/tronos/new.txt', 'New content');

    expect(vfs.read('/home/tronos/new.txt')).toBe('New content');
  });

  test('fs.mkdir creates directories', () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    api.fs.mkdir('/home/tronos/newdir');

    expect(vfs.isDirectory('/home/tronos/newdir')).toBe(true);
  });
});

describe('executeExe', () => {
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

  test('executes simple .trx file', async () => {
    const source = `#!/tronos
// @name: hello
(async function(t) {
  t.writeln("Hello, World!");
})`;

    vfs.write('/bin/hello.trx', source);

    const result = await executeExe('/bin/hello.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello, World!');
    expect(result.stderr).toBe('');
  });

  test('passes arguments to executable', async () => {
    const source = `#!/tronos
// @name: echo-args
(async function(t) {
  t.writeln("Args: " + t.args.join(", "));
})`;

    vfs.write('/bin/echo-args.trx', source);

    const result = await executeExe('/bin/echo-args.trx', ['one', 'two', 'three'], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Args: one, two, three');
  });

  test('handles exit signal with code', async () => {
    const source = `#!/tronos
// @name: exit-test
(async function(t) {
  t.writeln("Before exit");
  t.exit(42);
  t.writeln("After exit"); // Should not execute
})`;

    vfs.write('/bin/exit-test.trx', source);

    const result = await executeExe('/bin/exit-test.trx', [], ctx);

    expect(result.exitCode).toBe(42);
    expect(result.stdout).toContain('Before exit');
    expect(result.stdout).not.toContain('After exit');
  });

  test('handles runtime errors', async () => {
    const source = `#!/tronos
// @name: error-test
(async function(t) {
  throw new Error("Something went wrong");
})`;

    vfs.write('/bin/error-test.trx', source);

    const result = await executeExe('/bin/error-test.trx', [], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Something went wrong');
  });

  test('returns error for non-existent file', async () => {
    const result = await executeExe('/bin/nonexistent.trx', [], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Cannot read');
  });

  test('returns error for invalid .trx format', async () => {
    vfs.write('/bin/invalid.trx', 'not valid exe format');

    const result = await executeExe('/bin/invalid.trx', [], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing required metadata field: name');
  });

  test('returns error for missing function body', async () => {
    const source = `#!/tronos
// @name: no-body
just some random code`;

    vfs.write('/bin/no-body.trx', source);

    const result = await executeExe('/bin/no-body.trx', [], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid .trx format');
  });

  test('provides access to filesystem', async () => {
    const source = `#!/tronos
// @name: fs-test
(async function(t) {
  t.fs.write("/home/tronos/output.txt", "Created by exe");
  t.writeln("File created");
})`;

    vfs.write('/bin/fs-test.trx', source);

    const result = await executeExe('/bin/fs-test.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(vfs.read('/home/tronos/output.txt')).toBe('Created by exe');
  });

  test('provides access to environment variables', async () => {
    ctx.env.MY_VAR = 'my-value';

    const source = `#!/tronos
// @name: env-test
(async function(t) {
  t.writeln("HOME=" + t.env.HOME);
  t.writeln("MY_VAR=" + t.env.MY_VAR);
})`;

    vfs.write('/bin/env-test.trx', source);

    const result = await executeExe('/bin/env-test.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('HOME=/home/tronos');
    expect(result.stdout).toContain('MY_VAR=my-value');
  });

  test('checks feature requirements', async () => {
    const source = `#!/tronos
// @name: req-test
// @requires: nonexistent-feature-xyz
(async function(t) {
  t.writeln("Should not execute");
})`;

    vfs.write('/bin/req-test.trx', source);

    // Unknown features return false, so the exe should fail with a requirements error
    const result = await executeExe('/bin/req-test.trx', [], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('nonexistent-feature-xyz');
  });

  test('handles async operations', async () => {
    const source = `#!/tronos
// @name: async-test
(async function(t) {
  await t.sleep(10);
  t.writeln("After sleep");
})`;

    vfs.write('/bin/async-test.trx', source);

    const result = await executeExe('/bin/async-test.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('After sleep');
  });
});

describe('executable resolution in executeSimpleCommand', () => {
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

  test('resolves command from PATH', async () => {
    const source = `#!/tronos
// @name: mycommand
(async function(t) {
  t.writeln("MyCommand executed");
})`;

    vfs.write('/bin/mycommand.trx', source);

    const command: SimpleCommand = {
      type: 'Command',
      command: 'mycommand',
      args: [],
      redirects: [],
    };

    const result = await executeSimpleCommand(command, ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('MyCommand executed');
  });

  test('resolves .trx extension automatically', async () => {
    const source = `#!/tronos
// @name: test-ext
(async function(t) {
  t.writeln("Extension test");
})`;

    vfs.write('/bin/test-ext.trx', source);

    const command: SimpleCommand = {
      type: 'Command',
      command: 'test-ext',
      args: [],
      redirects: [],
    };

    const result = await executeSimpleCommand(command, ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Extension test');
  });

  test('resolves relative path with ./', async () => {
    const source = `#!/tronos
// @name: local-script
(async function(t) {
  t.writeln("Local script executed");
})`;

    // Set cwd to home directory
    vfs.chdir('/home/tronos');
    vfs.write('/home/tronos/local-script.trx', source);

    const command: SimpleCommand = {
      type: 'Command',
      command: './local-script',
      args: [],
      redirects: [],
    };

    const result = await executeSimpleCommand(command, ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Local script executed');
  });

  test('resolves explicit .trx path', async () => {
    const source = `#!/tronos
// @name: explicit
(async function(t) {
  t.writeln("Explicit exe");
})`;

    vfs.write('/home/tronos/explicit.trx', source);

    const command: SimpleCommand = {
      type: 'Command',
      command: '/home/tronos/explicit.trx',
      args: [],
      redirects: [],
    };

    const result = await executeSimpleCommand(command, ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Explicit exe');
  });

  test('returns command not found for missing executable', async () => {
    const command: SimpleCommand = {
      type: 'Command',
      command: 'nonexistent',
      args: [],
      redirects: [],
    };

    const result = await executeSimpleCommand(command, ctx);

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('command not found');
  });

  test('multiple PATH directories are searched', async () => {
    const source = `#!/tronos
// @name: custom-cmd
(async function(t) {
  t.writeln("Custom path cmd");
})`;

    // Create custom bin directory
    vfs.mkdir('/usr/local/bin', true);
    vfs.write('/usr/local/bin/custom-cmd.trx', source);

    ctx.env.PATH = '/bin:/usr/local/bin';

    const command: SimpleCommand = {
      type: 'Command',
      command: 'custom-cmd',
      args: [],
      redirects: [],
    };

    const result = await executeSimpleCommand(command, ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Custom path cmd');
  });
});

describe('executeExe with named function format (AI-generated)', () => {
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

  test('executes named async function main(t) format', async () => {
    const source = `// @name: greeting
// @description: A simple greeting program

async function main(t) {
  t.writeln("Hello from named function!");
}`;

    vfs.write('/bin/greeting.trx', source);

    const result = await executeExe('/bin/greeting.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello from named function!');
    expect(result.stderr).toBe('');
  });

  test('executes named function with arguments', async () => {
    const source = `// @name: echo
// @description: Echo arguments

async function main(t) {
  if (t.args.length === 0) {
    t.writeln("No arguments provided");
    t.exit(1);
  }
  t.writeln("Arguments: " + t.args.join(" "));
}`;

    vfs.write('/bin/named-echo.trx', source);

    const result = await executeExe('/bin/named-echo.trx', ['hello', 'world'], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Arguments: hello world');
  });

  test('executes named function with filesystem access', async () => {
    const source = `// @name: file-creator
// @description: Creates a file

async function main(t) {
  t.fs.write("/home/tronos/created-by-named.txt", "Created by named function");
  t.writeln("File created successfully");
}`;

    vfs.write('/bin/file-creator.trx', source);

    const result = await executeExe('/bin/file-creator.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('File created successfully');
    expect(vfs.read('/home/tronos/created-by-named.txt')).toBe('Created by named function');
  });

  test('handles exit signal from named function', async () => {
    const source = `// @name: exit-demo
// @description: Demonstrates exit codes

async function main(t) {
  t.writeln("Before exit");
  t.exit(5);
  t.writeln("After exit"); // Should not execute
}`;

    vfs.write('/bin/exit-demo.trx', source);

    const result = await executeExe('/bin/exit-demo.trx', [], ctx);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toContain('Before exit');
    expect(result.stdout).not.toContain('After exit');
  });

  test('handles runtime errors in named function', async () => {
    const source = `// @name: error-demo
// @description: Throws an error

async function main(t) {
  throw new Error("Named function error");
}`;

    vfs.write('/bin/error-demo.trx', source);

    const result = await executeExe('/bin/error-demo.trx', [], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Named function error');
  });

  test('executes named function with any function name', async () => {
    const source = `// @name: custom-fn
// @description: Uses custom function name

async function customFunctionName(t) {
  t.writeln("Custom function name works!");
}`;

    vfs.write('/bin/custom-fn.trx', source);

    const result = await executeExe('/bin/custom-fn.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Custom function name works!');
  });

  test('executes named function with style helpers', async () => {
    const source = `// @name: styled
// @description: Uses style helpers

async function main(t) {
  t.writeln(t.style.bold("Bold text"));
  t.writeln(t.style.green("Green text"));
}`;

    vfs.write('/bin/styled.trx', source);

    const result = await executeExe('/bin/styled.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Bold text');
    expect(result.stdout).toContain('Green text');
  });
});

describe('exe execution with shell commands', () => {
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

  test('t.exec can run shell commands', async () => {
    const source = `#!/tronos
// @name: exec-test
(async function(t) {
  const result = await t.exec("pwd");
  t.writeln("PWD returned: " + result.stdout.trim());
})`;

    vfs.write('/bin/exec-test.trx', source);

    const result = await executeExe('/bin/exec-test.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PWD returned: /');
  });

  test('t.exec can check exit codes', async () => {
    const source = `#!/tronos
// @name: check-exit
(async function(t) {
  const result = await t.exec("ls /nonexistent-dir-xyz");
  t.writeln("Exit code: " + result.exitCode);
})`;

    vfs.write('/bin/check-exit.trx', source);

    const result = await executeExe('/bin/check-exit.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Exit code:');
  });
});

describe('sandbox input methods with terminal', () => {
  let vfs: InMemoryVFS;
  let ctx: ExecutionContext;
  let mockKeyCallbacks: ((key: { key: string; domEvent: KeyboardEvent }) => void)[];
  let mockDataCallbacks: ((data: string) => void)[];
  let writtenOutput: string;

  function createMockKeyEvent(key: string, options: Partial<KeyboardEvent> = {}): { key: string; domEvent: KeyboardEvent } {
    const domEvent = {
      key: key.length === 1 ? key : '',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      ...options,
    } as KeyboardEvent;
    return { key, domEvent };
  }

  function simulateKeyPress(key: string, options: Partial<KeyboardEvent> = {}) {
    const keyEvent = createMockKeyEvent(key, options);
    for (const cb of mockKeyCallbacks) {
      cb(keyEvent);
    }
  }

  function simulatePastedText(text: string) {
    for (const cb of mockDataCallbacks) {
      cb(text);
    }
  }

  beforeEach(async () => {
    vfs = new InMemoryVFS('test');
    await vfs.init();
    mockKeyCallbacks = [];
    mockDataCallbacks = [];
    writtenOutput = '';

    ctx = {
      stdin: '',
      env: { PATH: '/bin', HOME: '/home/tronos' },
      vfs,
      terminal: {
        write: (data: string) => { writtenOutput += data; },
        writeln: (data: string) => { writtenOutput += data + '\n'; },
        clear: () => {},
        clearLine: () => {},
        moveTo: () => {},
        moveBy: () => {},
        getCursor: () => ({ x: 0, y: 0 }),
        onKey: (cb: (key: { key: string; domEvent: KeyboardEvent }) => void) => {
          mockKeyCallbacks.push(cb);
          return { dispose: () => { mockKeyCallbacks = mockKeyCallbacks.filter(c => c !== cb); } };
        },
        onData: (cb: (data: string) => void) => {
          mockDataCallbacks.push(cb);
          return { dispose: () => { mockDataCallbacks = mockDataCallbacks.filter(c => c !== cb); } };
        },
        hasInput: () => false,
        hasSelection: () => false,
        getSelection: () => '',
        clearSelection: () => {},
        flush: () => {},
        dispose: () => {},
      },
    };
  });

  describe('readLine', () => {
    test('accepts typed characters', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine('> ');

      // Simulate typing 'hello'
      simulateKeyPress('h');
      simulateKeyPress('e');
      simulateKeyPress('l');
      simulateKeyPress('l');
      simulateKeyPress('o');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('hello');
    });

    test('handles backspace', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'abc', backspace, then 'd'
      simulateKeyPress('a');
      simulateKeyPress('b');
      simulateKeyPress('c');
      simulateKeyPress('\u007f'); // Backspace
      simulateKeyPress('d');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('abd');
    });

    test('handles arrow key navigation', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'ac', move left, insert 'b'
      simulateKeyPress('a');
      simulateKeyPress('c');
      simulateKeyPress('\x1b[D'); // Left arrow
      simulateKeyPress('b');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('abc');
    });

    test('handles Ctrl+A to move to beginning', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'hello', Ctrl+A, then 'X'
      simulateKeyPress('h');
      simulateKeyPress('e');
      simulateKeyPress('l');
      simulateKeyPress('l');
      simulateKeyPress('o');
      simulateKeyPress('a', { ctrlKey: true }); // Ctrl+A
      simulateKeyPress('X');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('Xhello');
    });

    test('handles Ctrl+E to move to end', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'hello', move left twice, Ctrl+E, then '!'
      simulateKeyPress('h');
      simulateKeyPress('e');
      simulateKeyPress('l');
      simulateKeyPress('l');
      simulateKeyPress('o');
      simulateKeyPress('\x1b[D'); // Left
      simulateKeyPress('\x1b[D'); // Left
      simulateKeyPress('e', { ctrlKey: true }); // Ctrl+E
      simulateKeyPress('!');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('hello!');
    });

    test('handles Ctrl+U to delete to beginning', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'hello', move left twice, Ctrl+U
      simulateKeyPress('h');
      simulateKeyPress('e');
      simulateKeyPress('l');
      simulateKeyPress('l');
      simulateKeyPress('o');
      simulateKeyPress('\x1b[D'); // Left
      simulateKeyPress('\x1b[D'); // Left
      simulateKeyPress('u', { ctrlKey: true }); // Ctrl+U
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('lo');
    });

    test('handles Ctrl+K to delete to end', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'hello', move left twice, Ctrl+K
      simulateKeyPress('h');
      simulateKeyPress('e');
      simulateKeyPress('l');
      simulateKeyPress('l');
      simulateKeyPress('o');
      simulateKeyPress('\x1b[D'); // Left
      simulateKeyPress('\x1b[D'); // Left
      simulateKeyPress('k', { ctrlKey: true }); // Ctrl+K
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('hel');
    });

    test('handles Ctrl+C to cancel input', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'hello', then Ctrl+C
      simulateKeyPress('h');
      simulateKeyPress('e');
      simulateKeyPress('l');
      simulateKeyPress('l');
      simulateKeyPress('o');
      simulateKeyPress('c', { ctrlKey: true }); // Ctrl+C

      const result = await linePromise;
      expect(result).toBe('');
    });

    test('handles pasted text from onData', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Simulate pasting 'pasted text'
      simulatePastedText('pasted text');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('pasted text');
    });

    test('handles pasted text with newlines - newlines converted to spaces', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Simulate pasting text with newlines
      simulatePastedText('line1\nline2\r\nline3');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('line1 line2 line3');
    });

    test('handles mixed typing and pasting', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'start:', paste 'middle', type ':end'
      simulateKeyPress('s');
      simulateKeyPress('t');
      simulateKeyPress('a');
      simulateKeyPress('r');
      simulateKeyPress('t');
      simulateKeyPress(':');
      simulatePastedText('middle');
      simulateKeyPress(':');
      simulateKeyPress('e');
      simulateKeyPress('n');
      simulateKeyPress('d');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('start:middle:end');
    });

    test('inserts pasted text at cursor position', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const linePromise = api.readLine();

      // Type 'hello', move left 2, paste 'PASTE'
      simulateKeyPress('h');
      simulateKeyPress('e');
      simulateKeyPress('l');
      simulateKeyPress('l');
      simulateKeyPress('o');
      simulateKeyPress('\x1b[D'); // Left
      simulateKeyPress('\x1b[D'); // Left
      simulatePastedText('PASTE');
      simulateKeyPress('\r'); // Enter

      const result = await linePromise;
      expect(result).toBe('helPASTElo');
    });
  });

  describe('readKey', () => {
    test('returns single key press', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const keyPromise = api.readKey();

      simulateKeyPress('a');

      const result = await keyPromise;
      expect(result.key).toBe('a');
    });

    test('returns special keys', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const keyPromise = api.readKey();

      simulateKeyPress('\r');

      const result = await keyPromise;
      expect(result.key).toBe('\r');
    });

    test('returns first character from pasted text', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const keyPromise = api.readKey();

      // Paste 'abc' - should return 'a'
      simulatePastedText('abc');

      const result = await keyPromise;
      expect(result.key).toBe('a');
    });

    test('only returns once per call', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      // First readKey call
      const keyPromise1 = api.readKey();
      simulateKeyPress('1');
      const result1 = await keyPromise1;
      expect(result1.key).toBe('1');

      // Second readKey call
      const keyPromise2 = api.readKey();
      simulateKeyPress('2');
      const result2 = await keyPromise2;
      expect(result2.key).toBe('2');
    });
  });

  describe('readChar', () => {
    test('returns printable character', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      const charPromise = api.readChar();

      simulateKeyPress('x');

      const result = await charPromise;
      expect(result).toBe('x');
    });

    test('ignores control keys', async () => {
      const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

      let resolved = false;
      const charPromise = api.readChar().then(r => {
        resolved = true;
        return r;
      });

      // Ctrl key should be ignored
      simulateKeyPress('c', { ctrlKey: true });

      // Wait a tick to ensure it didn't resolve
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(resolved).toBe(false);

      // Regular key should resolve
      simulateKeyPress('a');
      const result = await charPromise;
      expect(result).toBe('a');
    });
  });
});

describe('package config access in sandbox', () => {
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

  test('t.config.get returns undefined when no package context', () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    // Without packageName option, config.get should return undefined
    expect(api.config.get('anyKey')).toBeUndefined();
  });

  test('t.config.set returns false when no package context', () => {
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    // Without packageName option, config.set should return false
    expect(api.config.set('anyKey', 'anyValue')).toBe(false);
  });

  test('t.config.get returns config value for installed package', () => {
    // Set up installed package
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/weather', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'weather',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/weather.trx'],
        config: [
          { key: 'location', type: 'string', description: 'Default location' },
          { key: 'units', type: 'choice', description: 'Units', choices: ['metric', 'imperial'] }
        ]
      }
    ]));
    vfs.write('/etc/tpkg/weather/config.json', JSON.stringify({
      location: 'London',
      units: 'metric'
    }));

    // Create sandbox with package context
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }), {
      packageName: 'weather'
    });

    expect(api.config.get('location')).toBe('London');
    expect(api.config.get('units')).toBe('metric');
    expect(api.config.get('nonexistent')).toBeUndefined();
  });

  test('t.config.set stores config value for installed package', () => {
    // Set up installed package
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/weather', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'weather',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/weather.trx'],
        config: [
          { key: 'location', type: 'string', description: 'Default location' }
        ]
      }
    ]));
    vfs.write('/etc/tpkg/weather/config.json', JSON.stringify({}));

    // Create sandbox with package context
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }), {
      packageName: 'weather'
    });

    // Set config value
    const result = api.config.set('location', 'New York');
    expect(result).toBe(true);

    // Verify it was stored
    expect(api.config.get('location')).toBe('New York');

    // Verify it's in the VFS
    const configContent = vfs.read('/etc/tpkg/weather/config.json');
    const config = JSON.parse(configContent as string);
    expect(config.location).toBe('New York');
  });

  test('t.config supports different value types', () => {
    // Set up installed package
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/pomodoro', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'pomodoro',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/pomodoro.trx'],
        config: [
          { key: 'workMinutes', type: 'number', description: 'Work duration' },
          { key: 'autoStart', type: 'boolean', description: 'Auto start' }
        ]
      }
    ]));
    vfs.write('/etc/tpkg/pomodoro/config.json', JSON.stringify({
      workMinutes: 25,
      autoStart: true
    }));

    // Create sandbox with package context
    const api = createSandboxTerminalAPI(ctx, [], async () => ({ stdout: '', stderr: '', exitCode: 0 }), {
      packageName: 'pomodoro'
    });

    // Number value
    expect(api.config.get('workMinutes')).toBe(25);

    // Boolean value
    expect(api.config.get('autoStart')).toBe(true);

    // Set new values
    api.config.set('workMinutes', 30);
    api.config.set('autoStart', false);

    expect(api.config.get('workMinutes')).toBe(30);
    expect(api.config.get('autoStart')).toBe(false);
  });
});

describe('package config access in executeExe', () => {
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

  test('exe can read config via t.config.get', async () => {
    // Set up installed package with config
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/greeting', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'greeting',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/greeting.trx'],
        config: [
          { key: 'name', type: 'string', description: 'Your name' }
        ]
      }
    ]));
    vfs.write('/etc/tpkg/greeting/config.json', JSON.stringify({
      name: 'Alice'
    }));

    // Create the exe file
    const source = `#!/tronos
// @name: greeting
(async function(t) {
  const name = t.config.get('name') || 'World';
  t.writeln('Hello, ' + name + '!');
})`;
    vfs.write('/bin/greeting.trx', source);

    const result = await executeExe('/bin/greeting.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello, Alice!');
  });

  test('exe can write config via t.config.set', async () => {
    // Set up installed package
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/counter', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'counter',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/counter.trx'],
        config: [
          { key: 'count', type: 'number', description: 'Counter value' }
        ]
      }
    ]));
    vfs.write('/etc/tpkg/counter/config.json', JSON.stringify({
      count: 0
    }));

    // Create the exe file that increments a counter
    const source = `#!/tronos
// @name: counter
(async function(t) {
  const current = t.config.get('count') || 0;
  const newCount = current + 1;
  t.config.set('count', newCount);
  t.writeln('Count: ' + newCount);
})`;
    vfs.write('/bin/counter.trx', source);

    // Run it multiple times
    const result1 = await executeExe('/bin/counter.trx', [], ctx);
    expect(result1.stdout).toContain('Count: 1');

    const result2 = await executeExe('/bin/counter.trx', [], ctx);
    expect(result2.stdout).toContain('Count: 2');

    const result3 = await executeExe('/bin/counter.trx', [], ctx);
    expect(result3.stdout).toContain('Count: 3');

    // Verify final config value
    const configContent = vfs.read('/etc/tpkg/counter/config.json');
    const config = JSON.parse(configContent as string);
    expect(config.count).toBe(3);
  });

  test('exe without package context gets undefined from t.config.get', async () => {
    // Create an exe that is NOT in the installed packages list
    const source = `#!/tronos
// @name: standalone
(async function(t) {
  const value = t.config.get('someKey');
  t.writeln('Value: ' + (value === undefined ? 'undefined' : value));
})`;
    vfs.write('/bin/standalone.trx', source);

    const result = await executeExe('/bin/standalone.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Value: undefined');
  });

  test('emits warning for missing required config', async () => {
    // Set up installed package with required config that's missing
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/api-tool', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'api-tool',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/api-tool.trx'],
        config: [
          { key: 'apiKey', type: 'string', description: 'API key', required: true, secret: true },
          { key: 'endpoint', type: 'string', description: 'API endpoint', required: true }
        ]
      }
    ]));
    // Empty config - missing required values
    vfs.write('/etc/tpkg/api-tool/config.json', JSON.stringify({}));

    const source = `#!/tronos
// @name: api-tool
(async function(t) {
  t.writeln('Running...');
})`;
    vfs.write('/bin/api-tool.trx', source);

    const result = await executeExe('/bin/api-tool.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Warning: Missing required config');
    expect(result.stderr).toContain('apiKey');
    expect(result.stderr).toContain('endpoint');
    expect(result.stderr).toContain('tpkg config api-tool');
  });

  test('no warning when required config is present', async () => {
    // Set up installed package with required config that IS provided
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/api-tool', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'api-tool',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/api-tool.trx'],
        config: [
          { key: 'apiKey', type: 'string', description: 'API key', required: true },
          { key: 'endpoint', type: 'string', description: 'API endpoint', required: true }
        ]
      }
    ]));
    vfs.write('/etc/tpkg/api-tool/config.json', JSON.stringify({
      apiKey: 'my-secret-key',
      endpoint: 'https://api.example.com'
    }));

    const source = `#!/tronos
// @name: api-tool
(async function(t) {
  t.writeln('Running...');
})`;
    vfs.write('/bin/api-tool.trx', source);

    const result = await executeExe('/bin/api-tool.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('no warning for non-required missing config', async () => {
    // Set up installed package with optional config that's missing
    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/tool', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'tool',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/tool.trx'],
        config: [
          { key: 'optionalSetting', type: 'string', description: 'Optional setting' }
          // Note: no required: true
        ]
      }
    ]));
    vfs.write('/etc/tpkg/tool/config.json', JSON.stringify({}));

    const source = `#!/tronos
// @name: tool
(async function(t) {
  t.writeln('Running...');
})`;
    vfs.write('/bin/tool.trx', source);

    const result = await executeExe('/bin/tool.trx', [], ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

describe('getPackageNameForExe and getMissingRequiredConfig', () => {
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

  test('getPackageNameForExe returns package name for installed exe', async () => {
    const { getPackageNameForExe } = await import('../src/engine/builtins/tpkg');

    vfs.mkdir('/etc/tpkg', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'mypackage',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/mypackage.trx', '/bin/myhelper.trx']
      }
    ]));

    expect(getPackageNameForExe('/bin/mypackage.trx', ctx)).toBe('mypackage');
    expect(getPackageNameForExe('/bin/myhelper.trx', ctx)).toBe('mypackage');
  });

  test('getPackageNameForExe returns undefined for unknown exe', async () => {
    const { getPackageNameForExe } = await import('../src/engine/builtins/tpkg');

    vfs.mkdir('/etc/tpkg', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'mypackage',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/mypackage.trx']
      }
    ]));

    expect(getPackageNameForExe('/bin/unknown.trx', ctx)).toBeUndefined();
    expect(getPackageNameForExe('/other/path.trx', ctx)).toBeUndefined();
  });

  test('getMissingRequiredConfig returns missing required keys', async () => {
    const { getMissingRequiredConfig } = await import('../src/engine/builtins/tpkg');

    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/testpkg', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'testpkg',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/testpkg.trx'],
        config: [
          { key: 'required1', type: 'string', description: 'Required 1', required: true },
          { key: 'required2', type: 'string', description: 'Required 2', required: true },
          { key: 'optional1', type: 'string', description: 'Optional 1' }
        ]
      }
    ]));
    // Only required1 is set
    vfs.write('/etc/tpkg/testpkg/config.json', JSON.stringify({
      required1: 'value1'
    }));

    const missing = getMissingRequiredConfig('testpkg', ctx);
    expect(missing).toEqual(['required2']);
  });

  test('getMissingRequiredConfig returns empty array when all required present', async () => {
    const { getMissingRequiredConfig } = await import('../src/engine/builtins/tpkg');

    vfs.mkdir('/etc/tpkg', true);
    vfs.mkdir('/etc/tpkg/testpkg', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'testpkg',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/testpkg.trx'],
        config: [
          { key: 'required1', type: 'string', description: 'Required 1', required: true }
        ]
      }
    ]));
    vfs.write('/etc/tpkg/testpkg/config.json', JSON.stringify({
      required1: 'value1'
    }));

    const missing = getMissingRequiredConfig('testpkg', ctx);
    expect(missing).toEqual([]);
  });

  test('getMissingRequiredConfig returns empty array for package without config', async () => {
    const { getMissingRequiredConfig } = await import('../src/engine/builtins/tpkg');

    vfs.mkdir('/etc/tpkg', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([
      {
        name: 'testpkg',
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        files: ['/bin/testpkg.trx']
        // No config array
      }
    ]));

    const missing = getMissingRequiredConfig('testpkg', ctx);
    expect(missing).toEqual([]);
  });

  test('getMissingRequiredConfig returns empty for unknown package', async () => {
    const { getMissingRequiredConfig } = await import('../src/engine/builtins/tpkg');

    vfs.mkdir('/etc/tpkg', true);
    vfs.write('/etc/tpkg/installed.json', JSON.stringify([]));

    const missing = getMissingRequiredConfig('unknown', ctx);
    expect(missing).toEqual([]);
  });
});
