/**
 * @fileoverview GuardLayer — human approval queue for agent actions.
 *
 * Exposed via /dev/guard (write requests) and /proc/guard/ (read state).
 * When an agent attempts an action outside its declared permissions
 * or is configured with @escalate: always, the action routes through
 * the guard queue.
 *
 * @module agents/guard
 */

import { matchGlob } from "../utils/glob";

/**
 * A pending approval request.
 */
export interface GuardRequest {
  id: string;
  agent_id: string;
  agent_name: string;
  action: "read" | "write" | "mcp" | "network" | "spawn";
  target: string;
  data_preview?: string;
  reason?: string;
  requested_at: string;
  status: "pending" | "approved" | "rejected";
  resolved_at?: string;
}

/**
 * Auto-approve rule for a specific agent.
 */
export interface AutoApproveRule {
  action: string;
  path_pattern: string;
}

/**
 * Per-agent auto-approve policy.
 */
export interface GuardPolicy {
  [agentName: string]: {
    auto_approve: AutoApproveRule[];
  };
}

let requestCounter = 0;

/**
 * The GuardQueue manages pending approval requests.
 */
export class GuardQueue {
  private pending: Map<string, GuardRequest> = new Map();
  private log: GuardRequest[] = [];
  private policy: Map<string, { auto_approve: AutoApproveRule[] }> = new Map();
  private resolvers: Map<
    string,
    { resolve: (approved: boolean) => void; reject: (error: Error) => void }
  > = new Map();

  /**
   * Submit a request for approval.
   * Returns a promise that resolves when approved/rejected.
   */
  async request(
    req: Omit<GuardRequest, "id" | "requested_at" | "status">,
  ): Promise<boolean> {
    // Check auto-approve policy first
    if (this.isAutoApproved(req.agent_name, req.action, req.target)) {
      const fullReq: GuardRequest = {
        ...req,
        id: `guard-${String(++requestCounter).padStart(4, "0")}`,
        requested_at: new Date().toISOString(),
        status: "approved",
        resolved_at: new Date().toISOString(),
      };
      this.log.push(fullReq);
      return true;
    }

    const id = `guard-${String(++requestCounter).padStart(4, "0")}`;
    const fullReq: GuardRequest = {
      ...req,
      id,
      requested_at: new Date().toISOString(),
      status: "pending",
    };

    this.pending.set(id, fullReq);

    return new Promise<boolean>((resolve, reject) => {
      this.resolvers.set(id, { resolve, reject });
    });
  }

  /**
   * Approve a pending request.
   */
  approve(id: string): boolean {
    const req = this.pending.get(id);
    if (!req) return false;

    req.status = "approved";
    req.resolved_at = new Date().toISOString();
    this.log.push(req);
    this.pending.delete(id);

    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver.resolve(true);
      this.resolvers.delete(id);
    }

    return true;
  }

  /**
   * Reject a pending request.
   */
  reject(id: string): boolean {
    const req = this.pending.get(id);
    if (!req) return false;

    req.status = "rejected";
    req.resolved_at = new Date().toISOString();
    this.log.push(req);
    this.pending.delete(id);

    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver.resolve(false);
      this.resolvers.delete(id);
    }

    return true;
  }

  /**
   * Approve all pending requests.
   */
  approveAll(): number {
    let count = 0;
    for (const id of Array.from(this.pending.keys())) {
      if (this.approve(id)) count++;
    }
    return count;
  }

  /**
   * Reject all pending requests for a specific agent with an error.
   * The returned promise from request() will reject with the given error.
   */
  rejectAllForAgent(agentId: string, error: Error): number {
    let count = 0;
    for (const [id, req] of Array.from(this.pending.entries())) {
      if (req.agent_id === agentId) {
        req.status = "rejected";
        req.resolved_at = new Date().toISOString();
        this.log.push(req);
        this.pending.delete(id);

        const resolver = this.resolvers.get(id);
        if (resolver) {
          resolver.reject(error);
          this.resolvers.delete(id);
        }
        count++;
      }
    }
    return count;
  }

  /**
   * Get all pending requests.
   */
  getPending(): GuardRequest[] {
    return Array.from(this.pending.values());
  }

  /**
   * Get the full approval log.
   */
  getLog(): GuardRequest[] {
    return [...this.log];
  }

  /**
   * Get the current policy.
   */
  getPolicy(): GuardPolicy {
    const result: GuardPolicy = Object.create(null) as GuardPolicy;
    this.policy.forEach((entry, name) => {
      result[name] = { auto_approve: [...entry.auto_approve] };
    });
    return result;
  }

  /**
   * Set the policy.
   */
  setPolicy(policy: GuardPolicy): void {
    this.policy = new Map();
    for (const name of Object.keys(policy)) {
      this.policy.set(name, { auto_approve: [...policy[name].auto_approve] });
    }
  }

  /**
   * Add an auto-approve rule for an agent.
   */
  addAutoApprove(agentName: string, action: string, pathPattern: string): void {
    let entry = this.policy.get(agentName);
    if (!entry) {
      entry = { auto_approve: [] };
      this.policy.set(agentName, entry);
    }
    entry.auto_approve.push({ action, path_pattern: pathPattern });
  }

  /**
   * Check if an action is auto-approved by policy.
   */
  private isAutoApproved(
    agentName: string,
    action: string,
    target: string,
  ): boolean {
    const agentPolicy = this.policy.get(agentName);
    if (!agentPolicy) return false;

    for (const rule of agentPolicy.auto_approve) {
      if (rule.action === action || rule.action === "*") {
        if (rule.path_pattern === "*" || matchGlob(target, rule.path_pattern)) {
          return true;
        }
      }
    }
    return false;
  }
}

/** Singleton guard queue */
let guardInstance: GuardQueue | null = null;

/**
 * Get the global GuardQueue singleton.
 */
export function getGuardQueue(): GuardQueue {
  if (!guardInstance) {
    guardInstance = new GuardQueue();
  }
  return guardInstance;
}
