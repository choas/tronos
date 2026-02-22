import type { BuiltinCommand, CommandResult } from '../types';
import { isDevPath, getDevPermissions } from '../../vfs/dev';
import { isDocsFile, getDocsSizeSync } from '../../vfs/docs';

interface FileNode {
  type: 'file' | 'directory';
  children?: string[];
  content?: string;
  permissions: string;
  owner: string;
  group: string;
  size: number;
  modified: Date;
}

// Mock VFS for now - will be replaced with real VFS later
const mockFilesystem: Record<string, FileNode> = {
  '/': {
    type: 'directory',
    children: ['home', 'bin', 'usr', 'etc', 'tmp'],
    permissions: 'rwxr-xr-x',
    owner: 'root',
    group: 'root',
    size: 4096,
    modified: new Date()
  },
  '/home': {
    type: 'directory',
    children: ['aios'],
    permissions: 'rwxr-xr-x',
    owner: 'root',
    group: 'root',
    size: 4096,
    modified: new Date()
  },
  '/home/tronos': {
    type: 'directory',
    children: ['documents', 'downloads', '.profile'],
    permissions: 'rwxr-xr-x',
    owner: 'tronos',
    group: 'tronos',
    size: 4096,
    modified: new Date()
  },
  '/home/tronos/documents': {
    type: 'directory',
    children: [],
    permissions: 'rwxr-xr-x',
    owner: 'tronos',
    group: 'tronos',
    size: 4096,
    modified: new Date()
  },
  '/home/tronos/downloads': {
    type: 'directory',
    children: [],
    permissions: 'rwxr-xr-x',
    owner: 'tronos',
    group: 'tronos',
    size: 4096,
    modified: new Date()
  },
  '/home/tronos/.profile': {
    type: 'file',
    content: '# User profile\nexport PATH=$PATH:/bin\nexport USER=aios',
    permissions: 'rw-r--r--',
    owner: 'tronos',
    group: 'tronos',
    size: 52,
    modified: new Date()
  },
  '/bin': {
    type: 'directory',
    children: ['ls.trx', 'cat.trx', 'echo.trx'],
    permissions: 'rwxr-xr-x',
    owner: 'root',
    group: 'root',
    size: 4096,
    modified: new Date()
  },
  '/bin/ls.trx': {
    type: 'file',
    content: '#!/bin/bash\n# ls executable\necho "ls implementation"',
    permissions: 'rwxr-xr-x',
    owner: 'root',
    group: 'root',
    size: 45,
    modified: new Date()
  },
  '/bin/cat.trx': {
    type: 'file',
    content: '#!/bin/bash\n# cat executable',
    permissions: 'rwxr-xr-x',
    owner: 'root',
    group: 'root',
    size: 30,
    modified: new Date()
  },
  '/bin/echo.trx': {
    type: 'file',
    content: '#!/bin/bash\n# echo executable',
    permissions: 'rwxr-xr-x',
    owner: 'root',
    group: 'root',
    size: 30,
    modified: new Date()
  }
};

function formatPermissions(permissions: string): string {
  return permissions;
}

function formatSize(size: number, humanReadable: boolean): string {
  if (humanReadable) {
    const units = ['B', 'K', 'M', 'G'];
    let unitIndex = 0;
    let displaySize = size;
    
    while (displaySize >= 1024 && unitIndex < units.length - 1) {
      displaySize /= 1024;
      unitIndex++;
    }
    
    return `${displaySize.toFixed(displaySize < 10 ? 1 : 0)}${units[unitIndex]}`;
  }
  return size.toString();
}

function formatFileName(name: string, isDirectory: boolean, isExecutable: boolean): string {
  // ANSI color codes
  const BLUE = '\x1b[34m';
  const GREEN = '\x1b[32m';
  const RESET = '\x1b[0m';
  
  if (isDirectory) {
    return `${BLUE}${name}${RESET}`;
  }
  if (isExecutable) {
    return `${GREEN}${name}${RESET}`;
  }
  return name;
}

function listDirectory(path: string, options: { all: boolean; long: boolean; humanReadable: boolean }): CommandResult {
  const node = mockFilesystem[path];
  
  if (!node) {
    return {
      stdout: '',
      stderr: `ls: cannot access '${path}': No such file or directory`,
      exitCode: 2
    };
  }
  
  if (node.type !== 'directory') {
    // If it's a file, just list the file itself
    const isExecutable = node.permissions.includes('x');
    const fileName = formatFileName(path.split('/').pop() || path, false, isExecutable);
    return {
      stdout: fileName,
      stderr: '',
      exitCode: 0
    };
  }
  
  const children = node.children || [];
  let entries = children;
  
  // Filter out hidden files unless -a is used
  if (!options.all) {
    entries = children.filter(name => !name.startsWith('.'));
  }
  
  if (options.long) {
    let output = '';
    for (const entry of entries) {
      const entryPath = path === '/' ? `/${entry}` : `${path}/${entry}`;
      const entryNode = mockFilesystem[entryPath];

      if (entryNode) {
        const isDir = entryNode.type === 'directory';
        const typeChar = isDir ? 'd' : '-';
        const perms = formatPermissions(entryNode.permissions);
        const size = formatSize(entryNode.size, options.humanReadable);
        const modified = entryNode.modified.toISOString().split('T')[0];
        const name = formatFileName(entry, isDir, !isDir && entryNode.permissions.includes('x'));

        output += `${typeChar}${perms} 1 ${entryNode.owner} ${entryNode.group} ${size.padStart(8)} ${modified} ${name}\n`;
      }
    }
    return {
      stdout: output.trim(),
      stderr: '',
      exitCode: 0
    };
  } else {
    // Simple listing
    const formattedEntries = entries.map((entry: string) => {
      const entryPath = path === '/' ? `/${entry}` : `${path}/${entry}`;
      const entryNode = mockFilesystem[entryPath];
      const isDir = entryNode?.type === 'directory';
      const isExecutable = entryNode?.permissions.includes('x');
      return formatFileName(entry, isDir, !!isExecutable);
    });
    
    return {
      stdout: formattedEntries.join('  '),
      stderr: '',
      exitCode: 0
    };
  }
}

import type { ExecutionContext } from '../types';

