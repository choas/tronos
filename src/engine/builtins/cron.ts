/**
 * @fileoverview Cron builtin command for TronOS.
 *
 * Provides the `cron` command with subcommands:
 *   cron list                     - List all scheduled jobs
 *   cron add <schedule> <command> - Add a new cron job
 *   cron remove <id>              - Remove a job
 *   cron enable <id>              - Enable a disabled job
 *   cron disable <id>             - Disable a job
 *   cron log [id]                 - Show execution history
 *   cron edit <id>                - Edit a job interactively
 *   cron copy <id>                - Copy job definition to clipboard
 *   cron paste                    - Add/replace job from clipboard
 *
 * @module engine/builtins/cron
 */

import type { BuiltinCommand, CommandResult } from '../types';
import { getCronScheduler, validateSchedule } from '../cron';

/**
 * Format a timestamp for display.
 */
function formatTime(ts: number | null): string {
  if (ts === null) return '-';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Format a relative time from now.
 */
function formatRelative(ts: number | null): string {
  if (ts === null) return '-';
  const diff = ts - Date.now();
  if (diff < 0) return 'overdue';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

/**
 * The cron builtin command.
 */
export const cron: BuiltinCommand = async (args, context) => {
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    return {
      stdout: `cron - manage scheduled jobs

Usage:
  cron list                          List all jobs
  cron add <schedule> <command>      Add a new job
  cron remove <id>                   Remove a job
  cron enable <id>                   Enable a job
  cron disable <id>                  Disable a job
  cron log [id]                      Show execution history
  cron edit <id>                     Edit a job (prompts for new values)
  cron copy <id>                     Copy job definition to clipboard
  cron paste                         Add job from clipboard content

Schedule formats:
  Standard:   min hour dom mon dow   (e.g., */5 * * * *)
  Shorthands: @hourly @daily @weekly @monthly @yearly
  Intervals:  @every 5m   @every 2h

Examples:
  cron add '*/5 * * * *' 'echo hello'
  cron add '@hourly' 'cat /proc/system/uptime'
  cron add '@every 10m' 'version'
  cron list
  cron disable abc123
  cron log`,
      stderr: '',
      exitCode: 0,
    };
  }

  const scheduler = getCronScheduler();

  switch (sub) {
    case 'list':
    case 'ls':
      return handleList(scheduler);
    case 'add':
      return handleAdd(args.slice(1), scheduler);
    case 'remove':
    case 'rm':
    case 'delete':
    case 'del':
      return handleRemove(args[1], scheduler);
    case 'enable':
      return handleEnable(args[1], scheduler);
    case 'disable':
      return handleDisable(args[1], scheduler);
    case 'log':
    case 'history':
      return handleLog(args[1], scheduler);
    case 'edit':
      return handleEdit(args.slice(1), context, scheduler);
    case 'copy':
      return handleCopy(args[1], context, scheduler);
    case 'paste':
      return handlePaste(context, scheduler);
    default:
      return {
        stdout: '',
        stderr: `cron: unknown subcommand '${sub}'. Run 'cron --help' for usage.`,
        exitCode: 1,
      };
  }
};

/**
 * cron list - show all jobs in a table.
 */
function handleList(scheduler: ReturnType<typeof getCronScheduler>): CommandResult {
  const jobs = scheduler.getJobs();

  if (jobs.length === 0) {
    return { stdout: 'No cron jobs scheduled. Use "cron add" to create one.', stderr: '', exitCode: 0 };
  }

  // Build table
  const header = `ID      Enabled  Schedule             Command                       Next Run`;
  const sep =    `------  -------  -------------------  ----------------------------  ----------------`;
  const rows = jobs.map(j => {
    const id = j.id.padEnd(6);
    const enabled = (j.enabled ? 'yes' : 'no').padEnd(7);
    const schedule = j.schedule.padEnd(19);
    const command = j.command.length > 28 ? j.command.slice(0, 25) + '...' : j.command.padEnd(28);
    const next = formatRelative(j.nextRun);
    return `${id}  ${enabled}  ${schedule}  ${command}  ${next}`;
  });

  return { stdout: [header, sep, ...rows].join('\n'), stderr: '', exitCode: 0 };
}

/**
 * cron add - register a new job.
 * Supports quoting for the schedule with standard cron or shorthands.
 */
async function handleAdd(args: string[], scheduler: ReturnType<typeof getCronScheduler>): Promise<CommandResult> {
  if (args.length < 2) {
    return {
      stdout: '',
      stderr: `Usage: cron add <schedule> <command>\n\nExamples:\n  cron add '*/5 * * * *' echo hello\n  cron add @hourly 'cat /proc/system/uptime'`,
      exitCode: 1,
    };
  }

  // Determine if schedule is a shorthand (single token) or 5-field cron expression
  let schedule: string;
  let commandArgs: string[];

  if (args[0].startsWith('@')) {
    // Shorthand: @hourly, @daily, @every 5m
    if (args[0] === '@every' && args.length >= 3) {
      schedule = `@every ${args[1]}`;
      commandArgs = args.slice(2);
    } else {
      schedule = args[0];
      commandArgs = args.slice(1);
    }
  } else {
    // Try to parse as 5-field cron expression
    // The schedule could be quoted (already handled by shell parser as single arg)
    // or split across multiple args
    const possibleSchedule = args.slice(0, 5).join(' ');
    const validationError = validateSchedule(possibleSchedule);

    if (validationError === null && args.length > 5) {
      schedule = possibleSchedule;
      commandArgs = args.slice(5);
    } else {
      // Assume first arg is quoted schedule
      const singleValidation = validateSchedule(args[0]);
      if (singleValidation === null) {
        schedule = args[0];
        commandArgs = args.slice(1);
      } else {
        return {
          stdout: '',
          stderr: `cron: invalid schedule '${args[0]}': ${singleValidation}`,
          exitCode: 1,
        };
      }
    }
  }

  if (commandArgs.length === 0) {
    return { stdout: '', stderr: 'cron: no command specified', exitCode: 1 };
  }

  const command = commandArgs.join(' ');

  try {
    const job = await scheduler.addJob(schedule, command);
    const next = job.nextRun ? ` Next run: ${formatTime(job.nextRun)}` : '';
    return {
      stdout: `Added cron job ${job.id}: ${job.schedule} ${job.command}${next}`,
      stderr: '',
      exitCode: 0,
    };
  } catch (err) {
    return {
      stdout: '',
      stderr: `cron: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
    };
  }
}

/**
 * cron remove <id>
 */
async function handleRemove(id: string | undefined, scheduler: ReturnType<typeof getCronScheduler>): Promise<CommandResult> {
  if (!id) {
    return { stdout: '', stderr: 'Usage: cron remove <id>', exitCode: 1 };
  }

  const removed = await scheduler.removeJob(id);
  if (!removed) {
    return { stdout: '', stderr: `cron: job '${id}' not found`, exitCode: 1 };
  }

  return { stdout: `Removed cron job ${id}`, stderr: '', exitCode: 0 };
}

/**
 * cron enable <id>
 */
async function handleEnable(id: string | undefined, scheduler: ReturnType<typeof getCronScheduler>): Promise<CommandResult> {
  if (!id) {
    return { stdout: '', stderr: 'Usage: cron enable <id>', exitCode: 1 };
  }

  const success = await scheduler.enableJob(id);
  if (!success) {
    return { stdout: '', stderr: `cron: job '${id}' not found`, exitCode: 1 };
  }

  const job = scheduler.getJob(id);
  const next = job?.nextRun ? ` Next run: ${formatTime(job.nextRun)}` : '';
  return { stdout: `Enabled cron job ${id}${next}`, stderr: '', exitCode: 0 };
}

/**
 * cron disable <id>
 */
async function handleDisable(id: string | undefined, scheduler: ReturnType<typeof getCronScheduler>): Promise<CommandResult> {
  if (!id) {
    return { stdout: '', stderr: 'Usage: cron disable <id>', exitCode: 1 };
  }

  const success = await scheduler.disableJob(id);
  if (!success) {
    return { stdout: '', stderr: `cron: job '${id}' not found`, exitCode: 1 };
  }

  return { stdout: `Disabled cron job ${id}`, stderr: '', exitCode: 0 };
}

/**
 * cron log [id] - show execution history.
 */
function handleLog(id: string | undefined, scheduler: ReturnType<typeof getCronScheduler>): CommandResult {
  const entries = scheduler.getLog(id);

  if (entries.length === 0) {
    const suffix = id ? ` for job ${id}` : '';
    return { stdout: `No execution history${suffix}.`, stderr: '', exitCode: 0 };
  }

  const header = `Time                 Job     Exit  Output`;
  const sep =    `-------------------  ------  ----  ----------------------------`;
  const rows = entries.slice(-20).map(e => {
    const time = formatTime(e.timestamp);
    const jobId = e.jobId.padEnd(6);
    const exit = e.exitCode.toString().padEnd(4);
    const output = e.stdout
      ? e.stdout.trim().split('\n')[0].slice(0, 28)
      : (e.stderr ? `ERR: ${e.stderr.trim().split('\n')[0].slice(0, 23)}` : '-');
    return `${time}  ${jobId}  ${exit}  ${output}`;
  });

  return { stdout: [header, sep, ...rows].join('\n'), stderr: '', exitCode: 0 };
}

/**
 * cron edit <id> - edit a job with inline prompting.
 *
 * Falls back to separate prompts for schedule and command.
 */
async function handleEdit(
  args: string[],
  context: import('../types').ExecutionContext,
  scheduler: ReturnType<typeof getCronScheduler>
): Promise<CommandResult> {
  const id = args[0];
  if (!id) {
    return { stdout: '', stderr: 'Usage: cron edit <id>', exitCode: 1 };
  }

  const job = scheduler.getJob(id);
  if (!job) {
    return { stdout: '', stderr: `cron: job '${id}' not found`, exitCode: 1 };
  }

  // If additional args provided, use them directly: cron edit <id> <new-schedule> <new-command>
  if (args.length >= 3) {
    const newSchedule = args[1];
    const newCommand = args.slice(2).join(' ');

    const schedError = validateSchedule(newSchedule);
    if (schedError) {
      return { stdout: '', stderr: `cron: invalid schedule: ${schedError}`, exitCode: 1 };
    }

    await scheduler.editJob(id, { schedule: newSchedule, command: newCommand });
    return { stdout: `Updated cron job ${id}: ${newSchedule} ${newCommand}`, stderr: '', exitCode: 0 };
  }

  // Show current value and copy to clipboard for editing
  const currentDef = `${job.schedule} ${job.command}`;
  let output = `Current: ${currentDef}\n`;

  // Try to copy to clipboard
  if (context.vfs) {
    try {
      await context.vfs.write('/dev/clipboard', currentDef);
      output += 'Copied to clipboard. ';
    } catch {
      // Clipboard not available
    }
  }

  output += `\nTo update, run: cron edit ${id} <new-schedule> <new-command>`;
  output += `\nExample: cron edit ${id} '${job.schedule}' '${job.command}'`;

  return { stdout: output, stderr: '', exitCode: 0 };
}

/**
 * cron copy <id> - copy job definition to clipboard.
 */
async function handleCopy(
  id: string | undefined,
  context: import('../types').ExecutionContext,
  scheduler: ReturnType<typeof getCronScheduler>
): Promise<CommandResult> {
  if (!id) {
    return { stdout: '', stderr: 'Usage: cron copy <id>', exitCode: 1 };
  }

  const job = scheduler.getJob(id);
  if (!job) {
    return { stdout: '', stderr: `cron: job '${id}' not found`, exitCode: 1 };
  }

  const definition = `${job.schedule} ${job.command}`;

  if (context.vfs) {
    try {
      await context.vfs.write('/dev/clipboard', definition);
      return { stdout: `Copied to clipboard: ${definition}`, stderr: '', exitCode: 0 };
    } catch {
      return { stdout: definition, stderr: 'cron: clipboard not available, definition printed above', exitCode: 0 };
    }
  }

  return { stdout: definition, stderr: '', exitCode: 0 };
}

/**
 * cron paste - add a job from clipboard content.
 * Expected clipboard format: schedule followed by command.
 */
async function handlePaste(
  context: import('../types').ExecutionContext,
  scheduler: ReturnType<typeof getCronScheduler>
): Promise<CommandResult> {
  if (!context.vfs) {
    return { stdout: '', stderr: 'cron: filesystem not available', exitCode: 1 };
  }

  let clipboardContent: string;
  try {
    clipboardContent = await context.vfs.read('/dev/clipboard');
  } catch {
    return { stdout: '', stderr: 'cron: could not read clipboard', exitCode: 1 };
  }

  const trimmed = clipboardContent.trim();
  if (!trimmed) {
    return { stdout: '', stderr: 'cron: clipboard is empty', exitCode: 1 };
  }

  // Parse clipboard content to extract schedule and command
  let schedule: string;
  let command: string;

  if (trimmed.startsWith('@')) {
    const parts = trimmed.split(/\s+/);
    if (parts[0] === '@every' && parts.length >= 3) {
      schedule = `${parts[0]} ${parts[1]}`;
      command = parts.slice(2).join(' ');
    } else {
      schedule = parts[0];
      command = parts.slice(1).join(' ');
    }
  } else {
    // Try 5-field cron format
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 6) {
      schedule = parts.slice(0, 5).join(' ');
      command = parts.slice(5).join(' ');
    } else {
      return {
        stdout: '',
        stderr: `cron: could not parse clipboard content as schedule + command: "${trimmed}"`,
        exitCode: 1,
      };
    }
  }

  if (!command) {
    return { stdout: '', stderr: 'cron: no command found in clipboard content', exitCode: 1 };
  }

  const schedError = validateSchedule(schedule);
  if (schedError) {
    return { stdout: '', stderr: `cron: invalid schedule from clipboard: ${schedError}`, exitCode: 1 };
  }

  try {
    const job = await scheduler.addJob(schedule, command);
    return {
      stdout: `Added cron job ${job.id} from clipboard: ${schedule} ${command}`,
      stderr: '',
      exitCode: 0,
    };
  } catch (err) {
    return {
      stdout: '',
      stderr: `cron: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
    };
  }
}
