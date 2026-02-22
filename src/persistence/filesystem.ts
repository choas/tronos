import { getDB } from "./db";
import type { FSNode } from "../types";

/**
 * Load filesystem from IndexedDB for a given namespace
 * @param namespace - The filesystem namespace (typically session ID)
 * @returns Map of paths to FSNodes
 */
export async function loadFilesystem(namespace: string): Promise<Map<string, FSNode>> {
  const db = getDB();
  const nodes = new Map<string, FSNode>();

  // Get all files for this namespace
  const allFiles = await db.getAllFromIndex("files", "by-parent");

  // Filter by namespace prefix and reconstruct the VFS structure
  for (const file of allFiles) {
    if (file.path.startsWith(`${namespace}:`)) {
      // Remove namespace prefix to get actual path
      const actualPath = file.path.substring(namespace.length + 1);
      nodes.set(actualPath, file.node);
    }
  }

  return nodes;
}

/**
 * Save a file to IndexedDB
 * @param namespace - The filesystem namespace (typically session ID)
 * @param path - The absolute path of the file/directory
 * @param node - The FSNode to save
 */
export async function saveFile(namespace: string, path: string, node: FSNode): Promise<void> {
  const db = getDB();

  // Store with namespace prefix to separate session filesystems
  const key = `${namespace}:${path}`;

  await db.put("files", {
    path: key,
    node,
    parent: node.parent || "/",
  });
}

/**
 * Delete a file from IndexedDB
 * @param namespace - The filesystem namespace (typically session ID)
 * @param path - The absolute path of the file/directory to delete
 */
export async function deleteFile(namespace: string, path: string): Promise<void> {
  const db = getDB();
  const key = `${namespace}:${path}`;

  await db.delete("files", key);
}

/**
 * Sync entire filesystem to IndexedDB
 * This is a force persist operation that saves all files in the VFS
 * @param namespace - The filesystem namespace (typically session ID)
 * @param nodes - Map of all nodes in the VFS
 */
export async function syncFilesystem(namespace: string, nodes: Map<string, FSNode>): Promise<void> {
  const db = getDB();
  const tx = db.transaction("files", "readwrite");

  // First, delete all existing files for this namespace
  const allKeys = await tx.store.getAllKeys();
  const prefix = `${namespace}:`;

  for (const key of allKeys) {
    if (key.startsWith(prefix)) {
      await tx.store.delete(key);
    }
  }

  // Then save all current nodes
  for (const [path, node] of nodes.entries()) {
    const key = `${namespace}:${path}`;
    await tx.store.put({
      path: key,
      node,
      parent: node.parent || "/",
    });
  }

  await tx.done;
}