function listDirectoryVFS(
  paths: string[],
  options: { all: boolean; long: boolean; humanReadable: boolean },
  context: ExecutionContext
): CommandResult {
  const vfs = context.vfs!;
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  // Resolve paths using VFS
  const resolvedPaths = paths.map(p => {
    // "." means current working directory
    if (p === '.') {
      return vfs.cwd();
    }
    // Use VFS resolve for relative paths
    return vfs.resolve(p);
  });

  for (let i = 0; i < resolvedPaths.length; i++) {
    const resolvedPath = resolvedPaths[i];
    const originalPath = paths[i];

    // Check if path exists
    if (!vfs.exists(resolvedPath)) {
      stderr += `ls: cannot access '${originalPath}': No such file or directory\n`;
      exitCode = 2;
      continue;
    }

    // If it's a file, list just the file
    if (vfs.isFile(resolvedPath)) {
      const stat = vfs.stat(resolvedPath);
      const name = stat.name;
      const isExecutable = name.endsWith('.trx');
      const isCharDevice = isDevPath(resolvedPath);

      if (resolvedPaths.length > 1) {
        if (stdout.length > 0) stdout += '\n\n';
        stdout += `${originalPath}:\n`;
      }

      if (options.long) {
        // Long format for single file
        let typeChar: string;
        let perms: string;

        if (isCharDevice) {
          typeChar = 'c';
          perms = getDevPermissions(resolvedPath) || 'rw-rw-rw-';
        } else if (isExecutable) {
          typeChar = '-';
          perms = 'rwxr-xr-x';
        } else {
          typeChar = '-';
          perms = 'rw-r--r--';
        }

        let size = 0;
        if (!isCharDevice) {
          try {
            const content = vfs.read(resolvedPath);
            if (typeof content === 'string') {
              size = content.length;
            }
          } catch {
            size = 0;
          }
        }
        // Character devices show size as 0

        const sizeStr = formatSize(size, options.humanReadable);
        const modified = new Date(stat.meta.updatedAt).toISOString().split('T')[0];
        const formattedName = formatFileName(name, false, isExecutable);
        stdout += `${typeChar}${perms} 1 user user ${sizeStr.padStart(8)} ${modified} ${formattedName}`;
      } else {
        const formatted = formatFileName(name, false, isExecutable);
        stdout += formatted;
      }
      continue;
    }

    // It's a directory - list contents
    try {
      // Add header for multiple paths
      if (resolvedPaths.length > 1) {
        if (stdout.length > 0) stdout += '\n\n';
        stdout += `${originalPath}:\n`;
      }

      const entries = vfs.list(resolvedPath);
      let filteredEntries = entries;

      // Filter hidden files unless -a flag
      if (!options.all) {
        filteredEntries = entries.filter(name => !name.startsWith('.'));
      }

      if (options.long) {
        // Long format listing
        const detailedEntries = vfs.listDetailed(resolvedPath);
        let filtered = detailedEntries;
        if (!options.all) {
          filtered = detailedEntries.filter(node => !node.name.startsWith('.'));
        }

        for (const node of filtered) {
          const isDir = node.type === 'directory';
          const isExecutable = node.name.endsWith('.trx');
          const filePath = resolvedPath === '/' ? `/${node.name}` : `${resolvedPath}/${node.name}`;

          // Check if this is a character device (in /dev)
          const isCharDevice = isDevPath(filePath) && node.type === 'file';

          // Determine type character and permissions string
          let typeChar: string;
          let perms: string;

          if (isDir) {
            typeChar = 'd';
            perms = 'rwxr-xr-x';
          } else if (isCharDevice) {
            typeChar = 'c';
            // Get actual device permissions
            perms = getDevPermissions(filePath) || 'rw-rw-rw-';
          } else if (isExecutable) {
            typeChar = '-';
            perms = 'rwxr-xr-x';
          } else {
            typeChar = '-';
            perms = 'rw-r--r--';
          }

          // Calculate size
          let size = 0;
          if (node.type === 'virtual' && isDocsFile(filePath)) {
            size = getDocsSizeSync(filePath) ?? 0;
          } else if (node.type === 'file' && !isCharDevice) {
            try {
              const content = vfs.read(filePath);
              // Handle async read
              if (typeof content === 'string') {
                size = content.length;
              }
            } catch {
              size = 0;
            }
          } else if (isDir) {
            size = 4096;
          }
          // Character devices show size as 0

          const sizeStr = formatSize(size, options.humanReadable);
          const modified = new Date(node.meta.updatedAt).toISOString().split('T')[0];
          const formattedName = formatFileName(node.name, isDir, isExecutable);

          stdout += `${typeChar}${perms} 1 user user ${sizeStr.padStart(8)} ${modified} ${formattedName}\n`;
        }

        // Remove trailing newline for consistency
        stdout = stdout.replace(/\n$/, '');
      } else {
        // Simple listing
        const formattedEntries = filteredEntries.map(name => {
          const entryPath = resolvedPath === '/' ? `/${name}` : `${resolvedPath}/${name}`;
          const isDir = vfs.isDirectory(entryPath);
          const isExecutable = name.endsWith('.trx');
          return formatFileName(name, isDir, isExecutable);
        });

        stdout += formattedEntries.join('  ');
      }
    } catch (error) {
      stderr += `ls: cannot access '${originalPath}': ${(error as Error).message}\n`;
      exitCode = 2;
    }
  }

  return {
    stdout,
    stderr: stderr.trim(),
    exitCode
  };
}

