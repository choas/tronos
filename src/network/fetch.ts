/**
 * TronOS Fetch Wrapper
 * Provides enhanced fetch functionality with default headers and better error messages
 */

import { VERSION } from '../version';

/**
 * Enhanced fetch wrapper for TronOS
 * - Adds default User-Agent header if not present
 * - Provides better error messages for CORS issues
 *
 * @param url - The URL to fetch
 * @param options - Standard RequestInit options
 * @returns Promise<Response> - The fetch response
 */
export async function aiosFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Add default headers
  const headers = new Headers(options.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", `TronOS/${VERSION}`);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });
    return response;
  } catch (error) {
    // Enhance error message for common issues
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Check for CORS-related errors
      if (
        message.includes("cors") ||
        message.includes("cross-origin") ||
        message.includes("blocked") ||
        message.includes("access-control-allow-origin") ||
        message.includes("network error") ||
        message.includes("failed to fetch")
      ) {
        try {
          const origin = new URL(url).origin;
          throw new Error(
            `CORS error: The server at ${origin} doesn't allow requests from this browser. ` +
            `Try using a CORS proxy or ensure the server sends appropriate CORS headers.`
          );
        } catch (urlError) {
          // If URL parsing fails, throw with generic CORS message
          if (urlError instanceof Error && urlError.message.includes("CORS error")) {
            throw urlError;
          }
          throw new Error(
            `CORS error: The server doesn't allow requests from this browser. ` +
            `Try using a CORS proxy or ensure the server sends appropriate CORS headers.`
          );
        }
      }

      // Check for network-related errors
      if (message.includes("network") || message.includes("connection")) {
        throw new Error(`Network error: Unable to reach ${url}. Check your internet connection.`);
      }
    }

    throw error;
  }
}
