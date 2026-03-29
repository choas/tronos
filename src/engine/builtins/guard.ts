/**
 * @fileoverview Guard builtin command for TronOS.
 *
 * Commands:
 *   guard list                    — show pending approvals
 *   guard approve <id>            — approve one request
 *   guard reject <id>             — reject one request
 *   guard approve-all             — approve all pending
 *   guard log                     — full approval history
 *   guard policy                  — show current policy
 *   guard policy set <agent> auto-approve-<action>  — add policy rule
 *
 * @module engine/builtins/guard
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from '../types';
import { getGuardQueue } from '../../agents/guard';

export const guard: BuiltinCommand = async (
  args: string[],
  context: ExecutionContext
): Promise<CommandResult> => {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'Usage: guard <list|approve|reject|approve-all|log|policy> [args...]\n',
      exitCode: 1,
    };
  }

  const subcommand = args[0];
  const queue = getGuardQueue();

  switch (subcommand) {
    case 'list': {
      const pending = queue.getPending();
      if (pending.length === 0) {
        return { stdout: 'No pending approval requests.\n', stderr: '', exitCode: 0 };
      }

      const lines = ['ID            AGENT            ACTION   TARGET'];
      for (const req of pending) {
        lines.push(
          `${req.id.padEnd(14)}${req.agent_name.padEnd(17)}${req.action.padEnd(9)}${req.target}`
        );
        if (req.reason) {
          lines.push(`  Reason: ${req.reason}`);
        }
      }
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    }

    case 'approve': {
      const id = args[1];
      if (!id) return { stdout: '', stderr: 'Usage: guard approve <id>\n', exitCode: 1 };
      const ok = queue.approve(id);
      return {
        stdout: ok ? `Approved ${id}\n` : '',
        stderr: ok ? '' : `Request not found: ${id}\n`,
        exitCode: ok ? 0 : 1,
      };
    }

    case 'reject': {
      const id = args[1];
      if (!id) return { stdout: '', stderr: 'Usage: guard reject <id>\n', exitCode: 1 };
      const ok = queue.reject(id);
      return {
        stdout: ok ? `Rejected ${id}\n` : '',
        stderr: ok ? '' : `Request not found: ${id}\n`,
        exitCode: ok ? 0 : 1,
      };
    }

    case 'approve-all': {
      const count = queue.approveAll();
      return {
        stdout: `Approved ${count} request(s).\n`,
        stderr: '',
        exitCode: 0,
      };
    }

    case 'log': {
      const log = queue.getLog();
      if (log.length === 0) {
        return { stdout: 'No approval history.\n', stderr: '', exitCode: 0 };
      }
      const lines = log.map(r => JSON.stringify(r));
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    }

    case 'policy': {
      if (args[1] === 'set' && args[2] && args[3]) {
        const agentName = args[2];
        const ruleStr = args[3];

        // Parse rule like "auto-approve-read" or "auto-approve-write"
        const match = ruleStr.match(/^auto-approve-(\w+)$/);
        if (!match) {
          return {
            stdout: '',
            stderr: 'Usage: guard policy set <agent> auto-approve-<action>\n' +
              'Actions: read, write, mcp, network\n',
            exitCode: 1,
          };
        }

        const pathPattern = args[4] || '**';
        queue.addAutoApprove(agentName, match[1], pathPattern);
        return {
          stdout: `Added auto-approve rule: ${agentName} can ${match[1]} ${pathPattern}\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      const policy = queue.getPolicy();
      return {
        stdout: JSON.stringify(policy, null, 2) + '\n',
        stderr: '',
        exitCode: 0,
      };
    }

    default:
      return { stdout: '', stderr: `guard: unknown subcommand: ${subcommand}\n`, exitCode: 1 };
  }
};
