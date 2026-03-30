/**
 * /dev handlers for AIOS virtual filesystem
 *
 * These handlers provide special device files that behave like Unix /dev files.
 * Each handler can support read and/or write operations with custom behavior.
 */

import { getGuardQueue } from "../agents/guard";

/**
 * Device handler interface for /dev files
 */
export interface DevHandler {
  /** Read from the device (returns content or throws if not readable) */
  read?: (size?: number) => string | Promise<string>;
  /** Write to the device (discards or processes data) */
  write?: (data: string) => void | Promise<void>;
  /** Whether this is a readable device */
  readable: boolean;
  /** Whether this is a writable device */
  writable: boolean;
  /** Unix-style permission string (e.g., 'rw-rw-rw-') */
  permissions: string;
}

/**
 * Generate a string of null bytes (zeros) of specified length
 */
function generateZeros(size: number): string {
  return "\0".repeat(size);
}

/**
 * Generate cryptographically random bytes as a string
 */
function generateRandomBytes(size: number): string {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without crypto API
    for (let i = 0; i < size; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Convert bytes to string (raw bytes, not base64)
  return Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
}

/**
 * Map of /dev paths to their handler implementations
 */
export const devHandlers: Record<string, DevHandler> = {
  // /dev/null - discards all writes, reads return empty
  // Permissions: crw-rw-rw- (character device, read/write for all)
  "/dev/null": {
    read: () => "",
    write: () => {
      /* discard */
    },
    readable: true,
    writable: true,
    permissions: "rw-rw-rw-",
  },

  // /dev/zero - returns null bytes on read, read-only
  // Permissions: cr--r--r-- (character device, read-only for all)
  "/dev/zero": {
    read: (size = 1024) => generateZeros(Math.min(size, 65536)),
    readable: true,
    writable: false,
    permissions: "r--r--r--",
  },

  // /dev/random - returns random bytes on read, accepts writes (discards them)
  // Permissions: crw-rw-rw- (character device, read/write for all)
  "/dev/random": {
    read: (size = 32) => generateRandomBytes(Math.min(size, 65536)),
    write: () => {
      /* discard - writing to /dev/random adds entropy on real systems */
    },
    readable: true,
    writable: true,
    permissions: "rw-rw-rw-",
  },

  // /dev/urandom - alias for /dev/random (in this implementation they're the same)
  // Permissions: crw-rw-rw- (character device, read/write for all)
  "/dev/urandom": {
    read: (size = 32) => generateRandomBytes(Math.min(size, 65536)),
    write: () => {
      /* discard - writing to /dev/urandom adds entropy on real systems */
    },
    readable: true,
    writable: true,
    permissions: "rw-rw-rw-",
  },

  // /dev/guard - write approval requests here (JSON), read pending count
  "/dev/guard": {
    read: () => {
      const pending = getGuardQueue().getPending();
      return (
        `${pending.length} pending approval(s)\n` +
        pending
          .map(
            (r) =>
              `  ${r.id}: ${r.agent_name} wants to ${r.action} ${r.target}`,
          )
          .join("\n")
      );
    },
    write: (data: string) => {
      const VALID_ACTIONS = ["read", "write", "mcp", "network", "spawn"];
      let req: unknown;
      try {
        req = JSON.parse(data);
      } catch {
        console.error("/dev/guard: failed to parse request as JSON");
        return;
      }
      if (
        typeof req !== "object" ||
        req === null ||
        typeof (req as Record<string, unknown>).agent_id !== "string" ||
        typeof (req as Record<string, unknown>).agent_name !== "string" ||
        typeof (req as Record<string, unknown>).action !== "string" ||
        !VALID_ACTIONS.includes(
          (req as Record<string, unknown>).action as string,
        ) ||
        typeof (req as Record<string, unknown>).target !== "string"
      ) {
        console.error(
          "/dev/guard: malformed request — requires agent_id, agent_name, action (read|write|mcp|network|spawn), and target as strings",
        );
        return;
      }
      // Fire-and-forget: the guard request is async but /dev/guard write
      // is intentionally non-blocking. Callers must poll /dev/guard or
      // /proc/guard/pending to check approval status.
      void getGuardQueue().request(
        req as Omit<
          import("../agents/guard").GuardRequest,
          "id" | "requested_at" | "status"
        >,
      );
    },
    readable: true,
    writable: true,
    permissions: "rw-rw-rw-",
  },

  // /dev/clipboard - reads/writes system clipboard
  // Permissions: crw-rw-rw- (character device, read/write for all)
  "/dev/clipboard": {
    read: async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          return await navigator.clipboard.readText();
        }
        throw new Error("Clipboard API not available");
      } catch (err) {
        if (err instanceof Error) {
          if (err.name === "NotAllowedError") {
            throw new Error(
              "Clipboard access denied. Please allow clipboard permissions.",
            );
          }
          throw new Error(`Clipboard read failed: ${err.message}`);
        }
        throw new Error("Clipboard read failed");
      }
    },
    write: async (data: string) => {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(data);
          return;
        }
        throw new Error("Clipboard API not available");
      } catch (err) {
        if (err instanceof Error) {
          if (err.name === "NotAllowedError") {
            throw new Error(
              "Clipboard access denied. Please allow clipboard permissions.",
            );
          }
          throw new Error(`Clipboard write failed: ${err.message}`);
        }
        throw new Error("Clipboard write failed");
      }
    },
    readable: true,
    writable: true,
    permissions: "rw-rw-rw-",
  },
};

/**
 * Check if a path is a /dev path
 */
export function isDevPath(path: string): boolean {
  return path === "/dev" || path.startsWith("/dev/");
}

/**
 * Get the device handler for a /dev path, if it exists
 */
export function getDevHandler(path: string): DevHandler | undefined {
  return devHandlers[path];
}

/**
 * Check if a /dev path is a directory
 */
export function isDevDirectory(path: string): boolean {
  return path === "/dev";
}

/**
 * Check if a /dev path is a device file (not a directory)
 */
export function isDevFile(path: string): boolean {
  return path !== "/dev" && devHandlers[path] !== undefined;
}

/**
 * List contents of /dev directory
 */
export function listDevDirectory(path: string): string[] | undefined {
  if (path !== "/dev") {
    return undefined;
  }
  // Return device names without the /dev/ prefix
  return Object.keys(devHandlers).map((p) => p.replace("/dev/", ""));
}

/**
 * Read from a device
 * @param path The /dev path
 * @param size Optional size hint for devices that generate data
 * @returns The read content (may be a Promise for async devices)
 */
export function readDev(path: string, size?: number): string | Promise<string> {
  const handler = devHandlers[path];
  if (!handler) {
    throw new Error(`No such device: ${path}`);
  }
  if (!handler.readable || !handler.read) {
    throw new Error(`Device not readable: ${path}`);
  }
  return handler.read(size);
}

/**
 * Write to a device
 * @param path The /dev path
 * @param data The data to write
 * @returns void (may be a Promise for async devices)
 */
export function writeDev(path: string, data: string): void | Promise<void> {
  const handler = devHandlers[path];
  if (!handler) {
    throw new Error(`No such device: ${path}`);
  }
  if (!handler.writable || !handler.write) {
    throw new Error(`Device not writable: ${path}`);
  }
  return handler.write(data);
}

/**
 * Get the permissions string for a device
 * @param path The /dev path
 * @returns The permissions string (e.g., 'rw-rw-rw-') or undefined if not a device
 */
export function getDevPermissions(path: string): string | undefined {
  const handler = devHandlers[path];
  return handler?.permissions;
}