export const ls: BuiltinCommand = async (args, context) => {
  const options = {
    all: false,
    long: false,
    humanReadable: false
  };

  const paths: string[] = [];

  // Parse command line arguments
  for (const arg of args) {
    if (arg === '-a' || arg === '--all') {
      options.all = true;
    } else if (arg === '-l' || arg === '--long') {
      options.long = true;
    } else if (arg === '-h' || arg === '--human-readable') {
      options.humanReadable = true;
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -la, -lh, -lah
      for (const char of arg.slice(1)) {
        if (char === 'a') options.all = true;
        else if (char === 'l') options.long = true;
        else if (char === 'h') options.humanReadable = true;
      }
    } else {
      paths.push(arg);
    }
  }

  // If no paths specified, use current directory from VFS
  if (paths.length === 0) {
    paths.push('.');
  }

  // Use VFS if available
  if (context.vfs) {
    return listDirectoryVFS(paths, options, context);
  }

  // Fallback to mock filesystem (legacy path)
  const resolvedPaths = paths.map(p => {
    if (p === '.') return '/';
    if (p.startsWith('./')) return '/' + p.slice(2);
    if (p.startsWith('/')) return p;
    return '/' + p;
  });

  if (resolvedPaths.length === 1) {
    return listDirectory(resolvedPaths[0], options);
  }

  // Multiple paths - list each with header
  let output = '';
  for (let i = 0; i < resolvedPaths.length; i++) {
    const p = resolvedPaths[i];
    if (i > 0) output += '\n\n';
    if (resolvedPaths.length > 1) {
      output += `${p}:\n`;
    }
    const result = listDirectory(p, options);
    if (result.exitCode !== 0) {
      return result;
    }
    output += result.stdout;
  }

  return {
    stdout: output,
    stderr: '',
    exitCode: 0
  };
};

export const cd: BuiltinCommand = async (args, context) => {
  const path = args[0] || context.env.HOME || '/home/tronos';

  // Handle ~ expansion
  let targetPath = path;
  if (path === '~' || path.startsWith('~/')) {
    const home = context.env.HOME || '/home/tronos';
    targetPath = path === '~' ? home : home + path.slice(1);
  }

  // Validate the target path before attempting to change directory
  if (context.vfs) {
    const resolvedPath = context.vfs.resolve(targetPath);

    // Check if path exists
    if (!context.vfs.exists(resolvedPath)) {
      return {
        stdout: '',
        stderr: `cd: ${path}: No such file or directory`,
        exitCode: 1
      };
    }

    // Check if path is a directory
    if (!context.vfs.isDirectory(resolvedPath)) {
      return {
        stdout: '',
        stderr: `cd: ${path}: Not a directory`,
        exitCode: 1
      };
    }
  }

  // Store the requested path in context for the shell to handle
  // This is a workaround since we don't have direct access to shell state
  (context as any).requestedCd = targetPath;

  return {
    stdout: '',
    stderr: '',
    exitCode: 0
  };
};

export const pwd: BuiltinCommand = async (_args, context) => {
  const cwd = context.env.PWD || '/';
  return {
    stdout: cwd,
    stderr: '',
    exitCode: 0
  };
};

export const cat: BuiltinCommand = async (args, context) => {
  // If no arguments and we have stdin, output stdin
  if (args.length === 0) {
    if (context.stdin !== undefined) {
      return {
        stdout: context.stdin,
        stderr: '',
        exitCode: 0
      };
    }
    return {
      stdout: '',
      stderr: 'cat: missing file operand',
      exitCode: 1
    };
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  for (const arg of args) {
    try {
      // Use the VFS from context if available, otherwise fall back to mock filesystem
      if (context.vfs) {
        const content = await context.vfs.read(arg);
        if (args.length > 1) {
          stdout += `\n==> ${arg} <==\n`;
        }
        stdout += content;
        if (args.length > 1) {
          stdout += '\n';
        }
      } else {
        // Fallback to mock filesystem for backward compatibility
        const resolvedPath = arg.startsWith('/') ? arg : '/' + arg;
        const node = mockFilesystem[resolvedPath];
        
        if (!node) {
          stderr += `cat: ${arg}: No such file or directory\n`;
          exitCode = 1;
          continue;
        }
        
        if (node.type !== 'file') {
          stderr += `cat: ${arg}: Is a directory\n`;
          exitCode = 1;
          continue;
        }
        
        if (args.length > 1) {
          stdout += `==> ${arg} <==\n`;
        }
        stdout += node.content || '';
        if (args.length > 1) {
          stdout += '\n';
        }
      }
    } catch (error) {
      stderr += `cat: ${arg}: ${(error as Error).message}\n`;
      exitCode = 1;
    }
  }

  // Remove trailing newline for single files
  if (args.length === 1 && stdout.endsWith('\n')) {
    stdout = stdout.slice(0, -1);
  }

  return {
    stdout,
    stderr,
    exitCode
  };
};

function processEscapeSequences(str: string): string {
  return str.replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\b/g, '\b')
            .replace(/\\f/g, '\f')
            .replace(/\\v/g, '\v')
            .replace(/\\0/g, '\0')
            .replace(/\\\\/g, '\\')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'");
}

export const echo: BuiltinCommand = async (args, _context) => {
  // Parse arguments to handle quoted strings and escape sequences
  let escapeSequences = false;
  let trailingNewline = true;
  
  const processedArgs: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-n') {
      trailingNewline = false;
    } else if (arg === '-e') {
      escapeSequences = true;
    } else if (arg === '-E') {
      escapeSequences = false;
    } else {
      // Process the argument
      let processedArg = arg;
      
      // Handle escape sequences if -e flag is set
      if (escapeSequences) {
        processedArg = processEscapeSequences(processedArg);
      }
      
      processedArgs.push(processedArg);
    }
  }
  
  // Join arguments with spaces
  let output = processedArgs.join(' ');
  
  // Add trailing newline unless -n was specified
  if (trailingNewline) {
    output += '\n';
  }
  
  return {
    stdout: output,
    stderr: '',
    exitCode: 0
  };
};

export const mkdir: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'mkdir: missing operand',
      exitCode: 1
    };
  }

  let recursive = false;
  const paths: string[] = [];
  
  // Parse command line arguments
  for (const arg of args) {
    if (arg === '-p' || arg === '--parents') {
      recursive = true;
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -pv (though only -p is valid)
      for (const char of arg.slice(1)) {
        if (char === 'p') recursive = true;
        else {
          return {
            stdout: '',
            stderr: `mkdir: invalid option -- '${char}'`,
            exitCode: 1
          };
        }
      }
    } else {
      paths.push(arg);
    }
  }

  let stderr = '';
  let exitCode = 0;

  for (const path of paths) {
    try {
      if (context.vfs) {
        // Use VFS if available
        context.vfs.mkdir(path, recursive);
      } else {
        // Fallback to mock filesystem
        const resolvedPath = path.startsWith('/') ? path : '/' + path;
        
        if (mockFilesystem[resolvedPath]) {
          stderr += `mkdir: cannot create directory '${path}': File exists\n`;
          exitCode = 1;
          continue;
        }
        
        // Add to parent directory's children
        const parentPath = '/' + path.split('/').slice(0, -1).join('/');
        const parentDir = mockFilesystem[parentPath] || mockFilesystem['/'];
        
        if (parentDir && parentDir.type === 'directory') {
          const dirName = path.split('/').pop() || path;
          parentDir.children = parentDir.children || [];
          parentDir.children.push(dirName);
          
          // Create directory entry
          mockFilesystem[resolvedPath] = {
            type: 'directory',
            children: [],
            permissions: 'rwxr-xr-x',
            owner: 'user',
            group: 'user',
            size: 4096,
            modified: new Date()
          };
        } else {
          stderr += `mkdir: cannot create directory '${path}': No such file or directory\n`;
          exitCode = 1;
        }
      }
    } catch (error) {
      stderr += `mkdir: cannot create directory '${path}': ${(error as Error).message}\n`;
      exitCode = 1;
    }
  }

  return {
    stdout: '',
    stderr: stderr.trim(),
    exitCode
  };
};

