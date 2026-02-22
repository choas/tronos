/**
 * tpkg - TronOS Package Manager
 *
 * Manages packages in the TronOS virtual filesystem.
 * Packages are installed to /bin and configuration is stored in /etc/tpkg.
 *
 * Subcommands:
 *   install <package>   - Install package from repository
 *   uninstall <package> - Remove installed package
 *   update              - Update package index
 *   upgrade <package>   - Upgrade package to latest version
 *   search <term>       - Search available packages
 *   list                - Show installed packages
 *   info <package>      - Show package details
 *   repo add <url>      - Add package repository
 *   repo remove <url>   - Remove package repository
 *   repo list           - List configured repositories
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from '../types';
import type { TerminalAPI, KeyEvent } from '../../terminal/api';
import { aiosFetch } from '../../network/fetch';
import { encryptSecret, decryptSecret } from '../../persistence/crypto';

/**
 * Terminal input helper - Read a line of input from the user
 * Returns empty string if terminal is not available (non-interactive mode)
 */
async function readLine(terminal: TerminalAPI | undefined, prompt: string): Promise<string> {
  if (!terminal?.onKey) {
    return '';
  }

  terminal.write(prompt);

  return new Promise((resolve) => {
    let line = '';
    let cursorPos = 0;

    const redrawLine = () => {
      terminal.write(`\x1b[2K\r${prompt}${line}`);
      if (cursorPos < line.length) {
        terminal.write(`\x1b[${line.length - cursorPos}D`);
      }
    };

    let dataDisposable: { dispose: () => void } | null = null;
    if (terminal.onData) {
      dataDisposable = terminal.onData((data: string) => {
        if (data.length > 1) {
          const sanitized = data.replace(/[\r\n]+/g, ' ').trim();
          if (sanitized) {
            line = line.slice(0, cursorPos) + sanitized + line.slice(cursorPos);
            cursorPos += sanitized.length;
            redrawLine();
          }
        }
      });
    }

    const disposable = terminal.onKey((key: KeyEvent) => {
      if (key.key === '\r') {
        disposable.dispose();
        if (dataDisposable) dataDisposable.dispose();
        terminal.write('\r\n');
        resolve(line);
      } else if (key.key === '\u007f') {
        if (cursorPos > 0) {
          line = line.slice(0, cursorPos - 1) + line.slice(cursorPos);
          cursorPos--;
          redrawLine();
        }
      } else if (key.key === '\x1b[D') {
        if (cursorPos > 0) {
          cursorPos--;
          terminal.write('\x1b[D');
        }
      } else if (key.key === '\x1b[C') {
        if (cursorPos < line.length) {
          cursorPos++;
          terminal.write('\x1b[C');
        }
      } else if (key.key === '\x03' || (key.domEvent?.ctrlKey && key.domEvent?.key?.toLowerCase() === 'c')) {
        // Ctrl+C - cancel input
        disposable.dispose();
        if (dataDisposable) dataDisposable.dispose();
        terminal.write('^C\r\n');
        resolve('');
      } else if (key.key.length === 1 && !key.domEvent?.ctrlKey && !key.domEvent?.altKey && !key.domEvent?.metaKey) {
        line = line.slice(0, cursorPos) + key.key + line.slice(cursorPos);
        cursorPos++;
        if (cursorPos === line.length) {
          terminal.write(key.key);
        } else {
          redrawLine();
        }
      }
    });
  });
}

/**
 * Terminal input helper - Read a password (masked input) from the user
 * Shows asterisks instead of actual characters
 */
async function readPassword(terminal: TerminalAPI | undefined, prompt: string): Promise<string> {
  if (!terminal?.onKey) {
    return '';
  }

  terminal.write(prompt);

  return new Promise((resolve) => {
    let password = '';
    let disposed = false;

    const cleanup = () => {
      if (!disposed) {
        disposed = true;
        keyDisposable.dispose();
        dataDisposable?.dispose();
      }
    };

    const redrawMask = () => {
      terminal.write(`\x1b[2K\r${prompt}${'*'.repeat(password.length)}`);
    };

    // Handle pasted text via onData (paste sends multiple chars at once)
    const dataDisposable = terminal.onData?.((data: string) => {
      if (disposed) return;
      // Skip single chars (handled by onKey) and control sequences
      if (data.length <= 1) return;
      // Multi-char data = paste
      password += data;
      redrawMask();
    });

    const keyDisposable = terminal.onKey((key: KeyEvent) => {
      if (disposed) return;
      if (key.key === '\r') {
        cleanup();
        terminal.write('\r\n');
        resolve(password);
      } else if (key.key === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          redrawMask();
        }
      } else if (key.key === '\x03' || (key.domEvent?.ctrlKey && key.domEvent?.key?.toLowerCase() === 'c')) {
        // Ctrl+C - cancel input
        cleanup();
        terminal.write('^C\r\n');
        resolve('');
      } else if (key.key.length === 1 && !key.domEvent?.ctrlKey && !key.domEvent?.altKey && !key.domEvent?.metaKey) {
        password += key.key;
        terminal.write('*');
      }
    });
  });
}

/**
 * Validate and convert a user input string to the appropriate type
 * Returns [success, convertedValue, errorMessage]
 */
function validateConfigInput(
  input: string,
  param: PackageConfigParam
): [boolean, string | number | boolean | undefined, string?] {
  const trimmed = input.trim();

  // Empty input uses default if available, otherwise fails if required
  if (trimmed === '') {
    if (param.default !== undefined) {
      return [true, param.default];
    }
    if (param.required) {
      return [false, undefined, 'Value is required'];
    }
    return [true, undefined];
  }

  switch (param.type) {
    case 'string':
      return [true, trimmed];

    case 'number': {
      const num = Number(trimmed);
      if (isNaN(num)) {
        return [false, undefined, 'Value must be a number'];
      }
      return [true, num];
    }

    case 'boolean': {
      const lower = trimmed.toLowerCase();
      if (lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1') {
        return [true, true];
      }
      if (lower === 'false' || lower === 'no' || lower === 'n' || lower === '0') {
        return [true, false];
      }
      return [false, undefined, 'Value must be true/false, yes/no, or y/n'];
    }

    case 'choice': {
      if (!param.choices || param.choices.length === 0) {
        return [true, trimmed];
      }
      const lower = trimmed.toLowerCase();
      const match = param.choices.find(c => c.toLowerCase() === lower);
      if (!match) {
        return [false, undefined, `Value must be one of: ${param.choices.join(', ')}`];
      }
      return [true, match];
    }

    default:
      return [true, trimmed];
  }
}

/**
 * Check if terminal is available for interactive input
 */
function isInteractive(context: ExecutionContext): boolean {
  return !!(context.terminal?.onKey);
}

// Default package repository
const DEFAULT_REPOSITORY = 'https://raw.githubusercontent.com/anthropics/aios-packages/main';

// Package index cache path
const PACKAGE_INDEX_PATH = '/var/cache/tpkg/index.json';

/**
 * Bundled package index for offline/default usage
 * This provides a set of example packages that work without network access
 */
const BUNDLED_PACKAGE_INDEX: PackageIndexEntry[] = [
  {
    name: 'weather',
    version: '1.0.0',
    description: 'Weather forecast display using wttr.in API',
    author: '@ai'
  },
  {
    name: 'translator',
    version: '1.0.0',
    description: 'Text translation using AI providers',
    author: '@ai'
  },
  {
    name: 'pomodoro',
    version: '1.0.0',
    description: 'Pomodoro timer for productivity',
    author: '@ai'
  },
  {
    name: 'notes',
    version: '1.0.0',
    description: 'Simple note-taking application',
    author: '@ai'
  },
  {
    name: 'gist',
    version: '1.0.0',
    description: 'GitHub Gist viewer and creator',
    author: '@ai'
  },
  {
    name: 'homeassistant',
    version: '1.0.0',
    description: 'Home Assistant integration for smart home control',
    author: '@ai'
  }
];

/**
 * Bundled package manifests for offline/default usage
 */
