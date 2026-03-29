/**
 * @fileoverview ps builtin — list running processes (agents + cron).
 *
 * @module engine/builtins/ps
 */

import type { BuiltinCommand, CommandResult, ExecutionContext } from '../types';
import { getAgentRuntime } from '../../agents/runtime';
import { getCronScheduler } from '../cron';

export const ps: BuiltinCommand = async (
  _args: string[],
  _context: ExecutionContext
): Promise<CommandResult> => {
  const lines = ['PID   TYPE    NAME                STATUS'];

  // Shell itself
  lines.push('1     shell   tronos-shell        running');

  // Cron scheduler
  const cron = getCronScheduler();
  const cronJobs = cron.getJobs?.() || [];
  if (cronJobs.length > 0) {
    lines.push('2     cron    cron-scheduler      running');
  }

  // Agents
  const agents = getAgentRuntime().listAgents();
  for (const agent of agents) {
    const statusColor = agent.status === 'running' ? '\x1b[32m' :
      agent.status === 'error' ? '\x1b[31m' :
      agent.status === 'suspended' ? '\x1b[33m' : '';
    const reset = statusColor ? '\x1b[0m' : '';
    lines.push(
      `${String(agent.pid).padEnd(6)}agent   ${agent.name.padEnd(20)}${statusColor}${agent.status}${reset}`
    );
  }

  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
};