export const touch: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'touch: missing file operand',
      exitCode: 1
    };
  }

  let stderr = '';
  let exitCode = 0;

  for (const path of args) {
    try {
      if (context.vfs) {
        // Use VFS if available
        if (context.vfs.exists(path)) {
          // File exists, update timestamp
          const node = context.vfs.stat(path);
          if (node.type === 'file') {
            node.meta.updatedAt = Date.now();
          } else {
            stderr += `touch: '${path}': Is a directory\n`;
            exitCode = 1;
          }
        } else {
          // File doesn't exist, create empty file
          context.vfs.write(path, '');
        }
      } else {
        // Fallback to mock filesystem
        const resolvedPath = path.startsWith('/') ? path : '/' + path;
        
        if (mockFilesystem[resolvedPath]) {
          // Update existing file's timestamp
          mockFilesystem[resolvedPath].modified = new Date();
        } else {
          // Create new empty file
          const parentPath = '/' + path.split('/').slice(0, -1).join('/');
          const parentDir = mockFilesystem[parentPath] || mockFilesystem['/'];
          
          if (parentDir && parentDir.type === 'directory') {
            const fileName = path.split('/').pop() || path;
            parentDir.children = parentDir.children || [];
            parentDir.children.push(fileName);
            
            mockFilesystem[resolvedPath] = {
              type: 'file',
              content: '',
              permissions: 'rw-r--r--',
              owner: 'user',
              group: 'user',
              size: 0,
              modified: new Date()
            };
          } else {
            stderr += `touch: '${path}': No such file or directory\n`;
            exitCode = 1;
          }
        }
      }
    } catch (error) {
      stderr += `touch: '${path}': ${(error as Error).message}\n`;
      exitCode = 1;
    }
  }

  return {
    stdout: '',
    stderr: stderr.trim(),
    exitCode
  };
};

function removeFilesystemNode(path: string, recursive: boolean): { success: boolean; error?: string } {
  const node = mockFilesystem[path];
  
  if (!node) {
    return { success: false, error: `No such file or directory` };
  }
  
  if (node.type === 'directory' && !recursive) {
    const children = node.children || [];
    if (children.length > 0) {
      return { success: false, error: `Directory not empty` };
    }
  }
  
  if (node.type === 'directory' && recursive) {
    // Recursively remove all children
    const children = node.children || [];
    for (const child of children) {
      const childPath = path === '/' ? `/${child}` : `${path}/${child}`;
      const result = removeFilesystemNode(childPath, true);
      if (!result.success) {
        return result;
      }
    }
  }
  
  // Remove from parent's children
  const parentPath = '/' + path.split('/').slice(0, -1).join('/');
  const parentDir = mockFilesystem[parentPath];
  if (parentDir && parentDir.children) {
    const fileName = path.split('/').pop() || path;
    const index = parentDir.children.indexOf(fileName);
    if (index !== -1) {
      parentDir.children.splice(index, 1);
    }
  }
  
  // Delete the node
  delete mockFilesystem[path];
  return { success: true };
}

export const rm: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'rm: missing operand',
      exitCode: 1
    };
  }

  let recursive = false;
  let force = false;
  const paths: string[] = [];
  
  // Parse command line arguments
  for (const arg of args) {
    if (arg === '-r' || arg === '--recursive' || arg === '-R') {
      recursive = true;
    } else if (arg === '-f' || arg === '--force') {
      force = true;
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -rf, -fr
      for (const char of arg.slice(1)) {
        if (char === 'r' || char === 'R') recursive = true;
        else if (char === 'f') force = true;
        else {
          return {
            stdout: '',
            stderr: `rm: invalid option -- '${char}'`,
            exitCode: 1
          };
        }
      }
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    return {
      stdout: '',
      stderr: 'rm: missing operand',
      exitCode: 1
    };
  }

  let stderr = '';
  let exitCode = 0;

  for (const path of paths) {
    try {
      if (context.vfs) {
        // Use VFS if available
        try {
          context.vfs.remove(path, recursive);
        } catch (error) {
          if (!force) {
            stderr += `rm: cannot remove '${path}': ${(error as Error).message}\n`;
            exitCode = 1;
          }
        }
      } else {
        // Fallback to mock filesystem
        const resolvedPath = path.startsWith('/') ? path : '/' + path;
        
        if (!mockFilesystem[resolvedPath]) {
          if (!force) {
            stderr += `rm: cannot remove '${path}': No such file or directory\n`;
            exitCode = 1;
          }
          continue;
        }
        
        const node = mockFilesystem[resolvedPath];
        
        // Check if trying to remove non-empty directory without -r
        if (node.type === 'directory' && !recursive && (node.children?.length || 0) > 0) {
          if (!force) {
            stderr += `rm: cannot remove '${path}': Directory not empty\n`;
            exitCode = 1;
          }
          continue;
        }
        
        // For directories without -r and -f, confirm before deletion
        if (node.type === 'directory' && !recursive && !force) {
          stderr += `rm: cannot remove '${path}': Is a directory\n`;
          exitCode = 1;
          continue;
        }
        
        const result = removeFilesystemNode(resolvedPath, recursive);
        if (!result.success && !force) {
          stderr += `rm: cannot remove '${path}': ${result.error}\n`;
          exitCode = 1;
        }
      }
    } catch (error) {
      if (!force) {
        stderr += `rm: cannot remove '${path}': ${(error as Error).message}\n`;
        exitCode = 1;
      }
    }
  }

  return {
    stdout: '',
    stderr: stderr.trim(),
    exitCode
  };
};

