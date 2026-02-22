import type { BuiltinCommand } from '../types';

/**
 * Feedback command - allows users to submit and view feedback.
 * Feedback is stored in the /feedback folder in the virtual filesystem.
 *
 * Usage:
 *   feedback <message>          - Submit feedback with the given message
 *   feedback list               - List all feedback entries
 *   feedback show <id>          - Show a specific feedback entry
 *   feedback clear              - Clear all feedback
 */

const FEEDBACK_DIR = '/feedback';

/**
 * Generate a feedback ID from timestamp
 */
function generateFeedbackId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  return `feedback-${timestamp}`;
}

/**
 * Format a timestamp for display
 */
function formatTimestamp(filename: string): string {
  // Extract timestamp from filename like "feedback-2024-01-15_12-30-45-123"
  const match = filename.match(/feedback-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day, hour, min, sec] = match;
    return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
  }
  return filename;
}

export const feedback: BuiltinCommand = async (args, context) => {
  const { vfs } = context;

  if (!vfs) {
    return {
      stdout: '',
      stderr: 'feedback: virtual filesystem not available',
      exitCode: 1
    };
  }

  // Ensure feedback directory exists
  if (!vfs.exists(FEEDBACK_DIR)) {
    vfs.mkdir(FEEDBACK_DIR);
  }

  // No arguments - show usage
  if (args.length === 0) {
    return {
      stdout: `Usage: feedback <message>    Submit feedback
       feedback list          List all feedback entries
       feedback show <id>     Show a specific feedback entry
       feedback clear         Clear all feedback`,
      stderr: '',
      exitCode: 0
    };
  }

  const subcommand = args[0];

  // List all feedback
  if (subcommand === 'list') {
    const entries = vfs.list(FEEDBACK_DIR);
    const feedbackFiles = entries.filter((e: string) => e.startsWith('feedback-'));

    if (feedbackFiles.length === 0) {
      return {
        stdout: 'No feedback entries found.',
        stderr: '',
        exitCode: 0
      };
    }

    // Sort by name (which is timestamp-based) - newest first
    feedbackFiles.sort().reverse();

    const output: string[] = ['Feedback entries:'];
    output.push('');

    for (const file of feedbackFiles) {
      const timestamp = formatTimestamp(file);
      const id = file.replace('feedback-', '').substring(0, 10);
      output.push(`  ${id}  ${timestamp}`);
    }

    output.push('');
    output.push(`Total: ${feedbackFiles.length} entries`);
    output.push('Use "feedback show <id>" to view an entry.');

    return {
      stdout: output.join('\n'),
      stderr: '',
      exitCode: 0
    };
  }

  // Show a specific feedback entry
  if (subcommand === 'show') {
    if (args.length < 2) {
      return {
        stdout: '',
        stderr: 'feedback show: missing feedback ID\nUsage: feedback show <id>',
        exitCode: 1
      };
    }

    const searchId = args[1];
    const entries = vfs.list(FEEDBACK_DIR);
    const feedbackFiles = entries.filter((e: string) => e.startsWith('feedback-'));

    // Find matching file (partial ID match)
    const matchingFile = feedbackFiles.find((f: string) =>
      f.includes(searchId) || f.replace('feedback-', '').startsWith(searchId)
    );

    if (!matchingFile) {
      return {
        stdout: '',
        stderr: `feedback show: no feedback found matching '${searchId}'`,
        exitCode: 1
      };
    }

    const filePath = `${FEEDBACK_DIR}/${matchingFile}`;
    const content = vfs.read(filePath) as string;
    const timestamp = formatTimestamp(matchingFile);

    const output: string[] = [
      `Feedback from ${timestamp}`,
      '─'.repeat(40),
      content,
      '─'.repeat(40)
    ];

    return {
      stdout: output.join('\n'),
      stderr: '',
      exitCode: 0
    };
  }

  // Clear all feedback
  if (subcommand === 'clear') {
    const entries = vfs.list(FEEDBACK_DIR);
    const feedbackFiles = entries.filter((e: string) => e.startsWith('feedback-'));

    if (feedbackFiles.length === 0) {
      return {
        stdout: 'No feedback entries to clear.',
        stderr: '',
        exitCode: 0
      };
    }

    let cleared = 0;
    for (const file of feedbackFiles) {
      const filePath = `${FEEDBACK_DIR}/${file}`;
      vfs.remove(filePath);
      cleared++;
    }

    return {
      stdout: `Cleared ${cleared} feedback entries.`,
      stderr: '',
      exitCode: 0
    };
  }

  // Submit feedback - all remaining args are the message
  const message = args.join(' ');

  if (message.trim().length === 0) {
    return {
      stdout: '',
      stderr: 'feedback: message cannot be empty',
      exitCode: 1
    };
  }

  const feedbackId = generateFeedbackId();
  const filePath = `${FEEDBACK_DIR}/${feedbackId}`;

  // Create feedback content with metadata
  const content = [
    message.trim()
  ].join('\n');

  vfs.write(filePath, content);

  // Send feedback to backend API (fire-and-forget, don't block on failure)
  const feedbackURL = import.meta.env.VITE_TRONOS_FEEDBACK_URL || "https://feedback.tronos.dev/api/feedback";
  try {
    fetch(feedbackURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.trim(),
        category: 'general',
      }),
    }).catch(() => {});
  } catch {
    // Silently ignore - local storage is the primary record
  }

  return {
    stdout: `Thank you for your feedback! (ID: ${feedbackId.replace('feedback-', '').substring(0, 10)})`,
    stderr: '',
    exitCode: 0
  };
};
