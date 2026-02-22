/**
 * @fileoverview Host filesystem bridge for CLI mode.
 *
 * This module provides a VFS implementation that can access the real
 * host filesystem through a mounted path (/mnt/host). It wraps the
 * InMemoryVFS and intercepts operations on the mount point.
 *
 * Security:
 * - Only paths within the mounted directory are accessible
 * - Path traversal attacks are prevented by normalizing and checking paths
 * - The mounted directory serves as a sandbox root
 *
 * @module vfs/host
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import type { DirectoryNode, FSNode } from '../types';
import { InMemoryVFS } from './memory';

/**
 * Configuration for the host filesystem mount.
 */
export interface HostMountConfig {
  /**
   * The virtual path where the host filesystem will be mounted.
   * Default: /mnt/host
   */
  mountPoint?: string;

  /**
   * The real filesystem path to mount.
   * Default: user's home directory
   */
  hostPath?: string;

  /**
   * Whether to allow write operations to the host filesystem.
   * Default: true
   */
  allowWrite?: boolean;
}

/**
 * Default mount point for the host filesystem.
 */
export const DEFAULT_MOUNT_POINT = '/mnt/host';

/**
 * HybridVFS combines the in-memory VFS with real filesystem access.
 *
 * Paths under /mnt/host (or configured mount point) are routed to the
 * real host filesystem, while all other paths use the in-memory VFS.
 *
 * This enables CLI mode to access real files while maintaining the
 * isolated virtual environment for /home/tronos, /bin, etc.
 *
 * @example
 * const vfs = new HybridVFS({
 *   hostPath: '/home/user/projects',
 *   allowWrite: true
 * });
 * await vfs.init();
 *
 * // Access real files
 * const content = vfs.read('/mnt/host/myproject/README.md');
 *
 * // Access virtual files
 * vfs.write('/home/tronos/notes.txt', 'Virtual file content');
 */
export class HybridVFS extends InMemoryVFS {
  private mountPoint: string;
  private hostPath: string;
  private allowWrite: boolean;
  private mounted: boolean = false;

  /**
   * Create a new HybridVFS instance.
   *
   * @param namespace - VFS namespace for persistence (passed to InMemoryVFS)
   * @param config - Host mount configuration
   */
  constructor(namespace = 'default', config?: HostMountConfig) {
    super(namespace);

    this.mountPoint = config?.mountPoint ?? DEFAULT_MOUNT_POINT;
    this.hostPath = config?.hostPath ?? process.env.HOME ?? '/';
    this.allowWrite = config?.allowWrite ?? true;

    // Normalize paths
    this.mountPoint = nodePath.normalize(this.mountPoint);
    this.hostPath = nodePath.resolve(this.hostPath);
  }

  /**
   * Initialize the VFS, creating the mount point directory.
   */
  public async init(): Promise<void> {
    await super.init();

    // Create mount point directory in virtual FS
    if (!this.existsInVirtual(this.mountPoint)) {
      this.mkdirInVirtual('/mnt', true);
      this.mkdirInVirtual(this.mountPoint, false);
    }

    // Verify host path exists
    if (fs.existsSync(this.hostPath)) {
      this.mounted = true;
    } else {
      console.warn(`Host path does not exist: ${this.hostPath}`);
      this.mounted = false;
    }
  }

  /**
   * Check if the VFS has a mounted host filesystem.
   */
  public isMounted(): boolean {
    return this.mounted;
  }

  /**
   * Get the host path that is mounted.
   */
  public getHostPath(): string {
    return this.hostPath;
  }

  /**
   * Get the virtual mount point.
   */
  public getMountPoint(): string {
    return this.mountPoint;
  }

  /**
   * Check if a path is within the mount point.
   */
  private isHostPath(p: string): boolean {
    const resolved = this.resolve(p);
    return resolved === this.mountPoint || resolved.startsWith(this.mountPoint + '/');
  }

  /**
   * Convert a virtual path to a real host path.
   * Returns null if the path is outside the mount point or is a path traversal attack.
   */
  private toHostPath(virtualPath: string): string | null {
    const resolved = this.resolve(virtualPath);

    if (!this.isHostPath(resolved)) {
      return null;
    }

    // Get the relative path from the mount point
    const relativePath = resolved === this.mountPoint
      ? ''
      : resolved.slice(this.mountPoint.length + 1);

    // Join with the host path
    const realPath = nodePath.join(this.hostPath, relativePath);

    // Security check: ensure the resolved path is still within hostPath
    // This prevents path traversal attacks (e.g., /mnt/host/../../../etc/passwd)
    const normalizedRealPath = nodePath.resolve(realPath);
    if (!normalizedRealPath.startsWith(this.hostPath) && normalizedRealPath !== this.hostPath) {
      console.warn(`Path traversal detected: ${virtualPath} resolved to ${normalizedRealPath}`);
      return null;
    }

    return normalizedRealPath;
  }