const BUNDLED_PACKAGE_MANIFESTS: Record<string, PackageManifest> = {
  weather: {
    name: 'weather',
    version: '1.0.0',
    description: 'Weather forecast display using wttr.in API',
    author: '@ai',
    license: 'MIT',
    files: ['weather.trx'],
    config: [
      {
        key: 'location',
        type: 'string',
        description: 'Default location for weather queries',
        required: false,
        default: ''
      },
      {
        key: 'units',
        type: 'choice',
        description: 'Temperature units',
        choices: ['metric', 'imperial'],
        default: 'metric'
      }
    ]
  },
  translator: {
    name: 'translator',
    version: '1.0.0',
    description: 'Text translation using AI providers',
    author: '@ai',
    license: 'MIT',
    files: ['translator.trx'],
    config: [
      {
        key: 'provider',
        type: 'choice',
        description: 'AI provider for translation',
        choices: ['anthropic', 'openai'],
        default: 'anthropic'
      },
      {
        key: 'apiKey',
        type: 'string',
        description: 'API key for translation service',
        required: true,
        secret: true
      },
      {
        key: 'targetLanguage',
        type: 'string',
        description: 'Default target language',
        default: 'en'
      }
    ]
  },
  pomodoro: {
    name: 'pomodoro',
    version: '1.0.0',
    description: 'Pomodoro timer for productivity',
    author: '@ai',
    license: 'MIT',
    files: ['pomodoro.trx'],
    config: [
      {
        key: 'workMinutes',
        type: 'number',
        description: 'Duration of work sessions in minutes',
        default: 25
      },
      {
        key: 'breakMinutes',
        type: 'number',
        description: 'Duration of break sessions in minutes',
        default: 5
      },
      {
        key: 'longBreakMinutes',
        type: 'number',
        description: 'Duration of long break after 4 sessions',
        default: 15
      }
    ]
  },
  notes: {
    name: 'notes',
    version: '1.0.0',
    description: 'Simple note-taking application',
    author: '@ai',
    license: 'MIT',
    files: ['notes.trx']
  },
  gist: {
    name: 'gist',
    version: '1.0.0',
    description: 'GitHub Gist viewer and creator',
    author: '@ai',
    license: 'MIT',
    files: ['gist.trx'],
    config: [
      {
        key: 'githubToken',
        type: 'string',
        description: 'GitHub personal access token for creating gists',
        required: true,
        secret: true
      },
      {
        key: 'defaultPublic',
        type: 'boolean',
        description: 'Create public gists by default',
        default: false
      }
    ]
  },
  homeassistant: {
    name: 'homeassistant',
    version: '1.1.0',
    description: 'Home Assistant integration for smart home control',
    author: '@ai',
    license: 'MIT',
    files: ['homeassistant.trx'],
    config: [
      {
        key: 'url',
        type: 'string',
        description: 'Home Assistant instance URL (e.g., http://192.168.1.100:8123)',
        required: true
      },
      {
        key: 'token',
        type: 'string',
        description: 'Home Assistant long-lived access token',
        required: true,
        secret: true
      },
      {
        key: 'defaultEntity',
        type: 'string',
        description: 'Default entity ID to control (e.g., light.living_room)',
        required: false,
        default: ''
      }
    ]
  }
};

/**
 * Bundled package source code
 */