function copyFilesystemNode(srcPath: string, destPath: string, recursive: boolean): { success: boolean; error?: string } {
  const srcNode = mockFilesystem[srcPath];
  
  if (!srcNode) {
    return { success: false, error: `No such file or directory` };
  }
  
  const destNode = mockFilesystem[destPath];
  
  // Handle destination as directory vs file
  if (destNode && destNode.type === 'directory') {
    // Copy into directory, preserving name
    const srcName = srcPath.split('/').pop() || srcPath;
    const finalDestPath = destPath === '/' ? `/${srcName}` : `${destPath}/${srcName}`;
    
    if (mockFilesystem[finalDestPath]) {
      return { success: false, error: `File exists` };
    }
    
    destPath = finalDestPath;
  }
  
  // Check if destination already exists
  if (mockFilesystem[destPath]) {
    return { success: false, error: `File exists` };
  }
  
  if (srcNode.type === 'directory' && !recursive) {
    const children = srcNode.children || [];
    if (children.length > 0) {
      return { success: false, error: `Omitting directory` };
    }
  }
  
  // Add destination to parent directory's children
  const destParentPath = '/' + destPath.split('/').slice(0, -1).join('/');
  const destParentDir = mockFilesystem[destParentPath];
  
  if (!destParentDir || destParentDir.type !== 'directory') {
    return { success: false, error: `No such file or directory` };
  }
  
  const destName = destPath.split('/').pop() || destPath;
  destParentDir.children = destParentDir.children || [];
  destParentDir.children.push(destName);
  
  // Create copy of the node
  if (srcNode.type === 'file') {
    mockFilesystem[destPath] = {
      type: 'file',
      content: srcNode.content,
      permissions: srcNode.permissions,
      owner: srcNode.owner,
      group: srcNode.group,
      size: srcNode.size,
      modified: new Date()
    };
  } else {
    // Directory
    mockFilesystem[destPath] = {
      type: 'directory',
      children: [],
      permissions: srcNode.permissions,
      owner: srcNode.owner,
      group: srcNode.group,
      size: srcNode.size,
      modified: new Date()
    };
    
    // Recursively copy children if recursive is true
    if (recursive) {
      const srcChildren = srcNode.children || [];
      for (const child of srcChildren) {
        const childSrcPath = srcPath === '/' ? `/${child}` : `${srcPath}/${child}`;
        const childDestPath = `${destPath}/${child}`;
        const result = copyFilesystemNode(childSrcPath, childDestPath, true);
        if (!result.success) {
          return result;
        }
      }
    }
  }
  
  return { success: true };
}

function moveFilesystemNode(srcPath: string, destPath: string): { success: boolean; error?: string } {
  const srcNode = mockFilesystem[srcPath];
  
  if (!srcNode) {
    return { success: false, error: `No such file or directory` };
  }
  
  const destNode = mockFilesystem[destPath];
  
  // Handle destination as directory vs file
  if (destNode && destNode.type === 'directory') {
    // Move into directory, preserving name
    const srcName = srcPath.split('/').pop() || srcPath;
    const finalDestPath = destPath === '/' ? `/${srcName}` : `${destPath}/${srcName}`;
    
    if (mockFilesystem[finalDestPath]) {
      return { success: false, error: `File exists` };
    }
    
    destPath = finalDestPath;
  }
  
  // Check if destination already exists
  if (mockFilesystem[destPath]) {
    return { success: false, error: `File exists` };
  }
  
  // Remove from source parent directory
  const srcParentPath = '/' + srcPath.split('/').slice(0, -1).join('/');
  const srcParentDir = mockFilesystem[srcParentPath];
  if (srcParentDir && srcParentDir.children) {
    const srcName = srcPath.split('/').pop() || srcPath;
    const index = srcParentDir.children.indexOf(srcName);
    if (index !== -1) {
      srcParentDir.children.splice(index, 1);
    }
  }
  
  // Add to destination parent directory
  const destParentPath = '/' + destPath.split('/').slice(0, -1).join('/');
  const destParentDir = mockFilesystem[destParentPath];
  
  if (!destParentDir || destParentDir.type !== 'directory') {
    return { success: false, error: `No such file or directory` };
  }
  
  const destName = destPath.split('/').pop() || destPath;
  destParentDir.children = destParentDir.children || [];
  destParentDir.children.push(destName);
  
  // Move the node
  mockFilesystem[destPath] = srcNode;
  delete mockFilesystem[srcPath];
  
  // Update modified time
  srcNode.modified = new Date();
  
  return { success: true };
}

export const cp: BuiltinCommand = async (args, context) => {
  if (args.length < 2) {
    return {
      stdout: '',
      stderr: 'cp: missing file operand',
      exitCode: 1
    };
  }

  let recursive = false;
  const paths: string[] = [];
  
  // Parse command line arguments
  for (const arg of args) {
    if (arg === '-r' || arg === '-R' || arg === '--recursive') {
      recursive = true;
    } else if (arg.startsWith('-')) {
      // Handle combined flags
      for (const char of arg.slice(1)) {
        if (char === 'r' || char === 'R') recursive = true;
        else {
          return {
            stdout: '',
            stderr: `cp: invalid option -- '${char}'`,
            exitCode: 1
          };
        }
      }
    } else {
      paths.push(arg);
    }
  }

  if (paths.length < 2) {
    return {
      stdout: '',
      stderr: 'cp: missing destination file operand',
      exitCode: 1
    };
  }

  const sourcePaths = paths.slice(0, -1);
  const destPath = paths[paths.length - 1];
  
  let stderr = '';
  let exitCode = 0;

  if (context.vfs) {
    // Use VFS if available
    for (const srcPath of sourcePaths) {
      try {
        context.vfs.copy(srcPath, destPath, recursive);
      } catch (error) {
        stderr += `cp: cannot copy '${srcPath}' to '${destPath}': ${(error as Error).message}\n`;
        exitCode = 1;
      }
    }
  } else {
    // Fallback to mock filesystem
    const resolvedDestPath = destPath.startsWith('/') ? destPath : '/' + destPath;
    
    for (const srcPath of sourcePaths) {
      const resolvedSrcPath = srcPath.startsWith('/') ? srcPath : '/' + srcPath;
      
      const result = copyFilesystemNode(resolvedSrcPath, resolvedDestPath, recursive);
      if (!result.success) {
        stderr += `cp: cannot copy '${srcPath}' to '${destPath}': ${result.error}\n`;
        exitCode = 1;
      }
    }
  }

  return {
    stdout: '',
    stderr: stderr.trim(),
    exitCode
  };
};

