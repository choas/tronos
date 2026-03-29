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

/**
 * A pending approval request.
 */
export interface GuardRequest {
  id: string;
  agent_id: string;
  agent_name: string;
  action: 'read' | 'write' | 'mcp' | 'network' | 'spawn';
  target: string;
  data_preview?: string;
  reason?: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected';
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
  private policy: GuardPolicy = {};
  private resolvers: Map<string, (approved: boolean) => void> = new Map();

  /**
   * Submit a request for approval.
   * Returns a promise that resolves when approved/rejected.
   */
  async request(req: Omit<GuardRequest, 'id' | 'requested_at' | 'status'>): Promise<boolean> {
    // Check auto-approve policy first
    if (this.isAutoApproved(req.agent_name, req.action, req.target)) {
      const fullReq: GuardRequest = {
        ...req,
        id: `guard-${String(++requestCounter).padStart(4, '0')}`,
        requested_at: new Date().toISOString(),
        status: 'approved',
        resolved_at: new Date().toISOString(),
      };
      this.log.push(fullReq);
      return true;
    }

    const id = `guard-${String(++requestCounter).padStart(4, '0')}`;
    const fullReq: GuardRequest = {
      ...req,
      id,
      requested_at: new Date().toISOString(),
      status: 'pending',
    };

    this.pending.set(id, fullReq);

    return new Promise<boolean>((resolve) => {
      this.resolvers.set(id, resolve);
    });
  }

  /**
   * Approve a pending request.
   */
  approve(id: string): boolean {
    const req = this.pending.get(id);
    if (!req) return false;

    req.status = 'approved';
    req.resolved_at = new Date().toISOString();
    this.log.push(req);
    this.pending.delete(id);

    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver(true);
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

    req.status = 'rejected';
    req.resolved_at = new Date().toISOString();
    this.log.push(req);
    this.pending.delete(id);

    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver(false);
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
    return { ...this.policy };
  }

  /**
   * Set the policy.
   */
  setPolicy(policy: GuardPolicy): void {
    this.policy = policy;
  }

  /**
   * Add an auto-approve rule for an agent.
   */
  addAutoApprove(agentName: string, action: string, pathPattern: string): void {
    if (!this.policy[agentName]) {
      this.policy[agentName] = { auto_approve: [] };
    }
    this.policy[agentName].auto_approve.push({ action, path_pattern: pathPattern });
  }

  /**
   * Check if an action is auto-approved by policy.
   */
  private isAutoApproved(agentName: string, action: string, target: string): boolean {
    const agentPolicy = this.policy[agentName];
    if (!agentPolicy) return false;

    for (const rule of agentPolicy.auto_approve) {
      if (rule.action === action || rule.action === '*') {
        if (this.matchGlob(target, rule.path_pattern)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Simple glob matching.
   */
  private matchGlob(path: string, pattern: string): boolean {
    if (path === pattern) return true;
    if (pattern === '*') return true;

    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*');

    return new RegExp(`^${escaped}$`).test(path);
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