const BUNDLED_PACKAGE_FILES: Record<string, Record<string, string>> = {
  weather: {
    'weather.trx': `#!/tronos
// @name: weather
// @description: Weather forecast display using wttr.in API
// @version: 1.0.0
// @author: @ai

async function main(t) {
  const location = t.args[0] || t.config?.get?.('location') || '';
  const units = t.config?.get?.('units') || 'metric';

  const unitParam = units === 'imperial' ? 'u' : 'm';
  const url = \`https://wttr.in/\${encodeURIComponent(location)}?format=3&\${unitParam}\`;

  try {
    t.writeln(t.style.dim('Fetching weather...'));
    const response = await t.net.fetch(url);

    if (!response.ok) {
      t.writeln(t.style.red('Error: Unable to fetch weather data'));
      t.exit(1);
    }

    const weather = await response.text();
    t.writeln(weather.trim());
  } catch (err) {
    t.writeln(t.style.red('Error: ' + err.message));
    t.exit(1);
  }

  t.exit(0);
}`
  },
  translator: {
    'translator.trx': `#!/tronos
// @name: translator
// @description: Text translation using AI providers
// @version: 1.0.0
// @author: @ai

async function main(t) {
  const text = t.args.join(' ');
  if (!text) {
    t.writeln(t.style.yellow('Usage: translator <text to translate>'));
    t.writeln('Configure with: tpkg config translator');
    t.exit(1);
  }

  const apiKey = t.config?.get?.('apiKey');
  if (!apiKey) {
    t.writeln(t.style.red('Error: API key not configured'));
    t.writeln('Run: tpkg config set translator apiKey <your-key>');
    t.exit(1);
  }

  const targetLang = t.config?.get?.('targetLanguage') || 'en';

  t.writeln(t.style.dim(\`Translating to \${targetLang}...\`));
  t.writeln(t.style.green('Translation: ') + text);
  t.writeln(t.style.dim('(Note: Full translation requires AI API integration)'));

  t.exit(0);
}`
  },
  pomodoro: {
    'pomodoro.trx': `#!/tronos
// @name: pomodoro
// @description: Pomodoro timer for productivity
// @version: 1.0.0
// @author: @ai

async function main(t) {
  const workMinutes = t.config?.get?.('workMinutes') || 25;
  const breakMinutes = t.config?.get?.('breakMinutes') || 5;

  const mode = t.args[0] || 'work';
  const duration = mode === 'break' ? breakMinutes : workMinutes;

  t.clear();
  t.writeln(t.style.bold(t.style.cyan('🍅 Pomodoro Timer')));
  t.writeln('');
  t.writeln(t.style.green(\`Starting \${mode} session: \${duration} minutes\`));
  t.writeln('Press any key to stop.');
  t.writeln('');

  // For demo, just show a countdown for a few seconds
  const demoSeconds = 5;
  for (let i = demoSeconds; i >= 0; i--) {
    t.write('\\r' + t.style.bold(\`Time remaining: \${i}s  \`));
    await t.sleep(1000);
  }

  t.writeln('');
  t.writeln('');
  t.writeln(t.style.green('✓ Session complete!'));
  t.writeln(t.style.dim(\`(Full timer would run for \${duration} minutes)\`));

  t.exit(0);
}`
  },
  notes: {
    'notes.trx': `#!/tronos
// @name: notes
// @description: Simple note-taking application
// @version: 1.0.0
// @author: @ai

async function main(t) {
  const notesDir = '/home/aios/notes';
  const cmd = t.args[0] || 'list';

  // Ensure notes directory exists
  if (!t.fs.exists(notesDir)) {
    t.fs.mkdir(notesDir);
  }

  switch (cmd) {
    case 'list':
    case 'ls': {
      const files = t.fs.list(notesDir);
      if (files.length === 0) {
        t.writeln(t.style.dim('No notes yet. Create one with: notes add <title>'));
      } else {
        t.writeln(t.style.bold('Your Notes:'));
        for (const file of files) {
          t.writeln('  • ' + file.replace('.txt', ''));
        }
      }
      break;
    }

    case 'add':
    case 'new': {
      const title = t.args.slice(1).join(' ');
      if (!title) {
        t.writeln(t.style.red('Usage: notes add <title>'));
        t.exit(1);
      }
      const filename = title.replace(/[^a-zA-Z0-9]/g, '-') + '.txt';
      const path = notesDir + '/' + filename;
      t.fs.write(path, '# ' + title + '\\n\\n');
      t.writeln(t.style.green('Created note: ' + title));
      break;
    }

    case 'show':
    case 'cat': {
      const title = t.args.slice(1).join(' ');
      if (!title) {
        t.writeln(t.style.red('Usage: notes show <title>'));
        t.exit(1);
      }
      const filename = title.replace(/[^a-zA-Z0-9]/g, '-') + '.txt';
      const path = notesDir + '/' + filename;
      if (t.fs.exists(path)) {
        t.writeln(t.fs.read(path));
      } else {
        t.writeln(t.style.red('Note not found: ' + title));
        t.exit(1);
      }
      break;
    }

    default:
      t.writeln(t.style.bold('Notes - Simple note-taking'));
      t.writeln('');
      t.writeln('Commands:');
      t.writeln('  notes list        - List all notes');
      t.writeln('  notes add <title> - Create a new note');
      t.writeln('  notes show <title> - Display a note');
  }

  t.exit(0);
}`
  },
  gist: {
    'gist.trx': `#!/tronos
// @name: gist
// @description: GitHub Gist viewer and creator
// @version: 1.0.0
// @author: @ai

async function main(t) {
  const cmd = t.args[0] || 'help';

  switch (cmd) {
    case 'create': {
      const token = t.config?.get?.('githubToken');
      if (!token) {
        t.writeln(t.style.red('Error: GitHub token not configured'));
        t.writeln('Run: tpkg config set gist githubToken <your-token>');
        t.exit(1);
      }

      const filename = t.args[1];
      if (!filename) {
        t.writeln(t.style.red('Usage: gist create <file>'));
        t.exit(1);
      }

      if (!t.fs.exists(filename)) {
        t.writeln(t.style.red('File not found: ' + filename));
        t.exit(1);
      }

      const content = t.fs.read(filename);
      const isPublic = t.config?.get?.('defaultPublic') || false;

      t.writeln(t.style.dim('Creating gist...'));
      t.writeln(t.style.green('✓ Gist created (simulation)'));
      t.writeln(t.style.dim('File: ' + filename + ' (' + content.length + ' bytes)'));
      t.writeln(t.style.dim('Visibility: ' + (isPublic ? 'public' : 'private')));
      break;
    }

    case 'list': {
      t.writeln(t.style.bold('Your Gists:'));
      t.writeln(t.style.dim('(Requires GitHub API integration)'));
      break;
    }

    default:
      t.writeln(t.style.bold('Gist - GitHub Gist manager'));
      t.writeln('');
      t.writeln('Commands:');
      t.writeln('  gist create <file> - Create a new gist from file');
      t.writeln('  gist list          - List your gists');
      t.writeln('');
      t.writeln('Configure with: tpkg config gist');
  }

  t.exit(0);
}`
  },
  homeassistant: {
    'homeassistant.trx': `#!/tronos
// @name: homeassistant
// @description: Home Assistant integration for smart home control
// @version: 1.1.0
// @author: @ai
// @requires: network

async function main(t) {
  const cmd = t.args[0] || 'help';
  const rawUrl = t.config?.get?.('url') || '';
  const haUrl = typeof rawUrl === 'string' ? rawUrl.replace(/\\/+$/, '') : rawUrl;
  const haToken = t.config?.get?.('token');

  const needsAuth = ['status', 'toggle', 'turn-on', 'turn-off', 'entities', 'call', 'scenes', 'automations', 'listen', 'watch'];
  if (needsAuth.includes(cmd) && (!haUrl || !haToken)) {
    t.writeln(t.style.red('Error: Home Assistant not configured'));
    t.writeln('Run: tpkg config homeassistant');
    t.writeln('');
    t.writeln('You need a long-lived access token from Home Assistant.');
    t.writeln('Go to your HA profile page -> Long-Lived Access Tokens -> Create Token');
    t.exit(1);
  }

  const headers = {
    'Authorization': 'Bearer ' + haToken,
    'Content-Type': 'application/json'
  };

  switch (cmd) {
    case 'status': {
      const entityId = t.args[1] || t.config?.get?.('defaultEntity');
      if (!entityId) {
        t.writeln(t.style.red('Usage: homeassistant status <entity_id>'));
        t.writeln(t.style.dim('Example: homeassistant status light.living_room'));
        t.writeln(t.style.dim('Or set a default: tpkg config set homeassistant defaultEntity light.living_room'));
        t.exit(1);
      }

      t.writeln(t.style.dim('Fetching state of ' + entityId + '...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/states/' + entityId, { headers });
        if (!res.ok) {
          if (res.status === 404) {
            t.writeln(t.style.red('Entity not found: ' + entityId));
          } else {
            t.writeln(t.style.red('Error: HTTP ' + res.status));
          }
          t.exit(1);
        }
        const data = await res.json();
        t.writeln(t.style.bold(data.entity_id));
        const stateColor = data.state === 'on' ? 'green' : data.state === 'off' ? 'red' : 'yellow';
        t.writeln('  State: ' + t.style[stateColor](data.state));
        if (data.attributes) {
          const attrs = data.attributes;
          if (attrs.friendly_name) t.writeln('  Name:  ' + attrs.friendly_name);
          if (attrs.temperature !== undefined) t.writeln('  Temp:  ' + attrs.temperature + (attrs.unit_of_measurement || ''));
          if (attrs.humidity !== undefined) t.writeln('  Humidity: ' + attrs.humidity + '%');
          if (attrs.brightness !== undefined) t.writeln('  Brightness: ' + Math.round(attrs.brightness / 255 * 100) + '%');
          if (attrs.color_temp !== undefined) t.writeln('  Color Temp: ' + attrs.color_temp);
          if (attrs.current_temperature !== undefined) t.writeln('  Current: ' + attrs.current_temperature + (attrs.temperature_unit || ''));
          if (attrs.battery_level !== undefined) t.writeln('  Battery: ' + attrs.battery_level + '%');
          if (attrs.device_class) t.writeln('  Class: ' + attrs.device_class);
        }
        t.writeln('  Updated: ' + data.last_changed);
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'entities': {
      const filter = t.args[1] || '';
      t.writeln(t.style.dim('Fetching entities...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/states', { headers });
        if (!res.ok) {
          t.writeln(t.style.red('Error: HTTP ' + res.status));
          t.exit(1);
        }
        const entities = await res.json();
        const filtered = filter
          ? entities.filter(e => e.entity_id.includes(filter) || (e.attributes.friendly_name || '').toLowerCase().includes(filter.toLowerCase()))
          : entities;

        t.writeln(t.style.bold('Entities' + (filter ? ' matching "' + filter + '"' : '') + ' (' + filtered.length + ')'));
        t.writeln('');

        const grouped = {};
        for (const e of filtered) {
          const domain = e.entity_id.split('.')[0];
          if (!grouped[domain]) grouped[domain] = [];
          grouped[domain].push(e);
        }

        for (const [domain, items] of Object.entries(grouped)) {
          t.writeln(t.style.cyan(t.style.bold(domain)) + t.style.dim(' (' + items.length + ')'));
          for (const e of items) {
            const name = e.attributes.friendly_name || e.entity_id;
            const stateColor = e.state === 'on' ? 'green' : e.state === 'off' ? 'red' : 'yellow';
            t.writeln('  ' + t.style.dim(e.entity_id) + ' ' + t.style[stateColor](e.state));
          }
        }
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'toggle': {
      const entityId = t.args[1] || t.config?.get?.('defaultEntity');
      if (!entityId) {
        t.writeln(t.style.red('Usage: homeassistant toggle <entity_id>'));
        t.exit(1);
      }

      t.writeln(t.style.dim('Toggling ' + entityId + '...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/services/homeassistant/toggle', {
          method: 'POST',
          headers,
          body: JSON.stringify({ entity_id: entityId })
        });
        if (res.ok) {
          t.writeln(t.style.green('Toggled ' + entityId));
        } else {
          t.writeln(t.style.red('Error: HTTP ' + res.status));
          t.exit(1);
        }
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'turn-on': {
      const entityId = t.args[1] || t.config?.get?.('defaultEntity');
      if (!entityId) {
        t.writeln(t.style.red('Usage: homeassistant turn-on <entity_id>'));
        t.exit(1);
      }

      t.writeln(t.style.dim('Turning on ' + entityId + '...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/services/homeassistant/turn_on', {
          method: 'POST',
          headers,
          body: JSON.stringify({ entity_id: entityId })
        });
        if (res.ok) {
          t.writeln(t.style.green('Turned on ' + entityId));
        } else {
          t.writeln(t.style.red('Error: HTTP ' + res.status));
          t.exit(1);
        }
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'turn-off': {
      const entityId = t.args[1] || t.config?.get?.('defaultEntity');
      if (!entityId) {
        t.writeln(t.style.red('Usage: homeassistant turn-off <entity_id>'));
        t.exit(1);
      }

      t.writeln(t.style.dim('Turning off ' + entityId + '...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/services/homeassistant/turn_off', {
          method: 'POST',
          headers,
          body: JSON.stringify({ entity_id: entityId })
        });
        if (res.ok) {
          t.writeln(t.style.green('Turned off ' + entityId));
        } else {
          t.writeln(t.style.red('Error: HTTP ' + res.status));
          t.exit(1);
        }
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'call': {
      const domain = t.args[1];
      const service = t.args[2];
      if (!domain || !service) {
        t.writeln(t.style.red('Usage: homeassistant call <domain> <service> [entity_id]'));
        t.writeln(t.style.dim('Example: homeassistant call light turn_on light.bedroom'));
        t.exit(1);
      }
      const entityId = t.args[3];
      const payload = entityId ? { entity_id: entityId } : {};

      t.writeln(t.style.dim('Calling ' + domain + '.' + service + '...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/services/' + domain + '/' + service, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          t.writeln(t.style.green('Called ' + domain + '.' + service + (entityId ? ' on ' + entityId : '')));
        } else {
          t.writeln(t.style.red('Error: HTTP ' + res.status));
          t.exit(1);
        }
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'scenes': {
      t.writeln(t.style.dim('Fetching scenes...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/states', { headers });
        if (!res.ok) {
          t.writeln(t.style.red('Error: HTTP ' + res.status));
          const body = await res.text().catch(() => '');
          if (body) t.writeln(t.style.dim(body.substring(0, 200)));
          t.exit(1);
        }
        const entities = await res.json();
        if (!Array.isArray(entities)) {
          t.writeln(t.style.red('Unexpected response from Home Assistant'));
          t.writeln(t.style.dim('Received: ' + JSON.stringify(entities).substring(0, 200)));
          t.exit(1);
        }
        const scenes = entities.filter(e => e.entity_id.startsWith('scene.'));
        if (scenes.length === 0) {
          t.writeln(t.style.dim('No scenes found.'));
          t.writeln(t.style.dim('Total entities: ' + entities.length));
          t.writeln('');
          t.writeln(t.style.dim('Tip: Use "homeassistant automations" to list automations'));
          t.writeln(t.style.dim('     Use "homeassistant entities" to list all entities'));
        } else {
          t.writeln(t.style.bold('Scenes (' + scenes.length + ')'));
          for (const s of scenes) {
            const name = s.attributes.friendly_name || s.entity_id;
            t.writeln('  ' + t.style.cyan(s.entity_id) + '  ' + name);
          }
          t.writeln('');
          t.writeln(t.style.dim('Activate: homeassistant call scene turn_on <scene_id>'));
        }
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'automations': {
      t.writeln(t.style.dim('Fetching automations...'));
      try {
        const res = await t.net.fetch(haUrl + '/api/states', { headers });
        if (!res.ok) {
          t.writeln(t.style.red('Error: HTTP ' + res.status));
          t.exit(1);
        }
        const entities = await res.json();
        const autos = entities.filter(e => e.entity_id.startsWith('automation.'));
        if (autos.length === 0) {
          t.writeln(t.style.dim('No automations found.'));
        } else {
          t.writeln(t.style.bold('Automations (' + autos.length + ')'));
          for (const a of autos) {
            const name = a.attributes.friendly_name || a.entity_id;
            const stateColor = a.state === 'on' ? 'green' : 'red';
            t.writeln('  ' + t.style[stateColor](a.state === 'on' ? 'ON ' : 'OFF') + ' ' + name);
            t.writeln('      ' + t.style.dim(a.entity_id));
          }
        }
      } catch (err) {
        t.writeln(t.style.red('Error: ' + err.message));
        t.exit(1);
      }
      break;
    }

    case 'listen': {
      const filter = t.args[1] || '';
      const wsUrl = haUrl.replace(/^http/, 'ws') + '/api/websocket';
      t.writeln(t.style.dim('Connecting to ' + wsUrl + '...'));
      t.writeln(t.style.dim('Press any key to stop'));
      t.writeln('');

      let wsCleanup = () => {};

      const wsPromise = new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        let msgId = 1;
        let authenticated = false;
        let stopped = false;

        wsCleanup = () => {
          if (stopped) return;
          stopped = true;
          try { ws.close(); } catch(e) {}
          resolve(undefined);
        };

        ws.onopen = () => {
          t.writeln(t.style.green('Connected'));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'auth_required') {
              ws.send(JSON.stringify({ type: 'auth', access_token: haToken }));
              return;
            }

            if (msg.type === 'auth_ok') {
              authenticated = true;
              t.writeln(t.style.green('Authenticated (HA ' + msg.ha_version + ')'));
              t.writeln('');
              ws.send(JSON.stringify({
                id: msgId++,
                type: 'subscribe_events',
                event_type: 'state_changed'
              }));
              return;
            }

            if (msg.type === 'auth_invalid') {
              t.writeln(t.style.red('Authentication failed: ' + (msg.message || 'invalid token')));
              wsCleanup();
              return;
            }

            if (msg.type === 'result' && msg.success) {
              t.writeln(t.style.dim('Listening for state changes...'));
              return;
            }

            if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
              const data = msg.event.data;
              const entityId = data.entity_id || '';

              if (filter && !entityId.includes(filter)) return;

              const oldState = data.old_state?.state || '?';
              const newState = data.new_state?.state || '?';
              const name = data.new_state?.attributes?.friendly_name || entityId;
              const time = new Date().toLocaleTimeString();

              if (oldState !== newState) {
                const stateColor = newState === 'on' ? 'green' : newState === 'off' ? 'red' : 'yellow';
                t.writeln(t.style.dim(time) + ' ' + t.style.cyan(entityId));
                t.writeln('  ' + name + ': ' + oldState + ' \\u2192 ' + t.style[stateColor](newState));
              } else {
                t.writeln(t.style.dim(time + ' ' + entityId + ' (attributes updated)'));
              }
            }
          } catch(e) {}
        };

        ws.onerror = () => {
          t.writeln(t.style.red('WebSocket error'));
          wsCleanup();
        };

        ws.onclose = () => {
          if (authenticated && !stopped) {
            t.writeln(t.style.dim('Connection closed.'));
          }
          resolve(undefined);
        };
      });

      const keyPromise = t.readKey().then(() => {
        t.writeln('');
        t.writeln(t.style.dim('Disconnected.'));
        wsCleanup();
      });

      await Promise.race([wsPromise, keyPromise]);
      break;
    }

    case 'watch': {
      const watchEntity = t.args[1] || t.config?.get?.('defaultEntity');
      const execIdx = t.args.indexOf('--exec');
      const execCmd = execIdx !== -1 ? t.args.slice(execIdx + 1).join(' ') : '';

      if (!watchEntity) {
        t.writeln(t.style.red('Usage: homeassistant watch <entity_id> [--exec <command>]'));
        t.writeln(t.style.dim('Example: homeassistant watch binary_sensor.door --exec "echo Door changed!"'));
        t.exit(1);
      }

      const wsUrl = haUrl.replace(/^http/, 'ws') + '/api/websocket';
      t.writeln(t.style.dim('Watching ' + watchEntity + '...'));
      if (execCmd) t.writeln(t.style.dim('Will execute: ' + execCmd));
      t.writeln(t.style.dim('Press any key to stop'));
      t.writeln('');

      let wsCleanup = () => {};

      const wsPromise = new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        let msgId = 1;
        let stopped = false;

        wsCleanup = () => {
          if (stopped) return;
          stopped = true;
          try { ws.close(); } catch(e) {}
          resolve(undefined);
        };

        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'auth_required') {
              ws.send(JSON.stringify({ type: 'auth', access_token: haToken }));
              return;
            }

            if (msg.type === 'auth_ok') {
              ws.send(JSON.stringify({
                id: msgId++,
                type: 'subscribe_events',
                event_type: 'state_changed'
              }));
              return;
            }

            if (msg.type === 'auth_invalid') {
              t.writeln(t.style.red('Authentication failed'));
              wsCleanup();
              return;
            }

            if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
              const data = msg.event.data;
              if (data.entity_id !== watchEntity) return;

              const oldState = data.old_state?.state || '?';
              const newState = data.new_state?.state || '?';
              const name = data.new_state?.attributes?.friendly_name || data.entity_id;
              const time = new Date().toLocaleTimeString();

              const stateColor = newState === 'on' ? 'green' : newState === 'off' ? 'red' : 'yellow';
              t.writeln(t.style.dim(time) + ' ' + t.style.bold(name));
              t.writeln('  ' + oldState + ' \\u2192 ' + t.style[stateColor](newState));

              const oldAttrs = data.old_state?.attributes || {};
              const newAttrs = data.new_state?.attributes || {};
              for (const [k, v] of Object.entries(newAttrs)) {
                if (k === 'friendly_name' || k === 'icon') continue;
                if (JSON.stringify(oldAttrs[k]) !== JSON.stringify(v)) {
                  t.writeln('  ' + t.style.dim(k + ': ') + String(v));
                }
              }

              if (execCmd && oldState !== newState) {
                t.writeln(t.style.dim('  \\u2192 running: ' + execCmd));
                try {
                  const cmdWithVars = execCmd
                    .replace(/\\$ENTITY/g, data.entity_id)
                    .replace(/\\$OLD_STATE/g, oldState)
                    .replace(/\\$NEW_STATE/g, newState)
                    .replace(/\\$NAME/g, name);
                  await t.exec(cmdWithVars);
                } catch(e) {
                  t.writeln(t.style.red('  exec error: ' + e.message));
                }
              }
            }
          } catch(e) {}
        };

        ws.onerror = () => {
          t.writeln(t.style.red('WebSocket error'));
          wsCleanup();
        };

        ws.onclose = () => {
          resolve(undefined);
        };
      });

      const keyPromise = t.readKey().then(() => {
        t.writeln('');
        t.writeln(t.style.dim('Stopped watching.'));
        wsCleanup();
      });

      await Promise.race([wsPromise, keyPromise]);
      break;
    }

    default:
      t.writeln(t.style.bold('Home Assistant - Smart Home Control'));
      t.writeln('');
      t.writeln(t.style.cyan('Commands:'));
      t.writeln('  homeassistant status [entity]             - Show entity state');
      t.writeln('  homeassistant entities [filter]           - List all entities');
      t.writeln('  homeassistant toggle <entity>             - Toggle entity on/off');
      t.writeln('  homeassistant turn-on <entity>            - Turn entity on');
      t.writeln('  homeassistant turn-off <entity>           - Turn entity off');
      t.writeln('  homeassistant call <domain> <service> [entity] - Call any HA service');
      t.writeln('  homeassistant scenes                      - List available scenes');
      t.writeln('  homeassistant automations                 - List automations');
      t.writeln('  homeassistant listen [filter]             - Live event stream (WebSocket)');
      t.writeln('  homeassistant watch <entity> [--exec cmd] - Watch entity & run command');
      t.writeln('');
      t.writeln(t.style.cyan('Setup:'));
      t.writeln('  tpkg config homeassistant                 - Configure connection');
      t.writeln('');
      t.writeln(t.style.cyan('Watch variables:'));
      t.writeln(t.style.dim('  $ENTITY, $OLD_STATE, $NEW_STATE, $NAME'));
      t.writeln(t.style.dim('  Example: homeassistant watch sensor.temp --exec "echo $NAME is $NEW_STATE"'));
      t.writeln('');
      t.writeln(t.style.dim('Requires a Home Assistant long-lived access token.'));
      t.writeln(t.style.dim('Create one at: <your-ha-url>/profile -> Long-Lived Access Tokens'));
  }

  t.exit(0);
}`
  }
};
const PACKAGE_CONFIG_DIR = '/etc/tpkg';
const INSTALLED_PACKAGES_PATH = '/etc/tpkg/installed.json';
const REPOSITORIES_PATH = '/etc/tpkg/repositories.json';

