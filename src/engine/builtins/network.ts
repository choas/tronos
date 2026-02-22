/**
 * Network builtin commands - curl and fetch
 * See spec Section 13.2
 */

import type { BuiltinCommand } from '../types';
import { aiosFetch } from '../../network/fetch';

/**
 * Parse curl-style arguments
 * Supports: -X method, -H header, -d data, -o output, -i (include headers), -s (silent)
 */
function parseCurlArgs(args: string[]): {
  url: string | null;
  method: string;
  headers: Record<string, string>;
  data: string | null;
  output: string | null;
  includeHeaders: boolean;
  silent: boolean;
  error: string | null;
} {
  const result = {
    url: null as string | null,
    method: 'GET',
    headers: {} as Record<string, string>,
    data: null as string | null,
    output: null as string | null,
    includeHeaders: false,
    silent: false,
    error: null as string | null,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '-X' || arg === '--request') {
      if (i + 1 >= args.length) {
        result.error = 'curl: option -X requires an argument';
        return result;
      }
      result.method = args[++i].toUpperCase();
    } else if (arg === '-H' || arg === '--header') {
      if (i + 1 >= args.length) {
        result.error = 'curl: option -H requires an argument';
        return result;
      }
      const header = args[++i];
      const colonIndex = header.indexOf(':');
      if (colonIndex === -1) {
        result.error = `curl: invalid header format: ${header}`;
        return result;
      }
      const name = header.slice(0, colonIndex).trim();
      const value = header.slice(colonIndex + 1).trim();
      result.headers[name] = value;
    } else if (arg === '-d' || arg === '--data') {
      if (i + 1 >= args.length) {
        result.error = 'curl: option -d requires an argument';
        return result;
      }
      result.data = args[++i];
      // Default to POST when data is provided
      if (result.method === 'GET') {
        result.method = 'POST';
      }
    } else if (arg === '-o' || arg === '--output') {
      if (i + 1 >= args.length) {
        result.error = 'curl: option -o requires an argument';
        return result;
      }
      result.output = args[++i];
    } else if (arg === '-i' || arg === '--include') {
      result.includeHeaders = true;
    } else if (arg === '-s' || arg === '--silent') {
      result.silent = true;
    } else if (arg.startsWith('-')) {
      // Handle combined short options (e.g., -is)
      if (arg.length > 2 && !arg.startsWith('--')) {
        const flags = arg.slice(1);
        for (const flag of flags) {
          if (flag === 'i') {
            result.includeHeaders = true;
          } else if (flag === 's') {
            result.silent = true;
          } else {
            result.error = `curl: unknown option: -${flag}`;
            return result;
          }
        }
      } else {
        result.error = `curl: unknown option: ${arg}`;
        return result;
      }
    } else {
      // Assume it's the URL
      if (result.url === null) {
        result.url = arg;
      } else {
        result.error = 'curl: multiple URLs not supported';
        return result;
      }
    }
    i++;
  }

  return result;
}

/**
 * Normalize URL - auto-add https:// if protocol is missing
 */
function normalizeUrl(url: string): string {
  if (!url.includes('://')) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Format response headers for display
 */
function formatResponseHeaders(response: Response): string {
  const lines: string[] = [];
  lines.push(`HTTP/1.1 ${response.status} ${response.statusText}`);
  response.headers.forEach((value, name) => {
    lines.push(`${name}: ${value}`);
  });
  lines.push('');
  return lines.join('\n');
}

/**
 * curl builtin command
 *
 * Usage: curl [options] <url>
 *
 * Options:
 *   -X, --request METHOD  HTTP method (GET, POST, PUT, DELETE, etc.)
 *   -H, --header HEADER   Add header (format: "Name: Value")
 *   -d, --data DATA       Send data with request (sets method to POST if not specified)
 *   -o, --output FILE     Write output to file instead of stdout
 *   -i, --include         Include response headers in output
 *   -s, --silent          Silent mode (don't show progress)
 *
 * Examples:
 *   curl example.com
 *   curl -X POST -H "Content-Type: application/json" -d '{"key":"value"}' api.example.com/data
 *   curl -o output.txt example.com/file
 */
export const curl: BuiltinCommand = async (args, context) => {
  // Show usage if no arguments
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'curl: try \'curl --help\' for more information',
      exitCode: 1,
    };
  }

  // Handle --help
  if (args.includes('--help') || args.includes('-h')) {
    return {
      stdout: `Usage: curl [options] <url>

Options:
  -X, --request METHOD  HTTP method (GET, POST, PUT, DELETE, etc.)
  -H, --header HEADER   Add header (format: "Name: Value")
  -d, --data DATA       Send data with request (sets method to POST)
  -o, --output FILE     Write output to file instead of stdout
  -i, --include         Include response headers in output
  -s, --silent          Silent mode

Examples:
  curl example.com
  curl -X POST -H "Content-Type: application/json" -d '{"key":"value"}' api.example.com
  curl -o output.txt example.com/file
`,
      stderr: '',
      exitCode: 0,
    };
  }

  const parsed = parseCurlArgs(args);

  if (parsed.error) {
    return {
      stdout: '',
      stderr: parsed.error,
      exitCode: 1,
    };
  }

  if (!parsed.url) {
    return {
      stdout: '',
      stderr: 'curl: no URL specified',
      exitCode: 1,
    };
  }

  const url = normalizeUrl(parsed.url);

  // Build request options
  const requestOptions: RequestInit = {
    method: parsed.method,
    headers: parsed.headers,
  };

  // Add body if data provided
  if (parsed.data !== null) {
    requestOptions.body = parsed.data;
    // Set Content-Type if not already set and we have data
    if (!parsed.headers['Content-Type'] && !parsed.headers['content-type']) {
      (requestOptions.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  try {
    const response = await aiosFetch(url, requestOptions);
    const body = await response.text();

    let output = '';

    // Include headers if requested
    if (parsed.includeHeaders) {
      output = formatResponseHeaders(response) + '\n' + body;
    } else {
      output = body;
    }

    // Write to file if -o specified
    if (parsed.output && context.vfs) {
      const outputPath = parsed.output.startsWith('/')
        ? parsed.output
        : `${context.env.PWD || '/'}/${parsed.output}`;

      await context.vfs.write(outputPath, output);

      if (!parsed.silent) {
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
        };
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      };
    }

    return {
      stdout: output,
      stderr: '',
      exitCode: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      stdout: '',
      stderr: `curl: ${message}`,
      exitCode: 1,
    };
  }
};

/**
 * fetch builtin command - Simple HTTP GET wrapper
 *
 * Usage: fetch <url>
 *
 * A simplified version of curl for quick GET requests.
 * Automatically adds https:// if no protocol specified.
 */
export const fetchCmd: BuiltinCommand = async (args, _context) => {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return {
      stdout: `Usage: fetch <url>

A simple HTTP GET wrapper. Displays the response body.
Automatically adds https:// if no protocol specified.

Examples:
  fetch example.com
  fetch api.github.com/users/octocat
`,
      stderr: '',
      exitCode: args.length === 0 ? 1 : 0,
    };
  }

  const url = normalizeUrl(args[0]);

  try {
    const response = await aiosFetch(url, { method: 'GET' });
    const body = await response.text();

    if (!response.ok) {
      return {
        stdout: body,
        stderr: `fetch: HTTP ${response.status} ${response.statusText}`,
        exitCode: 1,
      };
    }

    return {
      stdout: body,
      stderr: '',
      exitCode: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      stdout: '',
      stderr: `fetch: ${message}`,
      exitCode: 1,
    };
  }
};
