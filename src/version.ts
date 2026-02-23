/**
 * @fileoverview TronOS version information.
 *
 * Central location for version information used throughout the application.
 * In dev mode, includes build timestamp for debugging.
 *
 * @module version
 */

/** Build timestamp injected by Vite at build time */
declare const __BUILD_TIME__: string | undefined;

/** Base TronOS version number */
const BASE_VERSION = '1.1.1';

/**
 * Check if running in development mode.
 * Works with both Vite (import.meta.env.DEV) and direct Bun execution.
 */
function isDevMode(): boolean {
  // Vite sets import.meta.env.DEV in dev mode
  // When running directly with Bun (tests, CLI), check NODE_ENV or assume dev if BUILD_TIME is set
  try {
    if (typeof import.meta.env !== 'undefined' && import.meta.env.DEV !== undefined) {
      return import.meta.env.DEV;
    }
  } catch {
    // import.meta.env not available
  }
  // Fall back to NODE_ENV check
  return process.env.NODE_ENV !== 'production';
}

/**
 * Get the build timestamp.
 * Returns the injected BUILD_TIME if available, otherwise generates current timestamp.
 */
function getBuildTime(): string {
  // Use injected BUILD_TIME from Vite if available
  if (typeof __BUILD_TIME__ !== 'undefined' && __BUILD_TIME__) {
    return __BUILD_TIME__;
  }
  // Generate current timestamp for direct Bun execution
  return new Date().toISOString();
}

/**
 * Format build timestamp for dev version string.
 * Converts ISO date to compact format: YYYYMMDDTHHMMSS
 */
function formatBuildTime(isoDate: string): string {
  // Parse ISO date and format as compact timestamp
  // e.g., "2026-02-04T15:30:45.123Z" -> "20260204T153045"
  const date = new Date(isoDate);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * TronOS version number.
 * In dev mode: includes build timestamp (e.g., "0.1.0-dev.20260204T153045")
 * In production: clean version (e.g., "0.1.0")
 */
export const VERSION = isDevMode()
  ? `${BASE_VERSION}-dev.${formatBuildTime(getBuildTime())}`
  : BASE_VERSION;

/** Full version string */
export const VERSION_STRING = `TronOS v${VERSION}`;

/** GitHub repository URL */
export const REPO_URL = 'https://github.com/choas/tronos';