/**
 * Parse a semver version string into components
 * Returns null for invalid versions
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;

  return 0;
}

/**
 * Check if version satisfies a version constraint
 * Supports: exact (1.0.0), caret (^1.0.0), tilde (~1.0.0), range (>=1.0.0)
 */
function satisfiesVersion(version: string, constraint: string): boolean {
  if (!constraint || constraint === '*') return true;

  const parsedVersion = parseVersion(version);
  if (!parsedVersion) return false;

  // Caret range (^1.0.0) - allows minor and patch updates
  if (constraint.startsWith('^')) {
    const constraintVersion = parseVersion(constraint.slice(1));
    if (!constraintVersion) return false;
    if (parsedVersion.major !== constraintVersion.major) return false;
    return compareVersions(version, constraint.slice(1)) >= 0;
  }

  // Tilde range (~1.0.0) - allows patch updates only
  if (constraint.startsWith('~')) {
    const constraintVersion = parseVersion(constraint.slice(1));
    if (!constraintVersion) return false;
    if (parsedVersion.major !== constraintVersion.major) return false;
    if (parsedVersion.minor !== constraintVersion.minor) return false;
    return compareVersions(version, constraint.slice(1)) >= 0;
  }

  // Greater than or equal (>=1.0.0)
  if (constraint.startsWith('>=')) {
    return compareVersions(version, constraint.slice(2)) >= 0;
  }

  // Greater than (>1.0.0)
  if (constraint.startsWith('>')) {
    return compareVersions(version, constraint.slice(1)) > 0;
  }

  // Less than or equal (<=1.0.0)
  if (constraint.startsWith('<=')) {
    return compareVersions(version, constraint.slice(2)) <= 0;
  }

  // Less than (<1.0.0)
  if (constraint.startsWith('<')) {
    return compareVersions(version, constraint.slice(1)) < 0;
  }

  // Exact match
  return compareVersions(version, constraint) === 0;
}

