/**
 * @fileoverview Agent Runtime — manages persistent background agents.
 *
 * Agents are long-running background processes with goals, declared
 * permissions, and inspectable state. They run in the same JS
 * environment with permission-wrapped VFS access.
 *
 * @module agents/runtime
 */

import type { AgentPermissions, AgentViolation } from "./permissions";
import { canRead, canWrite, matchesGlob } from "./permissions";
import type { GuardQueue } from "./guard";
import { getGuardQueue } from "./guard";
import { getEventBus } from "../events/bus";
import { getNextRunTime } from "../engine/cron";
import type { InMemoryVFS } from "../vfs/memory";

/**
 * Agent status.
 */
export type AgentStatus =
  | "running"
  | "waiting"
  | "suspended"
  | "done"
  | "error";

/**
 * Error thrown when an agent operation is cancelled due to suspend/kill.
 */
export class AgentCancelledError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} was cancelled (suspended or killed)`);
    this.name = "AgentCancelledError";
  }
}

/**
 * Agent trigger configuration.
 */
export interface AgentTrigger {
  type: "interval" | "cron" | "file" | "context-change" | "manual";
  value?: string; // e.g. "5m", "0 9 * * *", "/home/user/inbox"
  intervalMs?: number; // resolved interval in ms
}

/**
 * A log entry for an agent action.
 */
export interface AgentLogEntry {
  ts: string;
  action: string;
  target?: string;
  result?: string;
  error?: string;
}

/**
 * An agent process.
 */
export interface AgentProcess {
  id: string;
  name: string;
  goal: string;
  permissions: AgentPermissions;
  escalate: "never" | "always" | "out-of-scope";
  status: AgentStatus;
  trigger: AgentTrigger;
  log: AgentLogEntry[];
  violations: AgentViolation[];
  pid: number;
  createdAt: Date;
  lastRunAt?: Date;
  /** The interval timer ID, if running on interval */
  _timerId?: ReturnType<typeof setInterval>;
  /** Event subscription ID, if file/context trigger */
  _eventSubId?: string;
  /** The execution function for this agent */
  _executor?: () => Promise<void>;
  /** True while an execution is in flight — prevents overlapping runs */
  _inflight?: boolean;
}

let agentCounter = 0;
let pidCounter = 100; // start at PID 100 for agents

/**
 * The AgentRuntime manages all agent processes.
 */
export class AgentRuntime {
  private agents: Map<string, AgentProcess> = new Map();

  /**
   * Start a new agent.
   */
  async start(
    name: string,
    goal: string,
    permissions: AgentPermissions,
    trigger: AgentTrigger,
    escalate: "never" | "always" | "out-of-scope" = "out-of-scope",
    executor?: () => Promise<void>,
  ): Promise<string> {
    const id = String(++agentCounter).padStart(3, "0");
    const pid = ++pidCounter;

    const agent: AgentProcess = {
      id,
      name,
      goal,
      permissions,
      escalate,
      status: "running",
      trigger,
      log: [],
      violations: [],
      pid,
      createdAt: new Date(),
      _executor: executor,
    };

    this.agents.set(id, agent);
    this.logAction(id, "started", undefined, `Goal: ${goal}`);

    // Set up trigger
    this.setupTrigger(agent);

    // Emit event
    getEventBus().emit({
      type: "agent-action",
      payload: { agent_id: id, action: "start", agent_name: name },
    });

    return id;
  }

  /**
   * Suspend an agent.
   */
  async suspend(id: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    if (agent.status === "suspended") return;

    getGuardQueue().rejectAllForAgent(id, new AgentCancelledError(id));
    this.clearTrigger(agent);
    agent.status = "suspended";
    this.logAction(id, "suspended");
  }

  /**
   * Resume a suspended agent.
   */
  async resume(id: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    if (agent.status !== "suspended") return;

    agent.status = "running";
    this.setupTrigger(agent);
    this.logAction(id, "resumed");
  }

  /**
   * Kill (permanently stop) an agent.
   */
  async kill(id: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);

    getGuardQueue().rejectAllForAgent(id, new AgentCancelledError(id));
    this.clearTrigger(agent);
    agent.status = "done";
    this.logAction(id, "killed");

    getEventBus().emit({
      type: "agent-action",
      payload: { agent_id: id, action: "kill", agent_name: agent.name },
    });
  }

  /**
   * Get an agent by ID.
   */
  getAgent(id: string): AgentProcess | undefined {
    return this.agents.get(id);
  }

  /**
   * Get an agent by PID.
   */
  getAgentByPid(pid: number): AgentProcess | undefined {
    for (const agent of this.agents.values()) {
      if (agent.pid === pid) return agent;
    }
    return undefined;
  }

  /**
   * Set or replace an agent's executor function.
   */
  setExecutor(id: string, executor: () => Promise<void>): void {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    agent._executor = executor;
  }

  /**
   * List all agents.
   */
  listAgents(): AgentProcess[] {
    return Array.from(this.agents.values());
  }

  /**
   * Execute an agent's run cycle.
   */
  async executeAgent(id: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent || agent.status !== "running") return;

    // Prevent overlapping runs — skip if a previous execution is still in flight
    if (agent._inflight) return;

    agent._inflight = true;
    agent.lastRunAt = new Date();

    try {
      if (agent._executor) {
        await agent._executor();
      }
      // Re-check liveness — agent may have been suspended/killed during execution
      const current = this.agents.get(id);
      if (
        !current ||
        current.status === "suspended" ||
        current.status === "done"
      )
        return;
      this.logAction(id, "executed");
    } catch (err) {
      if (err instanceof AgentCancelledError) return;
      const message = err instanceof Error ? err.message : String(err);
      agent.status = "error";
      this.logAction(id, "error", undefined, undefined, message);
    } finally {
      agent._inflight = false;
    }
  }

  /**
   * Check if an agent has permission for an operation.
   */
  checkPermission(
    agentId: string,
    operation: "read" | "write" | "mcp" | "network" | "spawn",
    path: string,
  ): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    let allowed = false;
    switch (operation) {
      case "read":
        allowed = canRead(agent.permissions, path);
        break;
      case "write":
        allowed = canWrite(agent.permissions, path);
        break;
      case "mcp":
        allowed = matchesGlob(path, agent.permissions.mcp);
        break;
      case "network":
        allowed = agent.permissions.network;
        break;
      case "spawn":
        allowed = agent.permissions.spawn;
        break;
    }

    if (!allowed) {
      const violation: AgentViolation = {
        ts: new Date().toISOString(),
        agentId,
        action: operation,
        target: path,
        message: `Permission denied: ${operation} ${path}`,
      };
      agent.violations.push(violation);
      this.logAction(
        agentId,
        "violation",
        path,
        undefined,
        `${operation} denied`,
      );
    }

    return allowed;
  }

  /**
   * Create a permission-scoped filesystem API for an agent.
   */
  createScopedFs(agentId: string, vfs: InMemoryVFS, guardQueue: GuardQueue) {
    const runtime = this;
    return {
      async read(path: string): Promise<string> {
        const fullPath = vfs.resolve(path);
        if (!runtime.checkPermission(agentId, "read", fullPath)) {
          throw new Error(`Agent not permitted to read ${fullPath}`);
        }
        return vfs.read(fullPath);
      },
      async write(path: string, data: string): Promise<void> {
        const fullPath = vfs.resolve(path);
        if (!runtime.checkPermission(agentId, "write", fullPath)) {
          // Route through guard queue
          const agent = runtime.getAgent(agentId);
          const approved = await guardQueue.request({
            agent_id: agentId,
            agent_name: agent?.name || agentId,
            action: "write",
            target: fullPath,
            data_preview: data.substring(0, 200),
            reason: "Write outside declared permissions",
          });
          if (!approved) {
            throw new Error(`Write to ${fullPath} rejected by guard`);
          }
          // Re-check agent liveness after awaiting guard approval
          const current = runtime.getAgent(agentId);
          if (
            !current ||
            current.status === "suspended" ||
            current.status === "done"
          ) {
            throw new AgentCancelledError(agentId);
          }
        }
        return vfs.write(fullPath, data);
      },
      async append(path: string, data: string): Promise<void> {
        const fullPath = vfs.resolve(path);
        if (!runtime.checkPermission(agentId, "write", fullPath)) {
          // Route through guard queue
          const agent = runtime.getAgent(agentId);
          const approved = await guardQueue.request({
            agent_id: agentId,
            agent_name: agent?.name || agentId,
            action: "write",
            target: fullPath,
            data_preview: data.substring(0, 200),
            reason: "Write outside declared permissions",
          });
          if (!approved) {
            throw new Error(`Write to ${fullPath} rejected by guard`);
          }
          // Re-check agent liveness after awaiting guard approval
          const current = runtime.getAgent(agentId);
          if (
            !current ||
            current.status === "suspended" ||
            current.status === "done"
          ) {
            throw new AgentCancelledError(agentId);
          }
        }
        return vfs.append(fullPath, data);
      },
      exists(path: string): boolean {
        const fullPath = vfs.resolve(path);
        if (!runtime.checkPermission(agentId, "read", fullPath)) {
          return false;
        }
        return vfs.exists(fullPath);
      },
      list(path: string): string[] {
        const resolvedPath = vfs.resolve(path);
        if (!runtime.checkPermission(agentId, "read", resolvedPath)) {
          throw new Error(`Agent not permitted to read ${resolvedPath}`);
        }
        const entries: string[] = vfs.list(resolvedPath);
        const agent = runtime.getAgent(agentId);
        return entries.filter((name: string) => {
          const entryPath =
            resolvedPath === "/" ? `/${name}` : `${resolvedPath}/${name}`;
          return agent ? canRead(agent.permissions, entryPath) : false;
        });
      },
      async readdir(
        path: string,
      ): Promise<Array<{ name: string; path: string; mtime: number }>> {
        const resolvedPath = vfs.resolve(path);
        if (!runtime.checkPermission(agentId, "read", resolvedPath)) {
          throw new Error(`Agent not permitted to read ${resolvedPath}`);
        }
        const entries = vfs.list(resolvedPath);
        const agent = runtime.getAgent(agentId);
        return entries
          .filter((name: string) => {
            const entryPath =
              resolvedPath === "/" ? `/${name}` : `${resolvedPath}/${name}`;
            return agent ? canRead(agent.permissions, entryPath) : false;
          })
          .map((name: string) => {
            const entryPath =
              resolvedPath === "/" ? `/${name}` : `${resolvedPath}/${name}`;
            const stat = vfs.stat(entryPath);
            return {
              name,
              path: entryPath,
              mtime: stat?.meta?.updatedAt || 0,
            };
          });
      },
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private logAction(
    agentId: string,
    action: string,
    target?: string,
    result?: string,
    error?: string,
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.log.push({
      ts: new Date().toISOString(),
      action,
      target,
      result,
      error,
    });
    // Trim log to 1000 entries
    if (agent.log.length > 1000) {
      agent.log = agent.log.slice(agent.log.length - 1000);
    }
  }

  private setupTrigger(agent: AgentProcess): void {
    if (agent.trigger.type === "interval" && agent.trigger.intervalMs) {
      agent._timerId = setInterval(() => {
        if (agent.status === "running") {
          this.executeAgent(agent.id).catch((err) => {
            console.warn(`Agent ${agent.id} execution error:`, err);
          });
        }
      }, agent.trigger.intervalMs);
    } else if (agent.trigger.type === "file" && agent.trigger.value) {
      const bus = getEventBus();
      agent._eventSubId = bus.subscribe(
        { type: "file-changed", path: agent.trigger.value },
        () => {
          if (agent.status === "running") {
            this.executeAgent(agent.id).catch((err) => {
              console.warn(`Agent ${agent.id} execution error:`, err);
            });
          }
        },
      );
    } else if (agent.trigger.type === "context-change") {
      const bus = getEventBus();
      agent._eventSubId = bus.subscribe({ type: "context-changed" }, () => {
        if (agent.status === "running") {
          this.executeAgent(agent.id).catch((err) => {
            console.warn(`Agent ${agent.id} execution error:`, err);
          });
        }
      });
    } else if (agent.trigger.type === "cron" && agent.trigger.value) {
      this.scheduleCronRun(agent);
    }
  }

  private scheduleCronRun(agent: AgentProcess): void {
    const nextRun = getNextRunTime(agent.trigger.value!);
    if (nextRun === null) return;

    const delay = Math.max(0, nextRun - Date.now());
    agent._timerId = setTimeout(() => {
      if (agent.status === "running") {
        this.executeAgent(agent.id)
          .catch((err) => {
            console.warn(`Agent ${agent.id} cron execution error:`, err);
          })
          .finally(() => {
            if (agent.status === "running") {
              this.scheduleCronRun(agent);
            }
          });
      }
    }, delay) as unknown as ReturnType<typeof setInterval>;
  }

  private clearTrigger(agent: AgentProcess): void {
    if (agent._timerId) {
      clearInterval(agent._timerId);
      agent._timerId = undefined;
    }
    if (agent._eventSubId) {
      getEventBus().unsubscribe(agent._eventSubId);
      agent._eventSubId = undefined;
    }
  }
}

/** Singleton */
let runtimeInstance: AgentRuntime | null = null;

/**
 * Get the global AgentRuntime singleton.
 */
export function getAgentRuntime(): AgentRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new AgentRuntime();
  }
  return runtimeInstance;
}

/**
 * Parse a trigger string from CLI/manifest.
 */
export function parseTrigger(value: string): AgentTrigger {
  value = value.trim();

  if (value === "@manual") {
    return { type: "manual" };
  }

  if (value === "@context-change") {
    return { type: "context-change" };
  }

  if (value.startsWith("@file ")) {
    return { type: "file", value: value.substring(6).trim() };
  }

  if (value.startsWith("@every ")) {
    const interval = value.substring(7).trim();
    return {
      type: "interval",
      value: interval,
      intervalMs: parseInterval(interval),
    };
  }

  if (value === "@daily") {
    return { type: "interval", value: "24h", intervalMs: 86400000 };
  }

  if (value === "@hourly") {
    return { type: "interval", value: "1h", intervalMs: 3600000 };
  }

  // Assume cron syntax
  return { type: "cron", value };
}

/**
 * Parse an interval string like "5m", "2h", "30s" to milliseconds.
 */
export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) return 300000; // default 5 minutes

  const num = parseInt(match[1]);
  switch (match[2]) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60000;
    case "h":
      return num * 3600000;
    case "d":
      return num * 86400000;
    default:
      return 300000;
  }
}
