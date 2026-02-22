/**
 * @fileoverview Cron job scheduler for TronOS.
 *
 * Provides cron-style job scheduling with:
 * - Standard cron syntax (min hour dom mon dow)
 * - Shorthands (@hourly, @daily, @weekly, @monthly, @yearly, @every Nm/Nh)
 * - Background execution via setInterval
 * - Execution history ring buffer
 * - IndexedDB persistence via the config store
 *
 * @module engine/cron
 */

import { getDB } from '../persistence/db';

/**
 * A scheduled cron job definition.
 */
export interface CronJob {
  id: string;
  schedule: string;
  command: string;
  enabled: boolean;
  label: string;
  lastRun: number | null;
  nextRun: number | null;
  lastResult: CronLogEntry | null;
}

/**
 * A log entry from a cron job execution.
 */
export interface CronLogEntry {
  jobId: string;
  timestamp: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Parsed cron schedule fields.
 */
interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

/**
 * Parse a single cron field (e.g., "1,5,10", step values, ranges, wildcards).
 *
 * @param field - The cron field string
 * @param min - Minimum value for this field
 * @param max - Maximum value for this field
 * @returns Set of matching integer values
 */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    // Handle step values: */N or M-N/S
    if (trimmed.includes('/')) {
      const [range, stepStr] = trimmed.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step: ${stepStr}`);

      let start = min;
      let end = max;
      if (range !== '*') {
        if (range.includes('-')) {
          const [s, e] = range.split('-').map(Number);
          start = s;
          end = e;
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
      continue;
    }

    // Handle ranges: M-N
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range: ${trimmed}`);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
      continue;
    }

    // Handle wildcard
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
      continue;
    }

    // Handle single value
    const val = parseInt(trimmed, 10);
    if (isNaN(val) || val < min || val > max) {
      throw new Error(`Invalid value '${trimmed}' (expected ${min}-${max})`);
    }
    values.add(val);
  }

  return values;
}

/**
 * Parse a cron schedule expression into its component fields.
 *
 * Supports:
 * - Standard 5-field format: min hour dom month dow
 * - Shorthands: @yearly, @monthly, @weekly, @daily, @hourly
 * - Interval shorthand: @every 5m, @every 2h
 *
 * @param schedule - The cron schedule string
 * @returns Parsed fields or null for @every intervals
 */
export function parseCronSchedule(schedule: string): { type: 'cron'; fields: CronFields } | { type: 'interval'; intervalMs: number } {
  const trimmed = schedule.trim();

  // Handle shorthands
  if (trimmed.startsWith('@')) {
    switch (trimmed) {
      case '@yearly':
      case '@annually':
        return { type: 'cron', fields: parseCronFields('0 0 1 1 *') };
      case '@monthly':
        return { type: 'cron', fields: parseCronFields('0 0 1 * *') };
      case '@weekly':
        return { type: 'cron', fields: parseCronFields('0 0 * * 0') };
      case '@daily':
      case '@midnight':
        return { type: 'cron', fields: parseCronFields('0 0 * * *') };
      case '@hourly':
        return { type: 'cron', fields: parseCronFields('0 * * * *') };
      default: {
        // Handle @every Nm or @every Nh
        const everyMatch = trimmed.match(/^@every\s+(\d+)([mh])$/);
        if (everyMatch) {
          const amount = parseInt(everyMatch[1], 10);
          const unit = everyMatch[2];
          const multiplier = unit === 'h' ? 60 * 60 * 1000 : 60 * 1000;
          return { type: 'interval', intervalMs: amount * multiplier };
        }
        throw new Error(`Unknown schedule shorthand: ${trimmed}`);
      }
    }
  }

  return { type: 'cron', fields: parseCronFields(trimmed) };
}

/**
 * Parse 5-field cron expression into CronFields.
 */
function parseCronFields(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6),
  };
}

/**
 * Validate a cron schedule string.
 *
 * @returns Error message if invalid, or null if valid
 */
