import type { BuiltinCommand, CommandResult, ExecutionContext } from "../types";
import type { ConversationMessage } from "../../types";
import type { Message } from "../ai";
import {
  parseAICommand,
  validateAICommand,
  createAIBridge,
  type PromptContext,
} from "../ai";
import {
  getAIConfig,
  isAIConfigured,
  getConversationHistory,
  addConversationMessage,
  clearConversationHistory,
  hasAcceptedTerms,
  acceptTerms,
} from "../../stores";
import { TERMS_CONTENT, TERMS_VERSION } from "../terms-content";
import { saveVersion } from "../../persistence/versions";

/**
 * @ai builtin command
 *
 * Handles AI-powered operations:
 * - @ai create <name> <description> - Generate a new .trx from description
 * - @ai edit <file> <instructions> - Modify an existing file
 * - @ai explain <file> - Explain code in a file
 * - @ai fix <file> [context] - Diagnose and fix issues
 * - @ai clear - Clear conversation history
 * - @ai reset - Alias for clear
 * - @ai <question> - Chat mode (default)
 */
export const ai: BuiltinCommand = async (
  args: string[],
  context: ExecutionContext
): Promise<CommandResult> => {
  // Handle clear/reset commands to clear conversation history
  if (args.length === 1 && (args[0] === "clear" || args[0] === "reset")) {
    clearConversationHistory();
    return {
      stdout: "Conversation history cleared.\n",
      stderr: "",
      exitCode: 0,
    };
  }

  // Handle accept-terms subcommand
  if (args.length === 1 && args[0] === "accept-terms") {
    const config = getAIConfig();
    if (config.provider !== "tronos") {
      return {
        stdout: "Terms acceptance is only required for the TronOS provider.\n" +
          `Your current provider is: ${config.provider}\n`,
        stderr: "",
        exitCode: 0,
      };
    }
    acceptTerms();
    return {
      stdout: `Terms & Conditions v${TERMS_VERSION} accepted.\nYou can now use @ai commands.\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  // Handle show-terms subcommand
  if (args.length === 1 && args[0] === "show-terms") {
    return {
      stdout: TERMS_CONTENT,
      stderr: "",
      exitCode: 0,
    };
  }

  // Reconstruct the full @ai command
  const fullCommand = "@ai " + args.join(" ");

  // Parse the AI command
  const parsed = parseAICommand(fullCommand);

  if (!parsed) {
    return {
      stdout: "",
      stderr: "Usage: @ai <question> or @ai <mode> [args...]\n" +
        "Modes: create, edit, explain, fix, chat (default)\n" +
        "       @ai clear - Clear conversation history\n" +
        "       @ai accept-terms - Accept Terms & Conditions (TronOS provider)\n" +
        "       @ai show-terms - Display Terms & Conditions\n",
      exitCode: 1,
    };
  }

  // Validate the command
  const validation = validateAICommand(parsed);
  if (!validation.valid) {
    return {
      stdout: "",
      stderr: validation.error + "\n",
      exitCode: 1,
    };
  }

  // Check if AI is configured
  if (!isAIConfigured()) {
    return {
      stdout: "",
      stderr: 'AI not configured. Run "config set apiKey <your-key>" to set your API key.\n',
      exitCode: 1,
    };
  }

  // Get AI configuration
  const config = getAIConfig();

  // Terms gate: require acceptance for TronOS provider
  if (config.provider === "tronos" && !hasAcceptedTerms()) {
    return {
      stdout: TERMS_CONTENT + "\n" +
        "You must accept the Terms & Conditions before using @ai with the TronOS provider.\n" +
        'Run: @ai accept-terms\n',
      stderr: "",
      exitCode: 1,
    };
  }
  const bridge = createAIBridge(config);

  // Build prompt context
  const promptContext: PromptContext = {
    cwd: context.vfs?.cwd() || "/",
    env: context.env,
    vfs: context.vfs,
  };

  // Handle modes that require file content
  if (parsed.mode === "edit" || parsed.mode === "explain" || parsed.mode === "fix") {
    if (!context.vfs) {
      return {
        stdout: "",
        stderr: "Filesystem not available\n",
        exitCode: 1,
      };
    }

    // Use resolveFilePath to find the file, including searching in /bin
    const targetPath = resolveFilePath(parsed.targetFile!, promptContext.cwd, context.vfs);

    // Check if file was found
    if (!targetPath) {
      return {
        stdout: "",
        stderr: `File not found: ${parsed.targetFile}\n`,
        exitCode: 1,
      };
    }

    // Read file content
    try {
      const content = await context.vfs.read(targetPath);
      promptContext.fileContent = content;
      promptContext.targetFile = targetPath;
    } catch (err) {
      return {
        stdout: "",
        stderr: `Error reading file: ${parsed.targetFile}\n`,
        exitCode: 1,
      };
    }
  }

  // Show thinking indicator via terminal
  if (context.terminal) {
    context.terminal.write("Thinking...");
  }

  // Get conversation history for chat mode (preserves context across messages)
  // Only include history for chat and explain modes (conversational modes)
  const shouldIncludeHistory = parsed.mode === "chat" || parsed.mode === "explain";
  const conversationHistory: Message[] = shouldIncludeHistory
    ? getConversationHistory().map((msg: ConversationMessage) => ({
        role: msg.role,
        content: msg.content,
      }))
    : [];

  // Build user message for history (include the prompt context)
  const userMessageForHistory = buildUserMessageForHistory(parsed.mode, parsed.prompt, parsed.targetFile);

  // Execute the AI request with conversation history
  const response = await bridge.execute(
    parsed.mode,
    parsed.prompt,
    promptContext,
    parsed.programName,
    conversationHistory
  );

  // Clear thinking indicator
  if (context.terminal) {
    context.terminal.write("\r\x1b[K"); // Carriage return + clear line
  }

  // Handle API error
  if (!response.success) {
    return {
      stdout: "",
      stderr: response.error || "AI request failed\n",
      exitCode: 1,
    };
  }

  // Parse the response based on mode
  const parsedResponse = bridge.parseResponse(response, parsed.mode);

  if (!parsedResponse.success) {
    return {
      stdout: "",
      stderr: parsedResponse.error || "Failed to parse AI response\n",
      exitCode: 1,
    };
  }

  // Store the conversation in history for chat/explain modes
  if (shouldIncludeHistory) {
    // Add user message
    addConversationMessage({
      role: "user",
      content: userMessageForHistory,
      timestamp: Date.now(),
      mode: parsed.mode,
    });

    // Add assistant response
    const assistantContent = parsedResponse.message || parsedResponse.code || response.content;
    addConversationMessage({
      role: "assistant",
      content: assistantContent,
      timestamp: Date.now(),
      mode: parsed.mode,
    });
  }

  // Handle the result based on mode
  switch (parsed.mode) {
    case "create":
      return await handleCreateMode(parsed.programName!, parsedResponse.code!, context);

    case "edit":
      return await handleEditMode(
        promptContext.targetFile!,
        parsedResponse.code!,
        context,
        parsed.prompt
      );

    case "fix":
      return await handleFixMode(
        promptContext.targetFile!,
        parsedResponse.code!,
        parsedResponse.message,
        context
      );

    case "explain":
    case "chat":
    default:
      return {
        stdout: (parsedResponse.message || parsedResponse.code || "") + "\n",
        stderr: "",
        exitCode: 0,
      };
  }
};

/**
 * Handle create mode - save generated code to .trx file
 * Saves the initial version for timewarp support.
 */
async function handleCreateMode(
  programName: string,
  code: string,
  context: ExecutionContext
): Promise<CommandResult> {
  if (!context.vfs) {
    return {
      stdout: "",
      stderr: "Filesystem not available\n",
      exitCode: 1,
    };
  }

  // Determine the output path
  // If programName already has an extension, use it; otherwise add .trx
  const filename = programName.includes(".")
    ? programName
    : `${programName}.trx`;

  // Save to /bin by default (standard location for executables)
  const outputPath = `/bin/${filename}`;

  try {
    // Ensure /bin directory exists
    if (!context.vfs.exists("/bin")) {
      context.vfs.mkdir("/bin");
    }

    // Write the generated code
    context.vfs.write(outputPath, code);

    // Get the filesystem namespace
    // @ts-ignore - accessing private property for namespace
    const namespace = context.vfs.namespace || "default";

    // Save the initial version for timewarp history
    // This ensures the original AI-generated code is preserved
    try {
      await saveVersion(namespace, outputPath, code, {
        message: "AI-generated initial version",
        author: "@ai",
      });
    } catch (versionErr) {
      // Version saving is non-critical, continue
      console.warn("Failed to save initial version:", versionErr);
    }

    return {
      stdout:
        `Created ${outputPath}\n\n` +
        `Run it with: ${filename.replace(".trx", "")}\n` +
        `Or: ${outputPath}\n` +
        `Tip: Use 'timewarp list ${outputPath}' to view version history.\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      stdout: "",
      stderr: `Failed to save executable: ${message}\n`,
      exitCode: 1,
    };
  }
}