/**
 * Package manifest structure (package.tronos.json)
 */
interface PackageManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  files: string[];
  config?: PackageConfigParam[];
  dependencies?: string[];
  repository?: string;
}

/**
 * Configuration parameter schema
 */
interface PackageConfigParam {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'choice';
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  secret?: boolean;
  choices?: string[];
}

/**
 * Installed package record
 */
interface InstalledPackage {
  name: string;
  version: string;
  installedAt: string;
  files: string[];
  config?: PackageConfigParam[];
}

/**
 * Package index entry
 */
interface PackageIndexEntry {
  name: string;
  version: string;
  description: string;
  author?: string;
}

/**
 * Get a package config value, decrypting secrets automatically.
 * This is the API used by the runtime to provide t.config.get() to executables.
 *
 * @param packageName - The package name
 * @param key - The config key to retrieve
 * @param context - The execution context with VFS
 * @returns The config value (decrypted if secret), or undefined if not found
 */
export function getPackageConfigValue(
  packageName: string,
  key: string,
  context: ExecutionContext
): string | number | boolean | undefined {
  const vfs = context.vfs;
  if (!vfs) return undefined;

  const configPath = `${PACKAGE_CONFIG_DIR}/${packageName}/config.json`;
  if (!vfs.exists(configPath)) return undefined;

  try {
    const content = vfs.read(configPath);
    if (typeof content !== 'string') return undefined;

    const config = JSON.parse(content) as Record<string, string | number | boolean>;
    const value = config[key];

    if (value === undefined) return undefined;

    // Check if this is an encrypted secret
    if (typeof value === 'string') {
      const decrypted = decryptSecret(value, packageName);
      if (decrypted !== null) {
        return decrypted;
      }
    }

    return value;
  } catch {
    return undefined;
  }
}

/**
 * Set a package config value, encrypting if marked as secret.
 * This is the API used by the runtime to provide t.config.set() to executables.
 *
 * @param packageName - The package name
 * @param key - The config key to set
 * @param value - The value to set
 * @param context - The execution context with VFS
 * @returns True if the value was set successfully
 */
