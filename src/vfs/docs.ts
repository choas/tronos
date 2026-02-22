/**
 * /docs virtual filesystem for TronOS
 *
 * Provides read-only documentation files with inline content.
 * Write/delete operations are prevented with clear error messages.
 * Files are marked as 'virtual' type in stat output.
 */

import { TERMS_CONTENT } from '../engine/terms-content';
import { TRONOS_CONTENT, API_CONTENT, COMMANDS_CONTENT } from './docs-content';

/** Configuration for a documentation file */
export interface DocsFileConfig {
  /** Inline content */
  content: string;
  /** Description of the file (for help/info) */
  description: string;
}

/**
 * Configuration for all documentation files
 * Maps path (e.g., '/docs/tronos.md') to its configuration
 */
export const docsFiles: Record<string, DocsFileConfig> = {
  '/docs/tronos.md': {
    content: TRONOS_CONTENT,
    description: 'TronOS main documentation and README'
  },
  '/docs/api.md': {
    content: API_CONTENT,
    description: 'TronOS executable API reference'
  },
  '/docs/commands.md': {
    content: COMMANDS_CONTENT,
    description: 'TronOS shell commands reference'
  },
  '/docs/terms.md': {
    content: TERMS_CONTENT,
    description: 'TronOS AI Service Terms & Conditions'
  }
};

/**
 * Structure of /docs filesystem for directory listings
 */
export const docsStructure: Record<string, string[]> = {
  '/docs': Object.keys(docsFiles).map(p => p.replace('/docs/', ''))
};

/**
 * Check if a path is a /docs path
 */
export function isDocsPath(path: string): boolean {
  return path === '/docs' || path.startsWith('/docs/');
}

/**
 * Check if a /docs path is a directory
 */
export function isDocsDirectory(path: string): boolean {
  return path in docsStructure;
}

/**
 * Check if a /docs path is a file
 */
export function isDocsFile(path: string): boolean {
  return path in docsFiles;
}

/**
 * List contents of a /docs directory
 */
export function listDocsDirectory(path: string): string[] | undefined {
  return docsStructure[path];
}

/**
 * Get the configuration for a docs file
 */
export function getDocsFileConfig(path: string): DocsFileConfig | undefined {
  return docsFiles[path];
}

/**
 * No-op — retained for backward compatibility with tests.
 * Caching was removed when docs switched to inline content.
 */
export function clearDocsCache(_path?: string): void {}

/**
 * Read a docs file (returns content directly since all content is inline)
 */
export async function readDocsFile(path: string): Promise<string> {
  const config = docsFiles[path];
  if (!config) {
    throw new Error(`read: no such file or directory: ${path}`);
  }
  return config.content;
}

/**
 * Get the size of a docs file synchronously.
 */
export function getDocsSizeSync(path: string): number | null {
  const config = docsFiles[path];
  if (!config) return null;
  return new TextEncoder().encode(config.content).byteLength;
}

/**
 * Get a read generator for a docs file (async)
 * Used by memory.ts for consistent interface with proc/dev
 */
export function getDocsGenerator(path: string): (() => Promise<string>) | undefined {
  if (path in docsFiles) {
    return () => readDocsFile(path);
  }
  return undefined;
}
