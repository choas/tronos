/**
 * @fileoverview Shared glob matching utility.
 *
 * Supports * (any single path segment) and ** (any depth).
 * Used by the event bus, permission checker, and guard layer.
 *
 * @module utils/glob
 */

/**
 * Test whether `path` matches a glob `pattern`.
 *
 * Supports `*` (matches any characters except `/`) and `**` (matches
 * any characters including `/`).  Uses iterative dynamic programming
 * (O(n × m) time, O(m) space) — no RegExp construction from user input.
 */
export function matchGlob(path: string, pattern: string): boolean {
  if (path === pattern) return true;
  if (pattern === "*") return !path.includes("/");

  // Tokenize pattern: collapse '**' into a single token
  const tokens: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      tokens.push("**");
      i++; // skip second *
    } else {
      tokens.push(pattern[i]);
    }
  }

  const n = path.length;
  const m = tokens.length;

  // Rolling DP: prev[j] = path[0..i-1] matches tokens[0..j-1]
  let prev = new Uint8Array(m + 1);
  prev[0] = 1;
  // Leading wildcards can match the empty string
  for (let j = 0; j < m; j++) {
    if (tokens[j] === "*" || tokens[j] === "**") {
      prev[j + 1] = prev[j];
    } else {
      break;
    }
  }

  for (let i = 0; i < n; i++) {
    const curr = new Uint8Array(m + 1);
    const ch = path[i];
    for (let j = 0; j < m; j++) {
      const tok = tokens[j];
      if (tok === "**") {
        // ** matches any character including '/'
        curr[j + 1] = prev[j + 1] || curr[j] ? 1 : 0;
      } else if (tok === "*") {
        // * matches any character except '/'
        if (ch !== "/") {
          curr[j + 1] = prev[j + 1] || curr[j] ? 1 : 0;
        } else {
          curr[j + 1] = curr[j];
        }
      } else {
        // Literal character
        curr[j + 1] = prev[j] && tok === ch ? 1 : 0;
      }
    }
    prev = curr;
  }

  return prev[m] === 1;
}