/**
 * Handle edit mode - overwrite file with modified code
 * Saves the current version before overwriting for timewarp support.
 */
async function handleEditMode(
  targetPath: string,
  code: string,
  context: ExecutionContext,
  editDescription?: string
): Promise<CommandResult> {
  if (!context.vfs) {
    return {
      stdout: "",
      stderr: "Filesystem not available\n",
      exitCode: 1,
    };
  }

  try {
    // Get the filesystem namespace
    // @ts-ignore - accessing private property for namespace
    const namespace = context.vfs.namespace || "default";

    // Read current content and save as a version before overwriting
    if (context.vfs.exists(targetPath)) {
      try {
        const currentContent = await context.vfs.read(targetPath);
        await saveVersion(namespace, targetPath, currentContent, {
          message: editDescription || "Before AI edit",
          author: "@ai",
        });
      } catch (versionErr) {
        // Version saving is non-critical, continue with the edit
        console.warn("Failed to save version:", versionErr);
      }
    }

    // Write the new code
    context.vfs.write(targetPath, code);

    return {
      stdout: `Updated ${targetPath}\nTip: Use 'timewarp list ${targetPath}' to view version history.\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      stdout: "",
      stderr: `Failed to update file: ${message}\n`,
      exitCode: 1,
    };
  }
}

/**
 * Handle fix mode - display explanation and save fixed code
 * Saves the current version before overwriting for timewarp support.
 */
async function handleFixMode(
  targetPath: string,
  code: string,
  explanation: string | null,
  context: ExecutionContext
): Promise<CommandResult> {
  if (!context.vfs) {
    return {
      stdout: "",
      stderr: "Filesystem not available\n",
      exitCode: 1,
    };
  }

  try {
    // Get the filesystem namespace
    // @ts-ignore - accessing private property for namespace
    const namespace = context.vfs.namespace || "default";

    // Read current content and save as a version before overwriting
    if (context.vfs.exists(targetPath)) {
      try {
        const currentContent = await context.vfs.read(targetPath);
        await saveVersion(namespace, targetPath, currentContent, {
          message: "Before AI fix",
          author: "@ai",
        });
      } catch (versionErr) {
        // Version saving is non-critical, continue with the fix
        console.warn("Failed to save version:", versionErr);
      }
    }

    // Write the fixed code
    context.vfs.write(targetPath, code);

    let output = "";
    if (explanation) {
      output += `\x1b[1mDiagnosis:\x1b[0m\n${explanation}\n\n`;
    }
    output += `Fixed ${targetPath}\n`;
    output += `Tip: Use 'timewarp list ${targetPath}' to view version history.\n`;

    return {
      stdout: output,
      stderr: "",
      exitCode: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      stdout: "",
      stderr: `Failed to save fixed file: ${message}\n`,
      exitCode: 1,
    };
  }
}

/**
 * Resolve a path relative to cwd if it's not absolute
 */
function resolvePath(path: string, cwd: string): string {
  if (path.startsWith("/")) {
    return path;
  }

  // Handle relative paths
  if (cwd === "/") {
    return "/" + path;
  }

  return cwd + "/" + path;
}

/**
 * Resolve a file path for @ai edit/explain/fix modes.
 *
 * Resolution order:
 * 1. If path starts with '/', use as absolute path
 * 2. If path starts with './' or '../', resolve relative to cwd
 * 3. First try to resolve relative to cwd (for backwards compatibility)
 * 4. If not found and path doesn't have a path separator, search in /bin:
 *    - Try /bin/{filename}.trx if no extension provided
 *    - Try /bin/{filename} with original extension
 *
 * This allows users to use "@ai edit countdown Add colors" instead of
 * "@ai edit /bin/countdown.trx Add colors"
 *
 * @param path - The file path provided by the user
 * @param cwd - Current working directory
 * @param vfs - Virtual filesystem for checking file existence
 * @returns Resolved absolute path to the file, or null if not found
 */
function resolveFilePath(path: string, cwd: string, vfs: any): string | null {
  // 1. Handle absolute paths
  if (path.startsWith("/")) {
    if (vfs.exists(path) && !vfs.isDirectory(path)) {
      return path;
    }
    return null;
  }

  // 2. Handle explicit relative paths (./ or ../)
  if (path.startsWith("./") || path.startsWith("../")) {
    const resolved = resolvePath(path, cwd);
    if (vfs.exists(resolved) && !vfs.isDirectory(resolved)) {
      return resolved;
    }
    return null;
  }

  // 3. First try relative to cwd (backwards compatibility)
  const cwdResolved = resolvePath(path, cwd);
  if (vfs.exists(cwdResolved) && !vfs.isDirectory(cwdResolved)) {
    return cwdResolved;
  }

  // 4. If path has no path separators, search in /bin
  if (!path.includes("/")) {
    // Try with .trx extension if not already present
    if (!path.endsWith(".trx")) {
      const exePath = `/bin/${path}.trx`;
      if (vfs.exists(exePath) && !vfs.isDirectory(exePath)) {
        return exePath;
      }
    }

    // Try the exact filename in /bin
    const binPath = `/bin/${path}`;
    if (vfs.exists(binPath) && !vfs.isDirectory(binPath)) {
      return binPath;
    }
  }

  return null;
}

/**
 * Build a user message for conversation history storage
 * This simplifies the prompt to just the user's intent for cleaner history
 */
function buildUserMessageForHistory(
  mode: string,
  prompt: string,
  targetFile?: string | null
): string {
  switch (mode) {
    case "explain":
      return targetFile ? `Explain ${targetFile}: ${prompt}` : prompt;
    case "chat":
    default:
      return prompt;
  }
}
