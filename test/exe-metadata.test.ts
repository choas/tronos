import { describe, test, expect } from 'vitest';
import { parseExeMetadata } from '../src/engine/executor';

describe('parseExeMetadata', () => {
  describe('basic parsing', () => {
    test('parses minimal valid .trx with only name', () => {
      const source = `#!/tronos
// @name: myprogram

(async function(t) {
  t.writeln("Hello");
})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('myprogram');
      expect(result.body).toContain('async function(t)');
    });

    test('parses all metadata fields', () => {
      const source = `#!/tronos
// @name: countdown
// @description: A countdown timer utility
// @version: 1.0.0
// @author: developer
// @created: 2024-01-15T10:30:00Z
// @license: MIT
// @requires: network, usb

(async function(t) {
  t.writeln("Countdown!");
})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('countdown');
      expect(result.metadata?.description).toBe('A countdown timer utility');
      expect(result.metadata?.version).toBe('1.0.0');
      expect(result.metadata?.author).toBe('developer');
      expect(result.metadata?.created).toBe('2024-01-15T10:30:00Z');
      expect(result.metadata?.license).toBe('MIT');
      expect(result.metadata?.requires).toEqual(['network', 'usb']);
    });

    test('parses metadata without @ prefix', () => {
      const source = `#!/tronos
// name: myprogram
// version: 2.0.0

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('myprogram');
      expect(result.metadata?.version).toBe('2.0.0');
    });

    test('parses AI-generated author', () => {
      const source = `#!/tronos
// @name: ai-helper
// @author: @ai

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.author).toBe('@ai');
    });
  });

  describe('body extraction', () => {
    test('extracts function body correctly', () => {
      const source = `#!/tronos
// @name: test

(async function(t) {
  const x = 1;
  t.writeln(x);
})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.body).toBe(`(async function(t) {
  const x = 1;
  t.writeln(x);
})`);
    });

    test('preserves multiline body', () => {
      const source = `#!/tronos
// @name: multiline

(async function(t) {
  for (let i = 0; i < 10; i++) {
    t.writeln(i.toString());
  }

  await sleep(100);

  t.exit(0);
})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.body).toContain('for (let i = 0; i < 10; i++)');
      expect(result.body).toContain('await sleep(100)');
      expect(result.body).toContain('t.exit(0)');
    });
  });

  describe('error handling', () => {
    test('fails when name is missing', () => {
      const source = `#!/tronos
// @description: A program without a name
// @version: 1.0.0

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing required metadata field: name');
      expect(result.metadata).toBeUndefined();
    });

    test('fails on empty source', () => {
      const result = parseExeMetadata('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing required metadata field: name');
    });

    test('fails on source with only shebang', () => {
      const source = `#!/tronos`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing required metadata field: name');
    });

    test('fails on source with only comments (no name)', () => {
      const source = `#!/tronos
// This is a comment
// Another comment

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing required metadata field: name');
    });
  });

  describe('edge cases', () => {
    test('handles source without shebang', () => {
      const source = `// @name: no-shebang

(async function(t) {
  t.writeln("No shebang");
})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('no-shebang');
    });

    test('handles empty lines between metadata', () => {
      const source = `#!/tronos

// @name: spaced-metadata

// @version: 1.0.0

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('spaced-metadata');
      expect(result.metadata?.version).toBe('1.0.0');
    });

    test('handles metadata with extra whitespace', () => {
      const source = `#!/tronos
// @name:    extra-spaces
// @description:   Has extra   spaces

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('extra-spaces');
      expect(result.metadata?.description).toBe('Has extra   spaces');
    });

    test('handles single requires value', () => {
      const source = `#!/tronos
// @name: single-req
// @requires: network

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.requires).toEqual(['network']);
    });

    test('handles requires with extra whitespace', () => {
      const source = `#!/tronos
// @name: spaced-req
// @requires:  network ,  usb  ,  bluetooth

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.requires).toEqual(['network', 'usb', 'bluetooth']);
    });

    test('handles empty requires value', () => {
      const source = `#!/tronos
// @name: empty-req
// @requires:

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.requires).toEqual([]);
    });

    test('handles case-insensitive metadata keys', () => {
      const source = `#!/tronos
// @NAME: uppercase
// @Version: 1.0.0
// @DESCRIPTION: Mixed case

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('uppercase');
      expect(result.metadata?.version).toBe('1.0.0');
      expect(result.metadata?.description).toBe('Mixed case');
    });

    test('handles metadata with colons in value', () => {
      const source = `#!/tronos
// @name: time-test
// @description: Runs at 10:30:00 every day

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.description).toBe('Runs at 10:30:00 every day');
    });

    test('stops parsing at first code line', () => {
      const source = `#!/tronos
// @name: stop-test
const x = 1; // This should be part of body
// @version: 1.0.0

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('stop-test');
      // Version should not be parsed because it comes after a code line
      expect(result.metadata?.version).toBeUndefined();
      expect(result.body).toContain('const x = 1');
    });

    test('handles Windows-style line endings', () => {
      const source = `#!/tronos\r\n// @name: windows-test\r\n// @version: 1.0.0\r\n\r\n(async function(t) {\r\n  t.writeln("Hello");\r\n})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('windows-test');
      expect(result.metadata?.version).toBe('1.0.0');
    });

    test('handles unknown metadata keys (ignores them)', () => {
      const source = `#!/tronos
// @name: unknown-test
// @unknown: This should be ignored
// @custom-key: Also ignored

(async function(t) {})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('unknown-test');
      expect(result.body).toContain('async function(t)');
    });
  });

  describe('real-world examples', () => {
    test('parses help.trx format', () => {
      const source = `#!/tronos
// @name: help
// @description: Display command list and AI usage
// @version: 1.0.0
// @author: @ai

(async function(t) {
  t.writeln("TronOS Help");
  t.writeln("=========");
  t.writeln("");
  t.writeln("Built-in commands:");
  t.writeln("  ls      - List directory contents");
  t.writeln("  cd      - Change directory");

  t.exit(0);
})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('help');
      expect(result.metadata?.description).toBe('Display command list and AI usage');
      expect(result.metadata?.author).toBe('@ai');
      expect(result.body).toContain('t.writeln("TronOS Help")');
    });

    test('parses countdown.trx format', () => {
      const source = `#!/tronos
// @name: countdown
// @description: A simple countdown timer
// @version: 1.0.0
// @author: @ai

(async function(t) {
  const args = t.args || [];
  const count = parseInt(args[0]) || 10;

  for (let i = count; i > 0; i--) {
    t.writeln(i.toString());
    await t.sleep(1000);
  }

  t.writeln("Liftoff!");
  t.exit(0);
})`;

      const result = parseExeMetadata(source);

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('countdown');
      expect(result.body).toContain('await t.sleep(1000)');
    });
  });
});