export function setPackageConfigValue(
  packageName: string,
  key: string,
  value: string | number | boolean,
  context: ExecutionContext
): boolean {
  const vfs = context.vfs;
  if (!vfs) return false;

  const installedPath = INSTALLED_PACKAGES_PATH;
  if (!vfs.exists(installedPath)) return false;

  try {
    // Load installed packages to check config schema
    const installedContent = vfs.read(installedPath);
    if (typeof installedContent !== 'string') return false;
    const installedList = JSON.parse(installedContent) as InstalledPackage[];
    const pkg = installedList.find(p => p.name === packageName);
    if (!pkg) return false;

    const configDir = `${PACKAGE_CONFIG_DIR}/${packageName}`;
    const configPath = `${configDir}/config.json`;

    // Ensure config directory exists
    if (!vfs.exists(configDir)) {
      vfs.mkdir(configDir, true);
    }

    // Load existing config
    let config: Record<string, string | number | boolean> = {};
    if (vfs.exists(configPath)) {
      const content = vfs.read(configPath);
      if (typeof content === 'string') {
        config = JSON.parse(content);
      }
    }

    // Check if this key is marked as secret
    const configParam = pkg.config?.find(p => p.key === key);
    const isSecret = configParam?.secret === true;

    // Encrypt secret values
    let finalValue = value;
    if (isSecret && typeof value === 'string') {
      finalValue = encryptSecret(value, packageName);
    }

    config[key] = finalValue;
    vfs.write(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the package name for an executable path.
 * This looks up the installed packages to find which package owns the given file.
 *
 * @param exePath - The path to the executable file (e.g., '/bin/weather.trx')
 * @param context - The execution context with VFS
 * @returns The package name if found, or undefined
 */
export function getPackageNameForExe(
  exePath: string,
  context: ExecutionContext
): string | undefined {
  const packages = loadInstalledPackages(context);

  for (const [name, pkg] of packages) {
    if (pkg.files.includes(exePath)) {
      return name;
    }
  }

  return undefined;
}

/**
 * Get missing required config keys for a package.
 * This checks which required config parameters don't have values set.
 *
 * @param packageName - The package name
 * @param context - The execution context with VFS
 * @returns Array of missing required config key names
 */
export function getMissingRequiredConfig(
  packageName: string,
  context: ExecutionContext
): string[] {
  const packages = loadInstalledPackages(context);
  const pkg = packages.get(packageName);

  if (!pkg || !pkg.config) {
    return [];
  }

  const missing: string[] = [];

  for (const param of pkg.config) {
    if (param.required) {
      const value = getPackageConfigValue(packageName, param.key, context);
      if (value === undefined) {
        missing.push(param.key);
      }
    }
  }

  return missing;
}

/**
 * Ensure required directories exist
 */
async function ensureDirectories(context: ExecutionContext): Promise<void> {
  const vfs = context.vfs;
  if (!vfs) return;

  const dirs = [
    '/var',
    '/var/cache',
    '/var/cache/tpkg',
    '/etc/tpkg',
  ];

  for (const dir of dirs) {
    if (!vfs.exists(dir)) {
      vfs.mkdir(dir, true);
    }
  }
}

/**
 * Load installed packages from VFS
 */
function loadInstalledPackages(context: ExecutionContext): Map<string, InstalledPackage> {
  const vfs = context.vfs;
  if (!vfs || !vfs.exists(INSTALLED_PACKAGES_PATH)) {
    return new Map();
  }

  try {
    const content = vfs.read(INSTALLED_PACKAGES_PATH);
    if (typeof content === 'string') {
      const data = JSON.parse(content) as InstalledPackage[];
      return new Map(data.map(pkg => [pkg.name, pkg]));
    }
  } catch {
    // Ignore parse errors, return empty map
  }
  return new Map();
}

/**
 * Save installed packages to VFS
 */
function saveInstalledPackages(context: ExecutionContext, packages: Map<string, InstalledPackage>): void {
  const vfs = context.vfs;
  if (!vfs) return;

  const data = Array.from(packages.values());
  vfs.write(INSTALLED_PACKAGES_PATH, JSON.stringify(data, null, 2));
}

/**
 * Load configured repositories
 */
function loadRepositories(context: ExecutionContext): string[] {
  const vfs = context.vfs;
  if (!vfs || !vfs.exists(REPOSITORIES_PATH)) {
    return [DEFAULT_REPOSITORY];
  }

  try {
    const content = vfs.read(REPOSITORIES_PATH);
    if (typeof content === 'string') {
      const repos = JSON.parse(content) as string[];
      return repos.length > 0 ? repos : [DEFAULT_REPOSITORY];
    }
  } catch {
    // Ignore parse errors
  }
  return [DEFAULT_REPOSITORY];
}

/**
 * Save repositories to VFS
 */
function saveRepositories(context: ExecutionContext, repositories: string[]): void {
  const vfs = context.vfs;
  if (!vfs) return;

  vfs.write(REPOSITORIES_PATH, JSON.stringify(repositories, null, 2));
}

/**
 * Load package index from cache
 */
function loadPackageIndex(context: ExecutionContext): PackageIndexEntry[] {
  const vfs = context.vfs;
  if (!vfs || !vfs.exists(PACKAGE_INDEX_PATH)) {
    return [];
  }

  try {
    const content = vfs.read(PACKAGE_INDEX_PATH);
    if (typeof content === 'string') {
      return JSON.parse(content) as PackageIndexEntry[];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Save package index to cache
 */
function savePackageIndex(context: ExecutionContext, index: PackageIndexEntry[]): void {
  const vfs = context.vfs;
  if (!vfs) return;

  vfs.write(PACKAGE_INDEX_PATH, JSON.stringify(index, null, 2));
}

/**
 * Fetch package index from repository
 * Falls back to bundled index for the default repository
 */
async function fetchPackageIndex(repoUrl: string): Promise<PackageIndexEntry[]> {
  try {
    const url = `${repoUrl}/packages.json`;
    const response = await aiosFetch(url, { method: 'GET' });
    if (!response.ok) {
      // Fall back to bundled index for default repository
      if (repoUrl === DEFAULT_REPOSITORY) {
        return [...BUNDLED_PACKAGE_INDEX];
      }
      return [];
    }
    const text = await response.text();
    return JSON.parse(text) as PackageIndexEntry[];
  } catch {
    // Fall back to bundled index for default repository
    if (repoUrl === DEFAULT_REPOSITORY) {
      return [...BUNDLED_PACKAGE_INDEX];
    }
    return [];
  }
}

/**
 * Fetch package manifest from repository
 * Falls back to bundled manifests for the default repository
 */
async function fetchPackageManifest(repoUrl: string, packageName: string): Promise<PackageManifest | null> {
  try {
    const url = `${repoUrl}/packages/${packageName}/package.tronos.json`;
    const response = await aiosFetch(url, { method: 'GET' });
    if (!response.ok) {
      // Fall back to bundled manifest for default repository
      if (repoUrl === DEFAULT_REPOSITORY && BUNDLED_PACKAGE_MANIFESTS[packageName]) {
        return { ...BUNDLED_PACKAGE_MANIFESTS[packageName] };
      }
      return null;
    }
    const text = await response.text();
    return JSON.parse(text) as PackageManifest;
  } catch {
    // Fall back to bundled manifest for default repository
    if (repoUrl === DEFAULT_REPOSITORY && BUNDLED_PACKAGE_MANIFESTS[packageName]) {
      return { ...BUNDLED_PACKAGE_MANIFESTS[packageName] };
    }
    return null;
  }
}

/**
 * Fetch package file from repository
 * Falls back to bundled files for the default repository
 */
async function fetchPackageFile(repoUrl: string, packageName: string, fileName: string): Promise<string | null> {
  try {
    const url = `${repoUrl}/packages/${packageName}/${fileName}`;
    const response = await aiosFetch(url, { method: 'GET' });
    if (!response.ok) {
      // Fall back to bundled files for default repository
      if (repoUrl === DEFAULT_REPOSITORY && BUNDLED_PACKAGE_FILES[packageName]?.[fileName]) {
        return BUNDLED_PACKAGE_FILES[packageName][fileName];
      }
      return null;
    }
    return await response.text();
  } catch {
    // Fall back to bundled files for default repository
    if (repoUrl === DEFAULT_REPOSITORY && BUNDLED_PACKAGE_FILES[packageName]?.[fileName]) {
      return BUNDLED_PACKAGE_FILES[packageName][fileName];
    }
    return null;
  }
}

/**
 * tpkg install <package> - Install package from repository
 */
async function installPackage(packageName: string, context: ExecutionContext): Promise<CommandResult> {
  await ensureDirectories(context);
  const vfs = context.vfs;
  if (!vfs) {
    return { stdout: '', stderr: 'tpkg: filesystem not available', exitCode: 1 };
  }

  // Check if already installed
  const installed = loadInstalledPackages(context);
  if (installed.has(packageName)) {
    const pkg = installed.get(packageName)!;
    return {
      stdout: '',
      stderr: `tpkg: package '${packageName}' is already installed (version ${pkg.version})\nUse 'tpkg upgrade ${packageName}' to upgrade.`,
      exitCode: 1
    };
  }

  const repositories = loadRepositories(context);
  let manifest: PackageManifest | null = null;
  let sourceRepo: string | null = null;

  // Try each repository
  for (const repo of repositories) {
    manifest = await fetchPackageManifest(repo, packageName);
    if (manifest) {
      sourceRepo = repo;
      break;
    }
  }

  if (!manifest || !sourceRepo) {
    return {
      stdout: '',
      stderr: `tpkg: package '${packageName}' not found\nTry 'tpkg update' to refresh the package index, or 'tpkg search ${packageName}' to find similar packages.`,
      exitCode: 1
    };
  }

  const output: string[] = [];
  output.push(`Installing ${manifest.name} (${manifest.version})...`);

  // Check dependencies
  if (manifest.dependencies && manifest.dependencies.length > 0) {
    for (const dep of manifest.dependencies) {
      if (!installed.has(dep)) {
        output.push(`  Installing dependency: ${dep}`);
        const depResult = await installPackage(dep, context);
        if (depResult.exitCode !== 0) {
          return {
            stdout: output.join('\n'),
            stderr: `tpkg: failed to install dependency '${dep}'`,
            exitCode: 1
          };
        }
      }
    }
  }

  // Download and install files
  const installedFiles: string[] = [];
  for (const file of manifest.files) {
    const content = await fetchPackageFile(sourceRepo, packageName, file);
    if (content === null) {
      return {
        stdout: output.join('\n'),
        stderr: `tpkg: failed to download file '${file}'`,
        exitCode: 1
      };
    }

    const destPath = `/bin/${file}`;
    vfs.write(destPath, content);
    installedFiles.push(destPath);
    output.push(`  Installed: ${destPath}`);
  }

  // Create config directory for package if it has configurable options
  if (manifest.config && manifest.config.length > 0) {
    const configDir = `${PACKAGE_CONFIG_DIR}/${packageName}`;
    if (!vfs.exists(configDir)) {
      vfs.mkdir(configDir, true);
    }

    // Build config values - prompt interactively if terminal available
    const configValues: Record<string, string | number | boolean> = {};
    const terminal = context.terminal as TerminalAPI | undefined;
    const interactive = isInteractive(context);

    // Separate required params (with no default) from optional ones
    const requiredParams = manifest.config.filter(p => p.required && p.default === undefined);
    const optionalParams = manifest.config.filter(p => !p.required || p.default !== undefined);

    // Prompt for required config if interactive
    if (requiredParams.length > 0 && interactive) {
      // Write current output first
      if (terminal) {
        for (const line of output) {
          terminal.write(line + '\r\n');
        }
        output.length = 0; // Clear output since we wrote it
      }

      terminal?.write('\r\n');
      terminal?.write('  This package requires configuration:\r\n');
      terminal?.write('\r\n');

      for (const param of requiredParams) {
        // Build prompt string
        let promptText = `  ${param.key}`;
        if (param.type === 'choice' && param.choices) {
          promptText += ` (${param.choices.join('/')})`;
        } else if (param.type === 'boolean') {
          promptText += ' (yes/no)';
        } else if (param.type === 'number') {
          promptText += ' (number)';
        }
        promptText += ': ';

        // Show description
        terminal?.write(`  ${param.description}\r\n`);

        // Prompt for value (with retry on validation failure)
        let value: string | number | boolean | undefined;
        let valid = false;
        while (!valid) {
          const input = param.secret
            ? await readPassword(terminal, promptText)
            : await readLine(terminal, promptText);

          const [isValid, parsedValue, error] = validateConfigInput(input, param);
          if (!isValid) {
            terminal?.write(`  Error: ${error}\r\n`);
            continue;
          }

          if (parsedValue !== undefined) {
            // Encrypt secret values
            if (param.secret && typeof parsedValue === 'string') {
              value = encryptSecret(parsedValue, packageName);
            } else {
              value = parsedValue;
            }
            valid = true;
          } else if (!param.required) {
            // Optional param with no input and no default - skip
            valid = true;
          } else {
            terminal?.write(`  Error: Value is required\r\n`);
          }
        }

        if (value !== undefined) {
          configValues[param.key] = value;
        }
        terminal?.write('\r\n');
      }
    } else if (requiredParams.length > 0) {
      // Non-interactive mode - just note that config is required
      output.push('');
      output.push('  ⚠ This package requires configuration:');
      for (const param of requiredParams) {
        output.push(`    - ${param.key}: ${param.description}`);
      }
      output.push(`  Run 'tpkg config ${packageName}' to configure.`);
    }

    // Set default values for optional params
    for (const param of optionalParams) {
      if (param.default !== undefined) {
        configValues[param.key] = param.default;
      }
    }

    vfs.write(`${configDir}/config.json`, JSON.stringify(configValues, null, 2));
    output.push(`  Configuration directory: ${configDir}`);
  }

  // Record installation (including config schema for secret handling)
  installed.set(packageName, {
    name: packageName,
    version: manifest.version,
    installedAt: new Date().toISOString(),
    files: installedFiles,
    config: manifest.config
  });
  saveInstalledPackages(context, installed);

  output.push('');
  output.push(`✓ Successfully installed ${manifest.name} (${manifest.version})`);

  return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 0 };
}

/**
 * tpkg uninstall <package> - Remove installed package
 */
async function uninstallPackage(packageName: string, context: ExecutionContext): Promise<CommandResult> {
  const vfs = context.vfs;
  if (!vfs) {
    return { stdout: '', stderr: 'tpkg: filesystem not available', exitCode: 1 };
  }

  const installed = loadInstalledPackages(context);
  const pkg = installed.get(packageName);

  if (!pkg) {
    return { stdout: '', stderr: `tpkg: package '${packageName}' is not installed`, exitCode: 1 };
  }

  const output: string[] = [];
  output.push(`Removing ${packageName}...`);

  // Remove installed files
  for (const file of pkg.files) {
    if (vfs.exists(file)) {
      vfs.remove(file);
      output.push(`  Removed: ${file}`);
    }
  }

  // Remove config directory
  const configDir = `${PACKAGE_CONFIG_DIR}/${packageName}`;
  if (vfs.exists(configDir)) {
    vfs.remove(configDir, true);
    output.push(`  Removed config: ${configDir}`);
  }

  // Update installed packages list
  installed.delete(packageName);
  saveInstalledPackages(context, installed);

  output.push('');
  output.push(`✓ Successfully removed ${packageName}`);

  return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 0 };
}

/**
 * tpkg update - Update package index
 */
async function updateIndex(context: ExecutionContext): Promise<CommandResult> {
  await ensureDirectories(context);

  const repositories = loadRepositories(context);
  const output: string[] = [];
  const allPackages: PackageIndexEntry[] = [];

  output.push('Updating package index...');

  for (const repo of repositories) {
    output.push(`  Fetching from ${repo}...`);
    const packages = await fetchPackageIndex(repo);
    if (packages.length > 0) {
      allPackages.push(...packages);
      output.push(`    Found ${packages.length} package(s)`);
    } else {
      output.push(`    No packages found or repository unavailable`);
    }
  }

  savePackageIndex(context, allPackages);
  output.push('');
  output.push(`✓ Package index updated (${allPackages.length} packages available)`);

  return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 0 };
}

/**
 * tpkg upgrade <package> - Upgrade package to latest version
 */
async function upgradePackage(packageName: string, context: ExecutionContext): Promise<CommandResult> {
  const installed = loadInstalledPackages(context);
  const pkg = installed.get(packageName);

  if (!pkg) {
    return { stdout: '', stderr: `tpkg: package '${packageName}' is not installed`, exitCode: 1 };
  }

  // Check for newer version in repositories
  const repositories = loadRepositories(context);
  let latestManifest: PackageManifest | null = null;

  for (const repo of repositories) {
    const manifest = await fetchPackageManifest(repo, packageName);
    if (manifest) {
      if (!latestManifest || compareVersions(manifest.version, latestManifest.version) > 0) {
        latestManifest = manifest;
      }
    }
  }

  if (!latestManifest) {
    return {
      stdout: '',
      stderr: `tpkg: could not find package '${packageName}' in any repository`,
      exitCode: 1
    };
  }

  // Compare versions
  const comparison = compareVersions(latestManifest.version, pkg.version);
  if (comparison === 0) {
    return {
      stdout: `${packageName} is already at version ${pkg.version} (latest)\n`,
      stderr: '',
      exitCode: 0
    };
  } else if (comparison < 0) {
    return {
      stdout: `${packageName} installed version ${pkg.version} is newer than repository version ${latestManifest.version}\n`,
      stderr: '',
      exitCode: 0
    };
  }

  const output: string[] = [];
  output.push(`Upgrading ${packageName} from ${pkg.version} to ${latestManifest.version}...`);

  // Uninstall old version
  const uninstallResult = await uninstallPackage(packageName, context);
  if (uninstallResult.exitCode !== 0) {
    return uninstallResult;
  }

  // Install new version
  const installResult = await installPackage(packageName, context);
  if (installResult.exitCode !== 0) {
    return installResult;
  }

  output.push(`✓ Successfully upgraded ${packageName} to ${latestManifest.version}`);
  return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 0 };
}

/**
 * tpkg available - List all available packages in the index
 */
async function listAvailablePackages(context: ExecutionContext): Promise<CommandResult> {
  let index = loadPackageIndex(context);

  // If no cached index, try to fetch
  if (index.length === 0) {
    const repositories = loadRepositories(context);
    for (const repo of repositories) {
      const packages = await fetchPackageIndex(repo);
      index.push(...packages);
    }
  }

  if (index.length === 0) {
    return {
      stdout: '',
      stderr: "tpkg: no packages in index. Run 'tpkg update' to refresh.",
      exitCode: 1
    };
  }

  const output: string[] = [];
  output.push(`Available packages (${index.length}):\n`);

  const installed = loadInstalledPackages(context);
  for (const pkg of index) {
    const isInstalled = installed.has(pkg.name);
    const installedPkg = installed.get(pkg.name);
    let status = '';
    if (isInstalled && installedPkg) {
      const versionCompare = compareVersions(pkg.version, installedPkg.version);
      if (versionCompare > 0) {
        status = ` [installed: ${installedPkg.version}, update available]`;
      } else {
        status = ' [installed]';
      }
    }
    output.push(`  ${pkg.name} (${pkg.version})${status}`);
    output.push(`    ${pkg.description}`);
    output.push('');
  }

  return { stdout: output.join('\n'), stderr: '', exitCode: 0 };
}

/**
 * tpkg search <term> - Search available packages
 */
async function searchPackages(term: string, context: ExecutionContext): Promise<CommandResult> {
  let index = loadPackageIndex(context);

  // If no cached index, try to fetch
  if (index.length === 0) {
    const repositories = loadRepositories(context);
    for (const repo of repositories) {
      const packages = await fetchPackageIndex(repo);
      index.push(...packages);
    }
  }

  if (index.length === 0) {
    return {
      stdout: '',
      stderr: "tpkg: no packages in index. Run 'tpkg update' to refresh.",
      exitCode: 1
    };
  }

  const termLower = term.toLowerCase();
  const matches = index.filter(pkg =>
    pkg.name.toLowerCase().includes(termLower) ||
    pkg.description.toLowerCase().includes(termLower)
  );

  if (matches.length === 0) {
    return { stdout: `No packages found matching '${term}'\n`, stderr: '', exitCode: 0 };
  }

  const output: string[] = [];
  output.push(`Found ${matches.length} package(s) matching '${term}':\n`);

  const installed = loadInstalledPackages(context);
  for (const pkg of matches) {
    const isInstalled = installed.has(pkg.name);
    const installedPkg = installed.get(pkg.name);
    let status = '';
    if (isInstalled && installedPkg) {
      const versionCompare = compareVersions(pkg.version, installedPkg.version);
      if (versionCompare > 0) {
        status = ` [installed: ${installedPkg.version}, update available]`;
      } else {
        status = ' [installed]';
      }
    }
    output.push(`  ${pkg.name} (${pkg.version})${status}`);
    output.push(`    ${pkg.description}`);
    output.push('');
  }

  return { stdout: output.join('\n'), stderr: '', exitCode: 0 };
}

/**
 * tpkg list - Show installed packages
 */
async function listPackages(context: ExecutionContext): Promise<CommandResult> {
  const installed = loadInstalledPackages(context);

  if (installed.size === 0) {
    return { stdout: 'No packages installed.\n', stderr: '', exitCode: 0 };
  }

  const output: string[] = [];
  output.push(`Installed packages (${installed.size}):\n`);

  for (const [name, pkg] of installed) {
    output.push(`  ${name} (${pkg.version})`);
    output.push(`    Installed: ${pkg.installedAt}`);
    output.push(`    Files: ${pkg.files.join(', ')}`);
    output.push('');
  }

  return { stdout: output.join('\n'), stderr: '', exitCode: 0 };
}

/**
 * tpkg info <package> - Show package details
 */
async function showPackageInfo(packageName: string, context: ExecutionContext): Promise<CommandResult> {
  // First check if installed
  const installed = loadInstalledPackages(context);
  const installedPkg = installed.get(packageName);

  // Try to get manifest from repos
  const repositories = loadRepositories(context);
  let manifest: PackageManifest | null = null;

  for (const repo of repositories) {
    manifest = await fetchPackageManifest(repo, packageName);
    if (manifest) break;
  }

  // Also check local index
  const index = loadPackageIndex(context);
  const indexEntry = index.find(p => p.name === packageName);

  if (!manifest && !installedPkg && !indexEntry) {
    return { stdout: '', stderr: `tpkg: package '${packageName}' not found`, exitCode: 1 };
  }

  const output: string[] = [];

  if (manifest) {
    output.push(`Package: ${manifest.name}`);
    output.push(`Version: ${manifest.version}`);
    output.push(`Description: ${manifest.description}`);
    if (manifest.author) output.push(`Author: ${manifest.author}`);
    if (manifest.license) output.push(`License: ${manifest.license}`);
    output.push(`Files: ${manifest.files.join(', ')}`);

    if (manifest.dependencies && manifest.dependencies.length > 0) {
      output.push(`Dependencies: ${manifest.dependencies.join(', ')}`);
    }

    if (manifest.config && manifest.config.length > 0) {
      output.push('');
      output.push('Configuration options:');
      for (const param of manifest.config) {
        const required = param.required ? ' (required)' : '';
        const secret = param.secret ? ' [secret]' : '';
        const defaultVal = param.default !== undefined ? ` [default: ${param.default}]` : '';
        output.push(`  ${param.key}: ${param.type}${required}${secret}${defaultVal}`);
        output.push(`    ${param.description}`);
        if (param.choices) {
          output.push(`    Choices: ${param.choices.join(', ')}`);
        }
      }
    }
  } else if (indexEntry) {
    output.push(`Package: ${indexEntry.name}`);
    output.push(`Version: ${indexEntry.version}`);
    output.push(`Description: ${indexEntry.description}`);
    if (indexEntry.author) output.push(`Author: ${indexEntry.author}`);
  }

  output.push('');
  if (installedPkg) {
    output.push(`Status: Installed (${installedPkg.version})`);
    output.push(`Installed: ${installedPkg.installedAt}`);
  } else {
    output.push('Status: Not installed');
  }

  return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 0 };
}

/**
 * tpkg repo add/remove/list - Manage repositories
 */
async function manageRepositories(args: string[], context: ExecutionContext): Promise<CommandResult> {
  await ensureDirectories(context);

  const subcommand = args[0];
  const repos = loadRepositories(context);

  switch (subcommand) {
    case 'add': {
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg repo add <url>', exitCode: 1 };
      }
      const url = args[1];
      if (repos.includes(url)) {
        return { stdout: '', stderr: `tpkg: repository '${url}' is already configured`, exitCode: 1 };
      }
      repos.push(url);
      saveRepositories(context, repos);
      return { stdout: `Added repository: ${url}\n`, stderr: '', exitCode: 0 };
    }

    case 'remove': {
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg repo remove <url>', exitCode: 1 };
      }
      const url = args[1];
      const index = repos.indexOf(url);
      if (index === -1) {
        return { stdout: '', stderr: `tpkg: repository '${url}' is not configured`, exitCode: 1 };
      }
      repos.splice(index, 1);
      saveRepositories(context, repos);
      return { stdout: `Removed repository: ${url}\n`, stderr: '', exitCode: 0 };
    }

    case 'list':
    default: {
      const output: string[] = [];
      output.push('Configured repositories:');
      for (const repo of repos) {
        const isDefault = repo === DEFAULT_REPOSITORY ? ' (default)' : '';
        output.push(`  ${repo}${isDefault}`);
      }
      return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 0 };
    }
  }
}