export function validateSchedule(schedule: string): string | null {
  try {
    parseCronSchedule(schedule);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Check if a cron expression matches the given date (minute-level resolution).
 */
function cronMatchesDate(fields: CronFields, date: Date): boolean {
  return (
    fields.minutes.has(date.getMinutes()) &&
    fields.hours.has(date.getHours()) &&
    fields.daysOfMonth.has(date.getDate()) &&
    fields.months.has(date.getMonth() + 1) &&
    fields.daysOfWeek.has(date.getDay())
  );
}

/**
 * Calculate the next run time from now for a given schedule.
 */
export function getNextRunTime(schedule: string, fromTime?: number): number | null {
  try {
    const parsed = parseCronSchedule(schedule);
    const now = fromTime ?? Date.now();

    if (parsed.type === 'interval') {
      return now + parsed.intervalMs;
    }

    // Search forward minute-by-minute for the next match (max 2 years)
    const maxSearch = 2 * 365 * 24 * 60;
    const start = new Date(now);
    // Start from the next minute
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() + 1);

    for (let i = 0; i < maxSearch; i++) {
      const candidate = new Date(start.getTime() + i * 60_000);
      if (cronMatchesDate(parsed.fields, candidate)) {
        return candidate.getTime();
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Storage key prefix for IndexedDB config store
const CRON_JOBS_KEY = 'cron:jobs';
const CRON_LOG_KEY = 'cron:log';
const MAX_LOG_ENTRIES = 100;

/**
 * Load cron jobs from IndexedDB.
 */
export async function loadCronJobs(): Promise<CronJob[]> {
  try {
    const db = getDB();
    const jobs = await db.get('config', CRON_JOBS_KEY);
    return (jobs as CronJob[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * Save cron jobs to IndexedDB.
 */
export async function saveCronJobs(jobs: CronJob[]): Promise<void> {
  try {
    const db = getDB();
    await db.put('config', jobs, CRON_JOBS_KEY);
  } catch (err) {
    console.error('Failed to persist cron jobs:', err);
  }
}

/**
 * Load cron execution log from IndexedDB.
 */
export async function loadCronLog(): Promise<CronLogEntry[]> {
  try {
    const db = getDB();
    const log = await db.get('config', CRON_LOG_KEY);
    return (log as CronLogEntry[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * Save cron execution log to IndexedDB.
 */
export async function saveCronLog(log: CronLogEntry[]): Promise<void> {
  try {
    const db = getDB();
    // Keep only the last MAX_LOG_ENTRIES entries
    const trimmed = log.slice(-MAX_LOG_ENTRIES);
    await db.put('config', trimmed, CRON_LOG_KEY);
  } catch (err) {
    console.error('Failed to persist cron log:', err);
  }
}

/**
 * Type for the command executor function injected into the scheduler.
 */
export type CronCommandExecutor = (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Background cron job scheduler.
 *
 * Checks every 60 seconds for due jobs and executes them
 * via the shell's command executor.
 */
export class CronScheduler {
  private jobs: CronJob[] = [];
  private log: CronLogEntry[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private intervalJobs: Map<string, { lastRun: number; intervalMs: number }> = new Map();
  private executor: CronCommandExecutor | null = null;
  private _running = false;

  /**
   * Set the command executor used to run cron jobs.
   */
  public setExecutor(executor: CronCommandExecutor): void {
    this.executor = executor;
  }

  /**
   * Initialize by loading persisted state.
   */
  public async init(): Promise<void> {
    this.jobs = await loadCronJobs();
    this.log = await loadCronLog();

    // Initialize interval tracking for @every jobs
    for (const job of this.jobs) {
      if (job.enabled && job.schedule.startsWith('@every')) {
        try {
          const parsed = parseCronSchedule(job.schedule);
          if (parsed.type === 'interval') {
            this.intervalJobs.set(job.id, {
              lastRun: job.lastRun ?? Date.now(),
              intervalMs: parsed.intervalMs,
            });
          }
        } catch {
          // Skip invalid interval schedules
        }
      }
    }

    // Recalculate next run times
    for (const job of this.jobs) {
      if (job.enabled) {
        job.nextRun = getNextRunTime(job.schedule);
      }
    }
  }

  /**
   * Start the background scheduler (checks every 60s).
   */
  public start(): void {
    if (this._running) return;
    this._running = true;
    this.intervalId = setInterval(() => this.tick(), 60_000);
  }

  /**
   * Stop the background scheduler.
   */
  public stop(): void {
    this._running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public get running(): boolean {
    return this._running;
  }

  /**
   * Get all jobs.
   */
  public getJobs(): CronJob[] {
    return [...this.jobs];
  }

  /**
   * Get execution log, optionally filtered by job ID.
   */
  public getLog(jobId?: string): CronLogEntry[] {
    if (jobId) {
      return this.log.filter(e => e.jobId === jobId);
    }
    return [...this.log];
  }

  /**
   * Add a new cron job.
   */
  public async addJob(schedule: string, command: string, label?: string): Promise<CronJob> {
    const error = validateSchedule(schedule);
    if (error) {
      throw new Error(error);
    }

    const id = generateShortId();
    const job: CronJob = {
      id,
      schedule,
      command,
      enabled: true,
      label: label || command.slice(0, 40),
      lastRun: null,
      nextRun: getNextRunTime(schedule),
      lastResult: null,
    };

    this.jobs.push(job);

    // Track interval jobs
    try {
      const parsed = parseCronSchedule(schedule);
      if (parsed.type === 'interval') {
        this.intervalJobs.set(id, { lastRun: Date.now(), intervalMs: parsed.intervalMs });
      }
    } catch {
      // Already validated above
    }

    await saveCronJobs(this.jobs);
    return job;
  }

  /**
   * Remove a cron job by ID.
   */
  public async removeJob(id: string): Promise<boolean> {
    const idx = this.jobs.findIndex(j => j.id === id);
    if (idx === -1) return false;

    this.jobs.splice(idx, 1);
    this.intervalJobs.delete(id);
    await saveCronJobs(this.jobs);
    return true;
  }

  /**
   * Enable a job.
   */
  public async enableJob(id: string): Promise<boolean> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;

    job.enabled = true;
    job.nextRun = getNextRunTime(job.schedule);

    // Re-setup interval tracking if needed
    try {
      const parsed = parseCronSchedule(job.schedule);
      if (parsed.type === 'interval') {
        this.intervalJobs.set(id, { lastRun: Date.now(), intervalMs: parsed.intervalMs });
      }
    } catch { /* skip */ }

    await saveCronJobs(this.jobs);
    return true;
  }

  /**
   * Disable a job.
   */
  public async disableJob(id: string): Promise<boolean> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;

    job.enabled = false;
    job.nextRun = null;
    this.intervalJobs.delete(id);
    await saveCronJobs(this.jobs);
    return true;
  }

  /**
   * Update a job's schedule and/or command.
   */
  public async editJob(id: string, updates: { schedule?: string; command?: string; label?: string }): Promise<boolean> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;

    if (updates.schedule !== undefined) {
      const error = validateSchedule(updates.schedule);
      if (error) throw new Error(error);
      job.schedule = updates.schedule;

      // Update interval tracking
      this.intervalJobs.delete(id);
      try {
        const parsed = parseCronSchedule(job.schedule);
        if (parsed.type === 'interval') {
          this.intervalJobs.set(id, { lastRun: Date.now(), intervalMs: parsed.intervalMs });
        }
      } catch { /* skip */ }
    }

    if (updates.command !== undefined) {
      job.command = updates.command;
    }
    if (updates.label !== undefined) {
      job.label = updates.label;
    }

    job.nextRun = job.enabled ? getNextRunTime(job.schedule) : null;
    await saveCronJobs(this.jobs);
    return true;
  }

  /**
   * Get a job by ID.
   */
  public getJob(id: string): CronJob | undefined {
    return this.jobs.find(j => j.id === id);
  }

  /**
   * The periodic tick function: check and execute due jobs.
   */
  private async tick(): Promise<void> {
    if (!this.executor) return;

    const now = Date.now();
    const currentDate = new Date(now);

    for (const job of this.jobs) {
      if (!job.enabled) continue;

      let shouldRun = false;

      // Check interval-based jobs
      const interval = this.intervalJobs.get(job.id);
      if (interval) {
        if (now - interval.lastRun >= interval.intervalMs) {
          shouldRun = true;
        }
      } else {
        // Check cron-expression jobs
        try {
          const parsed = parseCronSchedule(job.schedule);
          if (parsed.type === 'cron' && cronMatchesDate(parsed.fields, currentDate)) {
            shouldRun = true;
          }
        } catch {
          // Skip jobs with invalid schedules
        }
      }

      if (shouldRun) {
        await this.executeJob(job, now);
      }
    }
  }

  /**
   * Execute a single job and record the result.
   */
  private async executeJob(job: CronJob, now: number): Promise<void> {
    if (!this.executor) return;

    try {
      const result = await this.executor(job.command);

      const entry: CronLogEntry = {
        jobId: job.id,
        timestamp: now,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 500), // Truncate for storage
        stderr: result.stderr.slice(0, 500),
      };

      job.lastRun = now;
      job.lastResult = entry;
      job.nextRun = getNextRunTime(job.schedule, now);

      // Update interval tracking
      const interval = this.intervalJobs.get(job.id);
      if (interval) {
        interval.lastRun = now;
      }

      this.log.push(entry);
      // Trim log
      if (this.log.length > MAX_LOG_ENTRIES) {
        this.log = this.log.slice(-MAX_LOG_ENTRIES);
      }

      // Persist both jobs and log
      await Promise.all([saveCronJobs(this.jobs), saveCronLog(this.log)]);
    } catch (err) {
      const entry: CronLogEntry = {
        jobId: job.id,
        timestamp: now,
        exitCode: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
      };

      job.lastRun = now;
      job.lastResult = entry;
      job.nextRun = getNextRunTime(job.schedule, now);

      this.log.push(entry);
      if (this.log.length > MAX_LOG_ENTRIES) {
        this.log = this.log.slice(-MAX_LOG_ENTRIES);
      }

      await Promise.all([saveCronJobs(this.jobs), saveCronLog(this.log)]);
    }
  }

  /**
   * Format jobs as crontab-style output (for /proc/cron/jobs).
   */
  public toCrontab(): string {
    if (this.jobs.length === 0) return '# no cron jobs\n';

    const lines: string[] = ['# TronOS crontab'];
    for (const job of this.jobs) {
      const status = job.enabled ? '' : '# [disabled] ';
      lines.push(`${status}${job.schedule} ${job.command}`);
    }
    return lines.join('\n') + '\n';
  }
}

/**
 * Generate a short human-friendly ID (6 hex chars).
 */
function generateShortId(): string {
  const arr = new Uint8Array(3);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Global scheduler instance (shared across the app)
let globalScheduler: CronScheduler | null = null;

/**
 * Get or create the global CronScheduler instance.
 */
export function getCronScheduler(): CronScheduler {
  if (!globalScheduler) {
    globalScheduler = new CronScheduler();
  }
  return globalScheduler;
}

/**
 * Reset the global scheduler (for testing or session cleanup).
 */
export function resetCronScheduler(): void {
  if (globalScheduler) {
    globalScheduler.stop();
    globalScheduler = null;
  }
}