  // Override VFS methods to handle host paths

  /**
   * Check if a path exists in the virtual filesystem.
   */
  private existsInVirtual(p: string): boolean {
    return super.exists(p);
  }

  /**
   * Create a directory in the virtual filesystem.
   */
  private mkdirInVirtual(p: string, recursive = false): void {
    return super.mkdir(p, recursive);
  }

  /**
   * Check if a path exists.
   */
  public exists(p: string): boolean {
    if (this.isHostPath(p)) {
      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) return false;
      return fs.existsSync(hostPath);
    }
    return super.exists(p);
  }

  /**
   * Get metadata for a path.
   */
  public stat(p: string): FSNode {
    if (this.isHostPath(p)) {
      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`stat: no such file or directory: ${p}`);
      }

      try {
        const stats = fs.statSync(hostPath);
        const name = nodePath.basename(hostPath) || 'host';
        const parent = nodePath.dirname(this.resolve(p));

        if (stats.isDirectory()) {
          return {
            name,
            type: 'directory',
            parent: parent === this.resolve(p) ? null : parent,
            meta: {
              createdAt: stats.birthtime.getTime(),
              updatedAt: stats.mtime.getTime()
            },
            children: []  // Not populated for stat
          } as DirectoryNode;
        } else {
          return {
            name,
            type: 'file',
            parent,
            meta: {
              createdAt: stats.birthtime.getTime(),
              updatedAt: stats.mtime.getTime()
            }
          } as FSNode;
        }
      } catch (error) {
        throw new Error(`stat: no such file or directory: ${p}`);
      }
    }
    return super.stat(p);
  }

  /**
   * Read the contents of a file.
   */
  public read(p: string): string | Promise<string> {
    if (this.isHostPath(p)) {
      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`read: no such file or directory: ${p}`);
      }

      try {
        const stats = fs.statSync(hostPath);
        if (stats.isDirectory()) {
          throw new Error(`read: not a file: ${p}`);
        }
        return fs.readFileSync(hostPath, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`read: no such file or directory: ${p}`);
        }
        if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
          throw new Error(`read: not a file: ${p}`);
        }
        throw error;
      }
    }
    return super.read(p);
  }

  /**
   * Write content to a file.
   */
  public write(p: string, content: string): void | Promise<void> {
    if (this.isHostPath(p)) {
      if (!this.allowWrite) {
        throw new Error(`write: filesystem mounted read-only: ${p}`);
      }

      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`write: no such file or directory: ${p}`);
      }

      try {
        // Ensure parent directory exists
        const parentDir = nodePath.dirname(hostPath);
        if (!fs.existsSync(parentDir)) {
          throw new Error(`write: no such file or directory: ${nodePath.dirname(p)}`);
        }

        // Check if it's a directory
        if (fs.existsSync(hostPath) && fs.statSync(hostPath).isDirectory()) {
          throw new Error(`write: not a file: ${p}`);
        }

        fs.writeFileSync(hostPath, content, 'utf-8');
      } catch (error) {
        if ((error as Error).message.startsWith('write:')) {
          throw error;
        }
        throw new Error(`write: ${(error as Error).message}`);
      }
      return;
    }
    return super.write(p, content);
  }

  /**
   * Append content to a file.
   */
  public append(p: string, content: string): void {
    if (this.isHostPath(p)) {
      if (!this.allowWrite) {
        throw new Error(`append: filesystem mounted read-only: ${p}`);
      }

      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`append: no such file or directory: ${p}`);
      }

      try {
        // Check if it's a directory
        if (fs.existsSync(hostPath) && fs.statSync(hostPath).isDirectory()) {
          throw new Error(`append: not a file: ${p}`);
        }

        fs.appendFileSync(hostPath, content, 'utf-8');
      } catch (error) {
        if ((error as Error).message.startsWith('append:')) {
          throw error;
        }
        throw new Error(`append: ${(error as Error).message}`);
      }
      return;
    }
    return super.append(p, content);
  }

  /**
   * Check if a path is a directory.
   */
  public isDirectory(p: string): boolean {
    if (this.isHostPath(p)) {
      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) return false;

      try {
        return fs.statSync(hostPath).isDirectory();
      } catch {
        return false;
      }
    }
    return super.isDirectory(p);
  }

  /**
   * Check if a path is a file.
   */
  public isFile(p: string): boolean {
    if (this.isHostPath(p)) {
      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) return false;

      try {
        const stats = fs.statSync(hostPath);
        return stats.isFile();
      } catch {
        return false;
      }
    }
    return super.isFile(p);
  }

  /**
   * List the contents of a directory.
   */
  public list(p: string): string[] {
    if (this.isHostPath(p)) {
      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`list: no such directory: ${p}`);
      }

      try {
        const stats = fs.statSync(hostPath);
        if (!stats.isDirectory()) {
          throw new Error(`list: not a directory: ${p}`);
        }
        return fs.readdirSync(hostPath);
      } catch (error) {
        if ((error as Error).message.startsWith('list:')) {
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`list: no such directory: ${p}`);
        }
        throw error;
      }
    }
    return super.list(p);
  }

  /**
   * List directory contents with full metadata.
   */
  public listDetailed(p: string): FSNode[] {
    if (this.isHostPath(p)) {
      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`listDetailed: no such directory: ${p}`);
      }

      try {
        const stats = fs.statSync(hostPath);
        if (!stats.isDirectory()) {
          throw new Error(`listDetailed: not a directory: ${p}`);
        }

        const entries = fs.readdirSync(hostPath, { withFileTypes: true });
        const resolvedPath = this.resolve(p);

        return entries.map(entry => {
          const entryPath = nodePath.join(hostPath, entry.name);
          let entryStats: fs.Stats;

          try {
            entryStats = fs.statSync(entryPath);
          } catch {
            // If we can't stat the file (permission error, etc.), use defaults
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              parent: resolvedPath,
              meta: {
                createdAt: Date.now(),
                updatedAt: Date.now()
              }
            } as FSNode;
          }

          if (entry.isDirectory()) {
            return {
              name: entry.name,
              type: 'directory',
              parent: resolvedPath,
              meta: {
                createdAt: entryStats.birthtime.getTime(),
                updatedAt: entryStats.mtime.getTime()
              },
              children: []
            } as DirectoryNode;
          } else {
            return {
              name: entry.name,
              type: 'file',
              parent: resolvedPath,
              meta: {
                createdAt: entryStats.birthtime.getTime(),
                updatedAt: entryStats.mtime.getTime()
              }
            } as FSNode;
          }
        });
      } catch (error) {
        if ((error as Error).message.startsWith('listDetailed:')) {
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`listDetailed: no such directory: ${p}`);
        }
        throw error;
      }
    }
    return super.listDetailed(p);
  }

  /**
   * Create a directory.
   */
  public mkdir(p: string, recursive = false): void {
    if (this.isHostPath(p)) {
      if (!this.allowWrite) {
        throw new Error(`mkdir: filesystem mounted read-only: ${p}`);
      }

      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`mkdir: no such file or directory: ${p}`);
      }

      try {
        if (fs.existsSync(hostPath)) {
          throw new Error(`mkdir: file exists: ${p}`);
        }

        fs.mkdirSync(hostPath, { recursive });
      } catch (error) {
        if ((error as Error).message.startsWith('mkdir:')) {
          throw error;
        }
        throw new Error(`mkdir: ${(error as Error).message}`);
      }
      return;
    }
    return super.mkdir(p, recursive);
  }

  /**
   * Remove a file or directory.
   */
  public remove(p: string, recursive = false): void {
    if (this.isHostPath(p)) {
      if (!this.allowWrite) {
        throw new Error(`remove: filesystem mounted read-only: ${p}`);
      }

      // Don't allow removing the mount point itself
      if (this.resolve(p) === this.mountPoint) {
        throw new Error(`remove: cannot remove mount point: ${p}`);
      }

      const hostPath = this.toHostPath(p);
      if (!hostPath || !this.mounted) {
        throw new Error(`remove: no such file or directory: ${p}`);
      }

      try {
        const stats = fs.statSync(hostPath);

        if (stats.isDirectory()) {
          const contents = fs.readdirSync(hostPath);
          if (contents.length > 0 && !recursive) {
            throw new Error(`remove: directory not empty: ${p}`);
          }
          if (contents.length === 0) {
            // Use rmdirSync for empty directories
            fs.rmdirSync(hostPath);
          } else {
            // Use rmSync with recursive for non-empty directories
            fs.rmSync(hostPath, { recursive: true });
          }
        } else {
          fs.unlinkSync(hostPath);
        }
      } catch (error) {
        if ((error as Error).message.startsWith('remove:')) {
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`remove: no such file or directory: ${p}`);
        }
        throw error;
      }
      return;
    }
    return super.remove(p, recursive);
  }

  /**
   * Copy a file or directory.
   * Note: Copying between host and virtual filesystems is supported.
   */
  public copy(src: string, dest: string, recursive = false): void {
    const srcIsHost = this.isHostPath(src);
    const destIsHost = this.isHostPath(dest);

    // If both are host paths or both are virtual paths, use appropriate method
    if (srcIsHost && destIsHost) {
      this.copyHostToHost(src, dest, recursive);
    } else if (!srcIsHost && !destIsHost) {
      super.copy(src, dest, recursive);
    } else if (srcIsHost && !destIsHost) {
      this.copyHostToVirtual(src, dest, recursive);
    } else {
      this.copyVirtualToHost(src, dest, recursive);
    }
  }

  private copyHostToHost(src: string, dest: string, recursive: boolean): void {
    if (!this.allowWrite) {
      throw new Error(`copy: filesystem mounted read-only`);
    }

    const srcPath = this.toHostPath(src);
    const destPath = this.toHostPath(dest);

    if (!srcPath || !destPath || !this.mounted) {
      throw new Error(`copy: invalid path`);
    }

    if (!fs.existsSync(srcPath)) {
      throw new Error(`copy: no such file or directory: ${src}`);
    }

    if (fs.existsSync(destPath)) {
      throw new Error(`copy: destination already exists: ${dest}`);
    }

    const stats = fs.statSync(srcPath);

    if (stats.isDirectory()) {
      if (!recursive) {
        throw new Error(`copy: source is a directory (and recursive option is not used): ${src}`);
      }
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  private copyHostToVirtual(src: string, dest: string, recursive: boolean): void {
    const srcPath = this.toHostPath(src);

    if (!srcPath || !this.mounted) {
      throw new Error(`copy: no such file or directory: ${src}`);
    }

    if (!fs.existsSync(srcPath)) {
      throw new Error(`copy: no such file or directory: ${src}`);
    }

    if (super.exists(dest)) {
      throw new Error(`copy: destination already exists: ${dest}`);
    }

    const stats = fs.statSync(srcPath);

    if (stats.isDirectory()) {
      if (!recursive) {
        throw new Error(`copy: source is a directory (and recursive option is not used): ${src}`);
      }

      super.mkdir(dest);
      const entries = fs.readdirSync(srcPath);
      for (const entry of entries) {
        const srcChild = nodePath.join(src, entry);
        const destChild = nodePath.join(dest, entry);
        this.copyHostToVirtual(srcChild, destChild, true);
      }
    } else {
      const content = fs.readFileSync(srcPath, 'utf-8');
      super.write(dest, content);
    }
  }

  private copyVirtualToHost(src: string, dest: string, recursive: boolean): void {
    if (!this.allowWrite) {
      throw new Error(`copy: filesystem mounted read-only`);
    }

    const destPath = this.toHostPath(dest);

    if (!destPath || !this.mounted) {
      throw new Error(`copy: invalid destination path`);
    }

    if (!super.exists(src)) {
      throw new Error(`copy: no such file or directory: ${src}`);
    }

    if (fs.existsSync(destPath)) {
      throw new Error(`copy: destination already exists: ${dest}`);
    }

    const stats = super.stat(src);

    if (stats.type === 'directory') {
      if (!recursive) {
        throw new Error(`copy: source is a directory (and recursive option is not used): ${src}`);
      }

      fs.mkdirSync(destPath, { recursive: true });
      const entries = super.list(src);
      for (const entry of entries) {
        const srcChild = nodePath.join(src, entry);
        const destChild = nodePath.join(dest, entry);
        this.copyVirtualToHost(srcChild, destChild, true);
      }
    } else {
      const content = super.read(src);
      if (typeof content === 'string') {
        fs.writeFileSync(destPath, content, 'utf-8');
      } else {
        // Handle Promise case (shouldn't happen for virtual files)
        content.then(c => fs.writeFileSync(destPath, c, 'utf-8'));
      }
    }
  }

  /**
   * Move (rename) a file or directory.
   */
  public move(src: string, dest: string): void {
    const srcIsHost = this.isHostPath(src);
    const destIsHost = this.isHostPath(dest);

    // If both are on the same filesystem, we can use native move
    if (srcIsHost && destIsHost) {
      if (!this.allowWrite) {
        throw new Error(`move: filesystem mounted read-only`);
      }

      const srcPath = this.toHostPath(src);
      const destPath = this.toHostPath(dest);

      if (!srcPath || !destPath || !this.mounted) {
        throw new Error(`move: invalid path`);
      }

      if (!fs.existsSync(srcPath)) {
        throw new Error(`move: no such file or directory: ${src}`);
      }

      if (fs.existsSync(destPath)) {
        throw new Error(`move: destination already exists: ${dest}`);
      }

      fs.renameSync(srcPath, destPath);
      return;
    }

    if (!srcIsHost && !destIsHost) {
      super.move(src, dest);
      return;
    }

    // Cross-filesystem move: copy then remove
    this.copy(src, dest, true);
    this.remove(src, true);
  }
}