/**
 * tpkg config <package> - Configure installed package (interactive if terminal available)
 */
async function configurePackage(packageName: string, context: ExecutionContext, interactive?: boolean): Promise<CommandResult> {
  const vfs = context.vfs;
  if (!vfs) {
    return { stdout: '', stderr: 'tpkg: filesystem not available', exitCode: 1 };
  }

  const installed = loadInstalledPackages(context);
  const pkg = installed.get(packageName);
  if (!pkg) {
    return { stdout: '', stderr: `tpkg: package '${packageName}' is not installed`, exitCode: 1 };
  }

  // Get manifest to show config options - first try from installed package record
  let configSchema = pkg.config;

  // If not in installed record, try to fetch from repo
  if (!configSchema) {
    const repositories = loadRepositories(context);
    for (const repo of repositories) {
      const manifest = await fetchPackageManifest(repo, packageName);
      if (manifest?.config) {
        configSchema = manifest.config;
        break;
      }
    }
  }

  const configDir = `${PACKAGE_CONFIG_DIR}/${packageName}`;
  const configPath = `${configDir}/config.json`;
  let currentConfig: Record<string, string | number | boolean> = {};

  if (vfs.exists(configPath)) {
    try {
      const content = vfs.read(configPath);
      if (typeof content === 'string') {
        currentConfig = JSON.parse(content);
      }
    } catch {
      // Ignore parse errors
    }
  }

  const terminal = context.terminal as TerminalAPI | undefined;
  const shouldPrompt = interactive !== false && isInteractive(context);

  // If interactive mode, prompt for each config option
  if (shouldPrompt && configSchema && configSchema.length > 0) {
    terminal?.write(`\r\nConfiguration for ${packageName}:\r\n\r\n`);

    // Ensure config directory exists
    if (!vfs.exists(configDir)) {
      vfs.mkdir(configDir, true);
    }

    for (const param of configSchema) {
      // Show current value
      const currentValue = currentConfig[param.key];
      let displayCurrent = '';
      if (currentValue !== undefined) {
        if (param.secret) {
          displayCurrent = ' [current: ********]';
        } else {
          displayCurrent = ` [current: ${currentValue}]`;
        }
      } else if (param.default !== undefined) {
        displayCurrent = ` [default: ${param.default}]`;
      }

      // Build prompt string
      let promptText = `  ${param.key}`;
      if (param.type === 'choice' && param.choices) {
        promptText += ` (${param.choices.join('/')})`;
      } else if (param.type === 'boolean') {
        promptText += ' (yes/no)';
      } else if (param.type === 'number') {
        promptText += ' (number)';
      }
      promptText += `${displayCurrent}: `;

      // Show description
      terminal?.write(`  ${param.description}\r\n`);
      const required = param.required ? ' (required)' : '';
      terminal?.write(`  Type: ${param.type}${required}\r\n`);

      // Prompt for value
      const input = param.secret
        ? await readPassword(terminal, promptText)
        : await readLine(terminal, promptText);

      // Skip if empty (keep current value or default)
      if (input.trim() === '') {
        terminal?.write('\r\n');
        continue;
      }

      // Validate input
      const [isValid, parsedValue, error] = validateConfigInput(input, param);
      if (!isValid) {
        terminal?.write(`  Error: ${error}\r\n\r\n`);
        continue;
      }

      if (parsedValue !== undefined) {
        // Encrypt secret values
        if (param.secret && typeof parsedValue === 'string') {
          currentConfig[param.key] = encryptSecret(parsedValue, packageName);
        } else {
          currentConfig[param.key] = parsedValue;
        }
        terminal?.write(`  ✓ Set ${param.key}\r\n`);
      }
      terminal?.write('\r\n');
    }

    // Save config
    vfs.write(configPath, JSON.stringify(currentConfig, null, 2));

    terminal?.write(`Configuration saved to ${configPath}\r\n`);
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  // Non-interactive mode - just show current config
  const output: string[] = [];
  output.push(`Configuration for ${packageName}:`);
  output.push('');

  if (configSchema && configSchema.length > 0) {
    for (const param of configSchema) {
      const value = currentConfig[param.key];
      const displayValue = param.secret && value ? '********' : (value ?? '(not set)');
      const required = param.required && value === undefined ? ' ⚠ required' : '';
      output.push(`  ${param.key}: ${displayValue}${required}`);
      output.push(`    ${param.description}`);
    }
    output.push('');
    output.push('To set a value: tpkg config set <package> <key> <value>');
    output.push('To configure interactively, run in a terminal.');
  } else {
    output.push('  No configuration options available for this package.');
  }

  return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 0 };
}

