/**
 * @fileoverview Event Bus for TronOS.
 *
 * Provides a publish-subscribe event system used by:
 * - VFS (file-changed events)
 * - Shell (context-changed events)
 * - MCP client (mcp-result events)
 * - Agent runtime (agent-action events)
 *
 * Events are accessible via /proc/events/ VFS paths.
 *
 * @module events/bus
 */

/**
 * Event types emitted by the system.
 */
export type OSEventType =
  | 'file-changed'
  | 'context-changed'
  | 'agent-action'
  | 'mcp-result'
  | 'session-start'
  | 'network-change';

/**
 * An event emitted by the OS event bus.
 */
export interface OSEvent {
  id: string;
  ts: string;
  type: OSEventType;
  payload: Record<string, unknown>;
}

/**
 * Pattern for matching events when subscribing.
 */
export interface EventPattern {
  type?: OSEventType;
  path?: string;       // for file-changed events, glob pattern
}

/**
 * Callback invoked when a matching event fires.
 */
export type EventCallback = (event: OSEvent) => void;

/**
 * A registered subscription.
 */
export interface EventSubscription {
  id: string;
  pattern: EventPattern;
  callback: EventCallback;
  /** Optional shell command to execute on trigger */
  command?: string;
}

const MAX_HISTORY = 1000;
let eventCounter = 0;

/**
 * The EventBus singleton.
 */
class EventBus {
  private subscribers: Map<string, EventSubscription> = new Map();
  private history: OSEvent[] = [];

  /**
   * Emit an event to all matching subscribers.
   */
  emit(event: Omit<OSEvent, 'id' | 'ts'>): OSEvent {
    const fullEvent: OSEvent = {
      id: `evt-${String(++eventCounter).padStart(6, '0')}`,
      ts: new Date().toISOString(),
      ...event,
    };

    this.history.push(fullEvent);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(this.history.length - MAX_HISTORY);
    }

    for (const sub of this.subscribers.values()) {
      if (this.matches(fullEvent, sub.pattern)) {
        try {
          sub.callback(fullEvent);
        } catch (err) {
          console.warn(`Event subscriber ${sub.id} error:`, err);
        }
      }
    }

    return fullEvent;
  }

  /**
   * Subscribe to events matching a pattern.
   * @returns subscription ID
   */
  subscribe(
    pattern: EventPattern,
    callback: EventCallback,
    command?: string
  ): string {
    const id = `sub-${String(++eventCounter).padStart(6, '0')}`;
    this.subscribers.set(id, { id, pattern, callback, command });
    return id;
  }

  /**
   * Unsubscribe by subscription ID.
   */
  unsubscribe(id: string): boolean {
    return this.subscribers.delete(id);
  }

  /**
   * Get event history.
   */
  getHistory(limit?: number): OSEvent[] {
    if (limit && limit < this.history.length) {
      return this.history.slice(this.history.length - limit);
    }
    return [...this.history];
  }

  /**
   * Get active subscriptions.
   */
  getSubscriptions(): EventSubscription[] {
    return Array.from(this.subscribers.values());
  }

  /**
   * Clear all subscriptions (for session cleanup).
   */
  clearSubscriptions(): void {
    this.subscribers.clear();
  }

  /**
   * Check if an event matches a subscription pattern.
   */
  private matches(event: OSEvent, pattern: EventPattern): boolean {
    if (pattern.type && pattern.type !== event.type) {
      return false;
    }
    if (pattern.path && event.type === 'file-changed') {
      const eventPath = event.payload.path as string;
      if (!eventPath) return false;
      return matchGlob(eventPath, pattern.path);
    }
    return true;
  }
}

/**
 * Simple glob matching for event path patterns.
 * Supports * (any segment) and ** (any depth).
 */
function matchGlob(path: string, pattern: string): boolean {
  // Exact match
  if (path === pattern) return true;

  // Convert glob to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLESTAR>>>/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(path);
}

/** Singleton instance */
let busInstance: EventBus | null = null;

/**
 * Get (or create) the global EventBus singleton.
 */
export function getEventBus(): EventBus {
  if (!busInstance) {
    busInstance = new EventBus();
  }
  return busInstance;
}

/**
 * Convenience: emit a file-changed event.
 */
export function emitFileChanged(
  path: string,
  operation: 'create' | 'write' | 'delete' | 'append'
): void {
  getEventBus().emit({
    type: 'file-changed',
    payload: { path, operation },
  });
}

/**
 * Convenience: emit a context-changed event.
 */
export function emitContextChanged(field: 'focus' | 'workspace'): void {
  getEventBus().emit({
    type: 'context-changed',
    payload: { field },
  });
}