export const mv: BuiltinCommand = async (args, context) => {
  if (args.length < 2) {
    return {
      stdout: '',
      stderr: 'mv: missing file operand',
      exitCode: 1
    };
  }

  const sourcePaths = args.slice(0, -1);
  const destPath = args[args.length - 1];
  
  let stderr = '';
  let exitCode = 0;

  if (context.vfs) {
    // Use VFS if available
    for (const srcPath of sourcePaths) {
      try {
        context.vfs.move(srcPath, destPath);
      } catch (error) {
        stderr += `mv: cannot move '${srcPath}' to '${destPath}': ${(error as Error).message}\n`;
        exitCode = 1;
      }
    }
  } else {
    // Fallback to mock filesystem
    const resolvedDestPath = destPath.startsWith('/') ? destPath : '/' + destPath;
    
    for (const srcPath of sourcePaths) {
      const resolvedSrcPath = srcPath.startsWith('/') ? srcPath : '/' + srcPath;
      
      const result = moveFilesystemNode(resolvedSrcPath, resolvedDestPath);
      if (!result.success) {
        stderr += `mv: cannot move '${srcPath}' to '${destPath}': ${result.error}\n`;
        exitCode = 1;
      }
    }
  }

  return {
    stdout: '',
    stderr: stderr.trim(),
    exitCode
  };
};