/**
 * tpkg config set <package> <key> <value> - Set config value
 */
async function setConfigValue(args: string[], context: ExecutionContext): Promise<CommandResult> {
  if (args.length < 3) {
    return { stdout: '', stderr: 'Usage: tpkg config set <package> <key> <value>', exitCode: 1 };
  }

  const vfs = context.vfs;
  if (!vfs) {
    return { stdout: '', stderr: 'tpkg: filesystem not available', exitCode: 1 };
  }

  const [packageName, key, ...valueParts] = args;
  const value = valueParts.join(' ');

  const installed = loadInstalledPackages(context);
  const pkg = installed.get(packageName);
  if (!pkg) {
    return { stdout: '', stderr: `tpkg: package '${packageName}' is not installed`, exitCode: 1 };
  }

  const configDir = `${PACKAGE_CONFIG_DIR}/${packageName}`;
  const configPath = `${configDir}/config.json`;

  // Ensure config directory exists
  if (!vfs.exists(configDir)) {
    vfs.mkdir(configDir, true);
  }

  let currentConfig: Record<string, string | number | boolean> = {};
  if (vfs.exists(configPath)) {
    try {
      const content = vfs.read(configPath);
      if (typeof content === 'string') {
        currentConfig = JSON.parse(content);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check if this key is marked as secret in the package config schema
  const configParam = pkg.config?.find(p => p.key === key);
  const isSecret = configParam?.secret === true;

  // Try to parse as number or boolean (only for non-secrets)
  let parsedValue: string | number | boolean = value;
  if (!isSecret) {
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (!isNaN(Number(value))) parsedValue = Number(value);
  }

  // Encrypt secret values
  if (isSecret && typeof parsedValue === 'string') {
    parsedValue = encryptSecret(parsedValue, packageName);
  }

  currentConfig[key] = parsedValue;
  vfs.write(configPath, JSON.stringify(currentConfig, null, 2));

  return { stdout: `Set ${packageName}.${key} = ${isSecret ? '********' : value}\n`, stderr: '', exitCode: 0 };
}

/**
 * Main tpkg command handler
 */
export const tpkg: BuiltinCommand = async (args: string[], context: ExecutionContext): Promise<CommandResult> => {
  const subcommand = args[0] || 'help';

  switch (subcommand) {
    case 'install':
    case 'i':
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg install <package>', exitCode: 1 };
      }
      return installPackage(args[1], context);

    case 'uninstall':
    case 'remove':
    case 'rm':
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg uninstall <package>', exitCode: 1 };
      }
      return uninstallPackage(args[1], context);

    case 'update':
      return updateIndex(context);

    case 'upgrade':
    case 'up':
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg upgrade <package>', exitCode: 1 };
      }
      return upgradePackage(args[1], context);

    case 'search':
    case 's':
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg search <term>', exitCode: 1 };
      }
      return searchPackages(args[1], context);

    case 'list':
    case 'ls':
      return listPackages(context);

    case 'available':
    case 'avail':
      return listAvailablePackages(context);

    case 'info':
    case 'show':
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg info <package>', exitCode: 1 };
      }
      return showPackageInfo(args[1], context);

    case 'repo':
      return manageRepositories(args.slice(1), context);

    case 'config':
      if (args.length < 2) {
        return { stdout: '', stderr: 'Usage: tpkg config <package> or tpkg config set <package> <key> <value>', exitCode: 1 };
      }
      if (args[1] === 'set') {
        return setConfigValue(args.slice(2), context);
      }
      return configurePackage(args[1], context);

    case 'help':
    case '-h':
    case '--help':
    default:
      return {
        stdout: `tpkg - TronOS Package Manager

Usage: tpkg <command> [arguments]

Commands:
  install <package>     Install a package from the repository
  uninstall <package>   Remove an installed package
  update                Update the package index
  upgrade <package>     Upgrade a package to the latest version
  search <term>         Search for packages
  list                  List installed packages
  available             List all available packages in the index
  info <package>        Show package details and configuration options
  repo add <url>        Add a package repository
  repo remove <url>     Remove a package repository
  repo list             List configured repositories
  config <package>      Show/edit package configuration
  config set <pkg> <key> <value>
                        Set a configuration value

Aliases:
  i      → install
  rm     → uninstall
  up     → upgrade
  s      → search
  ls     → list
  avail  → available
  show   → info

Examples:
  tpkg update           Update package index
  tpkg available        List all available packages
  tpkg search weather   Search for weather packages
  tpkg install weather  Install the weather package
  tpkg config weather   Configure the weather package
  tpkg list             List installed packages
`,
        stderr: '',
        exitCode: subcommand === 'help' || subcommand === '-h' || subcommand === '--help' ? 0 : 1
      };
  }
};

// Export semver functions for testing and external use
export { parseVersion, compareVersions, satisfiesVersion };

// Export bundled package data for testing
export { BUNDLED_PACKAGE_INDEX, BUNDLED_PACKAGE_MANIFESTS, BUNDLED_PACKAGE_FILES };

// Export config validation for testing
export { validateConfigInput };
