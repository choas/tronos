/**
 * TronOS Marketplace — Static package registry
 */

export type CollectionId = 'games' | 'editors' | 'devtools' | 'viz' | 'productivity' | 'network' | 'files' | 'enterprise';

export interface MarketplacePackage {
  name: string;
  description: string;
  version: string;
  author: string;
  collection: CollectionId;
  source: 'bundled' | 'example' | 'enterprise';
  tier?: 'free' | 'pro' | 'enterprise';
  requiresNetwork?: boolean;
}

export interface Collection {
  id: CollectionId;
  label: string;
  description: string;
}

export const COLLECTIONS: Collection[] = [
  { id: 'games', label: 'Games', description: 'Games and puzzles' },
  { id: 'editors', label: 'Editors', description: 'Text and hex editors' },
  { id: 'devtools', label: 'DevTools', description: 'Developer tools and utilities' },
  { id: 'viz', label: 'Viz', description: 'Visualizations and screensavers' },
  { id: 'productivity', label: 'Productivity', description: 'Productivity and organization tools' },
  { id: 'network', label: 'Network', description: 'Networking and web tools' },
  { id: 'files', label: 'Files', description: 'File management tools' },
  { id: 'enterprise', label: 'Enterprise', description: 'Enterprise connectors and features' },
];