export const head: BuiltinCommand = async (args, context) => {
  let lineCount = 10;
  const paths: string[] = [];
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-n' && i < args.length - 1) {
      const count = parseInt(args[i + 1]);
      if (isNaN(count) || count < 0) {
        return {
          stdout: '',
          stderr: 'head: invalid line count',
          exitCode: 1
        };
      }
      lineCount = count;
      i++; // Skip the next argument since it's the count
    } else if (arg.startsWith('-n')) {
      const count = parseInt(arg.slice(2));
      if (isNaN(count) || count < 0) {
        return {
          stdout: '',
          stderr: 'head: invalid line count',
          exitCode: 1
        };
      }
      lineCount = count;
    } else if (arg.startsWith('-') && !arg.startsWith('-n')) {
      return {
        stdout: '',
        stderr: `head: invalid option -- '${arg.slice(1)}'`,
        exitCode: 1
      };
    } else {
      paths.push(arg);
    }
  }

  // If no paths specified, read from stdin
  if (paths.length === 0) {
    if (context.stdin !== undefined) {
      let lines = context.stdin.split('\n');
      // Remove trailing empty string if input ended with newline
      if (lines[lines.length - 1] === '') {
        lines = lines.slice(0, -1);
      }
      const selectedLines = lines.slice(0, lineCount);
      const output = selectedLines.join('\n');
      return {
        stdout: output ? output + '\n' : '',
        stderr: '',
        exitCode: 0
      };
    }
    return {
      stdout: '',
      stderr: 'head: missing file operand',
      exitCode: 1
    };
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    
    try {
      let content: string;
      
      if (context.vfs) {
        // Use VFS if available
        if (!context.vfs.exists(path)) {
          stderr += `head: cannot open '${path}' for reading: No such file or directory\n`;
          exitCode = 1;
          continue;
        }
        const stat = context.vfs.stat(path);
        if (stat.type === 'directory') {
          stderr += `head: error reading '${path}': Is a directory\n`;
          exitCode = 1;
          continue;
        }
        content = await context.vfs.read(path);
      } else {
        // Fallback to mock filesystem
        const resolvedPath = path.startsWith('/') ? path : '/' + path;
        const node = mockFilesystem[resolvedPath];

        if (!node) {
          stderr += `head: cannot open '${path}' for reading: No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        if (node.type !== 'file') {
          stderr += `head: error reading '${path}': Is a directory\n`;
          exitCode = 1;
          continue;
        }

        content = node.content || '';
      }

      // Add header for multiple files
      if (paths.length > 1) {
        if (i > 0) stdout += '\n';
        stdout += `==> ${path} <==\n`;
      }

      // Split into lines and take first N lines
      const lines = content.split('\n');
      const headLines = lines.slice(0, lineCount);
      stdout += headLines.join('\n');

      // Ensure trailing newline only if original content ended with one
      if (content.endsWith('\n') && headLines.length > 0) {
        stdout += '\n';
      }

    } catch (error) {
      stderr += `head: ${path}: ${(error as Error).message}\n`;
      exitCode = 1;
    }
  }

  return {
    stdout: stdout.replace(/\n$/, ''), // Remove trailing newline
    stderr: stderr.trim(),
    exitCode
  };
};

export const tail: BuiltinCommand = async (args, context) => {
  let lineCount = 10;
  const paths: string[] = [];
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-n' && i < args.length - 1) {
      const count = parseInt(args[i + 1]);
      if (isNaN(count) || count < 0) {
        return {
          stdout: '',
          stderr: 'tail: invalid line count',
          exitCode: 1
        };
      }
      lineCount = count;
      i++; // Skip the next argument since it's the count
    } else if (arg.startsWith('-n')) {
      const count = parseInt(arg.slice(2));
      if (isNaN(count) || count < 0) {
        return {
          stdout: '',
          stderr: 'tail: invalid line count',
          exitCode: 1
        };
      }
      lineCount = count;
    } else if (arg.startsWith('-') && !arg.startsWith('-n')) {
      return {
        stdout: '',
        stderr: `tail: invalid option -- '${arg.slice(1)}'`,
        exitCode: 1
      };
    } else {
      paths.push(arg);
    }
  }

  // If no paths specified, read from stdin
  if (paths.length === 0) {
    if (context.stdin !== undefined) {
      let lines = context.stdin.split('\n');
      // Remove trailing empty string if input ended with newline
      if (lines[lines.length - 1] === '') {
        lines = lines.slice(0, -1);
      }
      const startIndex = Math.max(0, lines.length - lineCount);
      const selectedLines = lines.slice(startIndex);
      const output = selectedLines.join('\n');
      return {
        stdout: output ? output + '\n' : '',
        stderr: '',
        exitCode: 0
      };
    }
    return {
      stdout: '',
      stderr: 'tail: missing file operand',
      exitCode: 1
    };
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    
    try {
      let content: string;
      
      if (context.vfs) {
        // Use VFS if available
        if (!context.vfs.exists(path)) {
          stderr += `tail: cannot open '${path}' for reading: No such file or directory\n`;
          exitCode = 1;
          continue;
        }
        const stat = context.vfs.stat(path);
        if (stat.type === 'directory') {
          stderr += `tail: error reading '${path}': Is a directory\n`;
          exitCode = 1;
          continue;
        }
        content = await context.vfs.read(path);
      } else {
        // Fallback to mock filesystem
        const resolvedPath = path.startsWith('/') ? path : '/' + path;
        const node = mockFilesystem[resolvedPath];

        if (!node) {
          stderr += `tail: cannot open '${path}' for reading: No such file or directory\n`;
          exitCode = 1;
          continue;
        }
        
        if (node.type !== 'file') {
          stderr += `tail: error reading '${path}': Is a directory\n`;
          exitCode = 1;
          continue;
        }
        
        content = node.content || '';
      }
      
      // Add header for multiple files
      if (paths.length > 1) {
        if (i > 0) stdout += '\n';
        stdout += `==> ${path} <==\n`;
      }
      
      // Split into lines and take last N lines
      const lines = content.split('\n');
      // Handle case where file doesn't end with newline
      if (lines.length > 1 && lines[lines.length - 1] === '' && content.endsWith('\n')) {
        lines.pop(); // Remove empty string from final newline
      }
      const tailLines = lines.slice(-lineCount);
      stdout += tailLines.join('\n');
      
      // Add trailing newline if original content had one
      if (content.endsWith('\n')) {
        stdout += '\n';
      }
      
    } catch (error) {
      stderr += `tail: ${path}: ${(error as Error).message}\n`;
      exitCode = 1;
    }
  }

  return {
    stdout: stdout.replace(/\n$/, ''), // Remove trailing newline
    stderr: stderr.trim(),
    exitCode
  };
};

function highlightMatch(text: string, pattern: RegExp): string {
  const BOLD_RED = '\x1b[1;31m';
  const RESET = '\x1b[0m';
  
  return text.replace(pattern, (match) => {
    return `${BOLD_RED}${match}${RESET}`;
  });
}

export const grep: BuiltinCommand = async (args, context) => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'grep: missing pattern',
      exitCode: 2
    };
  }

  let pattern: RegExp | undefined;
  let showLineNumbers = false;
  let invertMatch = false;
  let ignoreCase = false;
  let paths: string[] = [];
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-n' || arg === '--line-number') {
      showLineNumbers = true;
    } else if (arg === '-v' || arg === '--invert-match') {
      invertMatch = true;
    } else if (arg === '-i' || arg === '--ignore-case') {
      ignoreCase = true;
    } else if (arg.startsWith('-') && !arg.startsWith('--')) {
      // Handle combined flags
      for (const char of arg.slice(1)) {
        if (char === 'n') showLineNumbers = true;
        else if (char === 'v') invertMatch = true;
        else if (char === 'i') ignoreCase = true;
        else {
          return {
            stdout: '',
            stderr: `grep: invalid option -- '${char}'`,
            exitCode: 2
          };
        }
      }
    } else if (!pattern) {
      // First non-option argument is the pattern
      try {
        const flags = ignoreCase ? 'gi' : 'g';
        pattern = new RegExp(arg, flags);
      } catch (error) {
        return {
          stdout: '',
          stderr: `grep: invalid pattern '${arg}': ${(error as Error).message}`,
          exitCode: 2
        };
      }
    } else {
      paths.push(arg);
    }
  }

  if (!pattern) {
    return {
      stdout: '',
      stderr: 'grep: missing pattern',
      exitCode: 2
    };
  }

  // If no paths specified, read from stdin
  if (paths.length === 0) {
    if (context.stdin !== undefined) {
      const lines = context.stdin.split('\n');
      const matchedLines: string[] = [];

      lines.forEach((line, index) => {
        const matches = pattern!.test(line);
        if ((matches && !invertMatch) || (!matches && invertMatch)) {
          if (showLineNumbers) {
            matchedLines.push(`${index + 1}:${highlightMatch(line, pattern!)}`);
          } else {
            matchedLines.push(highlightMatch(line, pattern!));
          }
        }
      });

      return {
        stdout: matchedLines.length > 0 ? matchedLines.join('\n') + '\n' : '',
        stderr: '',
        exitCode: matchedLines.length > 0 ? 0 : 1
      };
    }
    return {
      stdout: '',
      stderr: 'grep: missing file operand',
      exitCode: 2
    };
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let matchFound = false;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    
    try {
      let content: string;
      
      if (context.vfs) {
        // Use VFS if available
        if (!context.vfs.exists(path)) {
          stderr += `grep: ${path}: No such file or directory\n`;
          exitCode = 2;
          continue;
        }
        const stat = context.vfs.stat(path);
        if (stat.type === 'directory') {
          stderr += `grep: ${path}: Is a directory\n`;
          exitCode = 2;
          continue;
        }
        content = await context.vfs.read(path);
      } else {
        // Fallback to mock filesystem
        const resolvedPath = path.startsWith('/') ? path : '/' + path;
        const node = mockFilesystem[resolvedPath];

        if (!node) {
          stderr += `grep: ${path}: No such file or directory\n`;
          exitCode = 2;
          continue;
        }
        
        if (node.type !== 'file') {
          stderr += `grep: ${path}: Is a directory\n`;
          exitCode = 2;
          continue;
        }
        
        content = node.content || '';
      }
      
      const lines = content.split('\n');
      // Handle case where file doesn't end with newline
      if (lines.length > 1 && lines[lines.length - 1] === '' && content.endsWith('\n')) {
        lines.pop(); // Remove empty string from final newline
      }
      
      let fileHasMatch = false;
      
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const matches = pattern.test(line);
        
        // Reset regex lastIndex for global patterns
        if (pattern.global) {
          pattern.lastIndex = 0;
        }
        
        const shouldShow = (matches && !invertMatch) || (!matches && invertMatch);
        
        if (shouldShow) {
          matchFound = true;
          fileHasMatch = true;
          
          let outputLine = '';
          
          // Add filename prefix for multiple files
          if (paths.length > 1) {
            outputLine += `${path}:`;
          }
          
          // Add line number if requested
          if (showLineNumbers) {
            outputLine += `${lineNum + 1}:`;
          }
          
          // Highlight matches and add the line content (don't highlight when inverting)
          let displayLine = line;
          if (!invertMatch) {
            displayLine = highlightMatch(line, new RegExp(pattern.source, pattern.flags));
          }
          outputLine += displayLine;
          
          stdout += outputLine + '\n';
        }
      }
      
      // If no matches found and this is the only file, set exit code to 1
      if (!fileHasMatch && paths.length === 1) {
        exitCode = 1;
      }
      
    } catch (error) {
      stderr += `grep: ${path}: ${(error as Error).message}\n`;
      exitCode = 2;
    }
  }

      // If no matches found across all files, set exit code to 1 (but don't override error codes)
  if (!matchFound && exitCode === 0) {
    exitCode = 1;
  }

  return {
    stdout: stdout.replace(/\n$/, ''), // Remove trailing newline
    stderr: stderr.trim(),
    exitCode
  };
};

interface WCCounts {
  lines: number;
  words: number;
  characters: number;
}

function countContent(content: string): WCCounts {
  // Count lines: count number of newline characters
  const lineCount = (content.match(/\n/g) || []).length;

  // Count words: split by whitespace and filter out empty strings
  const words = content.trim().split(/\s+/).filter(word => word.length > 0);
  const wordCount = content.trim() === '' ? 0 : words.length;

  // Count characters: simple length
  const charCount = content.length;

  return {
    lines: lineCount,
    words: wordCount,
    characters: charCount
  };
}

export const wc: BuiltinCommand = async (args, context) => {
  let countLines = true;
  let countWords = true;
  let countChars = true;
  const paths: string[] = [];
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-l' || arg === '--lines') {
      countWords = false;
      countChars = false;
    } else if (arg === '-w' || arg === '--words') {
      countLines = false;
      countChars = false;
    } else if (arg === '-c' || arg === '--bytes') {
      countLines = false;
      countWords = false;
    } else if (arg.startsWith('-') && !arg.startsWith('--')) {
      // Handle combined flags like -lw, -lc, -wc, -lwc
      let hasLineFlag = false;
      let hasWordFlag = false;
      let hasCharFlag = false;
      
      for (const char of arg.slice(1)) {
        if (char === 'l') hasLineFlag = true;
        else if (char === 'w') hasWordFlag = true;
        else if (char === 'c') hasCharFlag = true;
        else {
          return {
            stdout: '',
            stderr: `wc: invalid option -- '${char}'`,
            exitCode: 1
          };
        }
      }
      
      // If any specific flags are provided, only count those
      if (hasLineFlag || hasWordFlag || hasCharFlag) {
        countLines = hasLineFlag;
        countWords = hasWordFlag;
        countChars = hasCharFlag;
      }
    } else {
      paths.push(arg);
    }
  }

  // If no paths specified, read from stdin
  if (paths.length === 0) {
    if (context.stdin !== undefined) {
      const counts = countContent(context.stdin);
      const parts: string[] = [];

      if (countLines) parts.push(counts.lines.toString());
      if (countWords) parts.push(counts.words.toString());
      if (countChars) parts.push(counts.characters.toString());

      return {
        stdout: parts.join(' '),
        stderr: '',
        exitCode: 0
      };
    }
    return {
      stdout: '',
      stderr: 'wc: missing file operand',
      exitCode: 1
    };
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  
  let totalLines = 0;
  let totalWords = 0;
  let totalChars = 0;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    
    try {
      let content: string;
      
      if (context.vfs) {
        // Use VFS if available
        if (!context.vfs.exists(path)) {
          stderr += `wc: ${path}: No such file or directory\n`;
          exitCode = 1;
          continue;
        }
        const stat = context.vfs.stat(path);
        if (stat.type === 'directory') {
          stderr += `wc: ${path}: Is a directory\n`;
          exitCode = 1;
          continue;
        }
        content = await context.vfs.read(path);
      } else {
        // Fallback to mock filesystem
        const resolvedPath = path.startsWith('/') ? path : '/' + path;
        const node = mockFilesystem[resolvedPath];

        if (!node) {
          stderr += `wc: ${path}: No such file or directory\n`;
          exitCode = 1;
          continue;
        }
        
        if (node.type !== 'file') {
          stderr += `wc: ${path}: Is a directory\n`;
          exitCode = 1;
          continue;
        }
        
        content = node.content || '';
      }
      
      const counts = countContent(content);
      totalLines += counts.lines;
      totalWords += counts.words;
      totalChars += counts.characters;
      
      // Build output line
      let outputLine = '';
      
      if (countLines) {
        outputLine += `${counts.lines.toString().padStart(8)}`;
      }
      if (countWords) {
        outputLine += `${counts.words.toString().padStart(8)}`;
      }
      if (countChars) {
        outputLine += `${counts.characters.toString().padStart(8)}`;
      }
      
      // Add filename if multiple files
      if (paths.length > 1) {
        outputLine += ` ${path}`;
      }
      
      stdout += outputLine + '\n';
      
    } catch (error) {
      stderr += `wc: ${path}: ${(error as Error).message}\n`;
      exitCode = 1;
    }
  }

  // Add total line if multiple files
  if (paths.length > 1 && exitCode === 0) {
    let totalLine = '';
    
    if (countLines) {
      totalLine += `${totalLines.toString().padStart(8)}`;
    }
    if (countWords) {
      totalLine += `${totalWords.toString().padStart(8)}`;
    }
    if (countChars) {
      totalLine += `${totalChars.toString().padStart(8)}`;
    }
    
    totalLine += ' total';
    stdout += totalLine + '\n';
  }

  return {
    stdout: stdout.replace(/\n$/, ''), // Remove trailing newline
    stderr: stderr.trim(),
    exitCode
  };
};