export const MARKETPLACE_PACKAGES: MarketplacePackage[] = [
  // ── Games (16) ──────────────────────────────────────────────
  { name: '2048', description: 'Classic 2048 sliding tile puzzle game', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'breakout', description: 'Breakout/Arkanoid arcade game with multiple levels', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'chess', description: 'Full chess game with legal move validation, check/checkmate, en passant, castling, and promotion', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'connect4', description: 'Connect Four with AI opponent and two-player mode', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'guess', description: 'Number guessing game (1-50)', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'hangman', description: 'Word guessing game with ASCII art gallows', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'life', description: "Conway's Game of Life with color aging, presets, and edit/run modes", version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'minesweeper', description: 'Classic Minesweeper with h/t/n/c navigation and space to reveal', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'pong', description: 'Classic Pong game - 1P vs AI or 2P local multiplayer', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'roguelike', description: 'Roguelike dungeon crawler with rooms, enemies, and items', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'snake', description: 'Classic Snake game with arrow keys or hjkl', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'sokoban', description: 'Box-pushing puzzle game with multiple levels', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'sudoku', description: 'Sudoku puzzle game with generator, difficulty levels, and hints', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'tetris', description: 'Classic Tetris game with colorful pieces, scoring, and levels', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'tictactoe-ai', description: 'Tic-Tac-Toe with PvP and unbeatable AI (minimax)', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },
  { name: 'wordle', description: 'Wordle word guessing game with colored letter feedback', version: '1.0.0', author: '@community', collection: 'games', source: 'example' },

  // ── Editors (3) ─────────────────────────────────────────────
  { name: 'hexedit', description: 'Hex editor with dual-panel editing, search, and go-to-offset', version: '1.0.0', author: '@community', collection: 'editors', source: 'example' },
  { name: 'nano', description: 'Simple text editor with Ctrl shortcuts', version: '1.0.0', author: '@community', collection: 'editors', source: 'example' },
  { name: 'vim', description: 'Vi-like text editor with normal, insert, and command modes', version: '1.0.0', author: '@community', collection: 'editors', source: 'example' },

  // ── DevTools (11) ───────────────────────────────────────────
  { name: 'gist', description: 'GitHub Gist viewer and creator', version: '1.0.0', author: '@ai', collection: 'devtools', source: 'bundled', requiresNetwork: true },
  { name: 'base64', description: 'Encode/decode base64, hex, URL encoding, and JWT decoder', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'calc', description: 'Scientific calculator REPL with variables, functions, and base conversions', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'cron', description: 'Cron expression parser and builder with human-readable output', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'diff', description: 'File diff tool - compare two files with unified or side-by-side view', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'grep', description: 'Search tool - find patterns in files with regex support', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'htop', description: 'Interactive process viewer and system monitor', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'json', description: 'Interactive JSON viewer with syntax highlighting and collapsible sections', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'markdown', description: 'Terminal Markdown viewer with syntax highlighting and scrolling', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'regex', description: 'Interactive regex tester with live match highlighting', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },
  { name: 'sysinfo', description: 'Neofetch-style system information display for TronOS', version: '1.0.0', author: '@community', collection: 'devtools', source: 'example' },

  // ── Viz (10) ────────────────────────────────────────────────
  { name: 'aquarium', description: 'ASCII fish tank screensaver with multiple fish species', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'ascii-art', description: 'ASCII art gallery and text-to-art generator', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'clock', description: 'Beautiful multi-mode terminal clock with digital, analog, stopwatch, and timer', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'colors', description: 'Color picker and converter with terminal previews', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'figlet', description: 'ASCII art text generator with multiple fonts and color support', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'fireworks', description: 'Animated fireworks display with particle physics', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'mandelbrot', description: 'Interactive Mandelbrot fractal viewer with zoom and pan', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'matrix', description: 'Matrix digital rain screensaver - the iconic falling code effect', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'pipes', description: 'Classic pipes screensaver with colorful double-line box-drawing pipes', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },
  { name: 'starfield', description: '3D starfield screensaver with warp speed effect', version: '1.0.0', author: '@community', collection: 'viz', source: 'example' },

  // ── Productivity (7) ────────────────────────────────────────
  { name: 'notes', description: 'Notebook app with tags, search, and Markdown preview', version: '1.0.0', author: '@ai', collection: 'productivity', source: 'bundled' },
  { name: 'pomodoro', description: 'Pomodoro timer with session tracking and statistics', version: '1.0.0', author: '@ai', collection: 'productivity', source: 'bundled' },
  { name: 'translator', description: 'Text translation using AI providers', version: '1.0.0', author: '@ai', collection: 'productivity', source: 'bundled' },
  { name: 'budget', description: 'Expense tracker with categories and ASCII charts', version: '1.0.0', author: '@community', collection: 'productivity', source: 'example' },
  { name: 'contacts', description: 'Address book with search and contact management', version: '1.0.0', author: '@community', collection: 'productivity', source: 'example' },
  { name: 'kanban', description: 'Kanban board with columns and card management', version: '1.0.0', author: '@community', collection: 'productivity', source: 'example' },
  { name: 'todo', description: 'Persistent todo list manager with priorities and filtering', version: '1.0.0', author: '@community', collection: 'productivity', source: 'example' },

  // ── Network (9) ─────────────────────────────────────────────
  { name: 'weather', description: 'Weather forecast display using wttr.in API', version: '1.0.0', author: '@ai', collection: 'network', source: 'bundled', requiresNetwork: true },
  { name: 'homeassistant', description: 'Home Assistant integration for smart home control', version: '1.0.0', author: '@ai', collection: 'network', source: 'bundled', requiresNetwork: true },
  { name: 'fetch', description: 'Curl-like HTTP client with interactive REPL and command-line modes', version: '1.0.0', author: '@community', collection: 'network', source: 'example', requiresNetwork: true },
  { name: 'hackernews', description: 'Hacker News terminal browser with stories, comments, and tabs', version: '1.0.0', author: '@community', collection: 'network', source: 'example', requiresNetwork: true },
  { name: 'ipinfo', description: 'IP geolocation and network information viewer', version: '1.0.0', author: '@community', collection: 'network', source: 'example', requiresNetwork: true },
  { name: 'qrcode', description: 'QR code generator - create scannable QR codes from text input', version: '1.0.0', author: '@community', collection: 'network', source: 'example' },
  { name: 'rss', description: 'RSS/Atom feed reader with subscription management', version: '1.0.0', author: '@community', collection: 'network', source: 'example', requiresNetwork: true },
  { name: 'speedtest', description: 'Network speed test with download progress visualization', version: '1.0.0', author: '@community', collection: 'network', source: 'example', requiresNetwork: true },
  { name: 'whois', description: 'Domain lookup and DNS information tool', version: '1.0.0', author: '@community', collection: 'network', source: 'example', requiresNetwork: true },

  // ── Files (2) ───────────────────────────────────────────────
  { name: 'fm', description: 'Dual-panel file manager with copy, move, delete operations', version: '1.0.0', author: '@community', collection: 'files', source: 'example' },
  { name: 'csv', description: 'CSV/TSV viewer with column sorting and filtering', version: '1.0.0', author: '@community', collection: 'files', source: 'example' },

  // ── Enterprise: Free connectors (6) ─────────────────────────
  { name: 'slack-connector', description: 'Slack workspace integration - send messages, browse channels', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'free', requiresNetwork: true },
  { name: 'github-connector', description: 'GitHub repository integration - issues, PRs, and actions', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'free', requiresNetwork: true },
  { name: 'google-drive', description: 'Google Drive file access - browse, upload, and download', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'free', requiresNetwork: true },
  { name: 'discord-connector', description: 'Discord bot integration - manage servers and channels', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'free', requiresNetwork: true },
  { name: 'jira-connector', description: 'Jira issue tracking - view and manage sprints and tickets', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'free', requiresNetwork: true },
  { name: 'trello-connector', description: 'Trello board integration - manage cards and lists', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'free', requiresNetwork: true },

  // ── Enterprise: Pro connectors (10) ─────────────────────────
  { name: 'aws-console', description: 'AWS service management - EC2, S3, Lambda dashboards', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'azure-portal', description: 'Azure cloud management - resources and monitoring', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'gcp-console', description: 'Google Cloud management - compute, storage, and networking', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'datadog-monitor', description: 'Datadog monitoring integration - metrics and alerts', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'pagerduty', description: 'PagerDuty incident management - on-call and escalations', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'salesforce', description: 'Salesforce CRM integration - contacts, leads, and deals', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'zendesk', description: 'Zendesk support ticket integration - manage customer issues', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'confluence', description: 'Confluence wiki integration - browse and edit pages', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'notion', description: 'Notion workspace integration - pages, databases, and tasks', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },
  { name: 'linear', description: 'Linear issue tracking - projects, cycles, and roadmaps', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'pro', requiresNetwork: true },

  // ── Enterprise: Enterprise features (6) ─────────────────────
  { name: 'sso-auth', description: 'SAML/SSO authentication for team single sign-on', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'enterprise' },
  { name: 'audit-log', description: 'Compliance audit logging with export and retention policies', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'enterprise' },
  { name: 'team-sync', description: 'Team workspace synchronization across instances', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'enterprise' },
  { name: 'custom-branding', description: 'Custom terminal branding with logos and color schemes', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'enterprise' },
  { name: 'ldap-connect', description: 'LDAP/Active Directory integration for user management', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'enterprise', requiresNetwork: true },
  { name: 'vault', description: 'HashiCorp Vault secrets management integration', version: '0.1.0', author: '@tronos', collection: 'enterprise', source: 'enterprise', tier: 'enterprise', requiresNetwork: true },
];

/**
 * Tier hierarchy levels for authorization checks.
 * Higher level means more access: enterprise > pro > free
 */
const TIER_LEVEL: Record<string, number> = { free: 0, pro: 1, enterprise: 2 };

/**
 * Check if a user's tier is sufficient for a required package tier.
 * Higher tiers include access to all lower tiers.
 */
export function isTierAuthorized(userTier: string, requiredTier: string): boolean {
  return (TIER_LEVEL[userTier] ?? -1) >= (TIER_LEVEL[requiredTier] ?? 0);
}
