import * as vscode from "vscode";
import { spawn } from "child_process";
import * as crypto from "crypto";
import { getPrompt, applyTemplate } from "./config";
import * as logger from "./logger";

/**
 * Result of a Claude Code CLI invocation
 */
export interface ClaudeCodeResult {
  success: boolean;
  sessionId: string;
  output: string;
  error?: string;
}

/**
 * Generate a new UUID for a Claude Code session
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Check if Claude Code CLI is installed and available
 */
export async function isClaudeCodeInstalled(): Promise<boolean> {
  logger.debug("claudeCode", "Checking if Claude Code CLI is installed...");
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { shell: true });
    proc.on("error", (err) => {
      logger.error("claudeCode", "Claude Code CLI not found", err.message);
      resolve(false);
    });
    proc.on("close", (code) => {
      if (code === 0) {
        logger.info("claudeCode", "Claude Code CLI is available");
      } else {
        logger.warn("claudeCode", `Claude Code CLI check failed with code ${code}`);
      }
      resolve(code === 0);
    });
  });
}

/**
 * Show error message with install instructions if Claude Code is not installed
 */
export async function ensureClaudeCodeInstalled(): Promise<boolean> {
  const installed = await isClaudeCodeInstalled();
  if (!installed) {
    const action = await vscode.window.showErrorMessage(
      "Claude Code CLI is not installed or not in PATH. Please install it to use generation features.",
      "View Install Instructions"
    );
    if (action === "View Install Instructions") {
      vscode.env.openExternal(
        vscode.Uri.parse("https://docs.anthropic.com/en/docs/claude-code")
      );
    }
    return false;
  }
  return true;
}

/**
 * Run Claude Code CLI with a prompt
 *
 * @param prompt The prompt to send to Claude Code
 * @param workspaceRoot The workspace root directory
 * @param sessionId Session ID - if new session, use generateSessionId() first
 * @param isResume Whether this is resuming an existing session (true) or starting fresh (false)
 * @param onProgress Optional callback for progress updates
 * @returns Result of the Claude Code invocation
 */
export async function runClaudeCode(
  prompt: string,
  workspaceRoot: string,
  sessionId: string,
  isResume: boolean,
  onProgress?: (message: string) => void
): Promise<ClaudeCodeResult> {
  return new Promise((resolve) => {
    // Build args WITHOUT the prompt - we'll pass it via stdin to avoid shell escaping issues
    // Note: --verbose is required for stream-json output when using -p (print mode)
    // Note: --permission-mode bypassPermissions allows Claude to use tools without interactive prompts
    const args = [
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", "bypassPermissions",
    ];

    if (isResume) {
      // Resume an existing session
      args.push("--resume", sessionId);
    } else {
      // Start a new session with a specific ID
      args.push("--session-id", sessionId);
    }

    logger.info("claudeCode", `Spawning Claude Code CLI`, {
      sessionId,
      isResume,
      workspaceRoot,
      argsCount: args.length,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 200) + (prompt.length > 200 ? "..." : ""),
    });
    logger.debug("claudeCode", "Full command args (prompt will be passed via stdin)", args);

    const proc = spawn("claude", args, {
      cwd: workspaceRoot,
      shell: true,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const pid = proc.pid;
    logger.info("claudeCode", `Process spawned with PID: ${pid}`);

    // Write prompt to stdin and close it to signal end of input
    if (proc.stdin) {
      logger.debug("claudeCode", `[PID ${pid}] Writing prompt to stdin (${prompt.length} chars)`);
      proc.stdin.write(prompt);
      proc.stdin.end();
      logger.debug("claudeCode", `[PID ${pid}] Stdin closed`);
    } else {
      logger.error("claudeCode", `[PID ${pid}] No stdin available!`);
    }

    // Log if streams are available
    logger.debug("claudeCode", `[PID ${pid}] Stream status`, {
      hasStdout: !!proc.stdout,
      hasStderr: !!proc.stderr,
      hasStdin: !!proc.stdin,
    });

    // Set up a heartbeat to detect if process is still alive but not producing output
    const heartbeatInterval = setInterval(() => {
      logger.debug("claudeCode", `[PID ${pid}] Heartbeat - process still running, no new output`);
    }, 10000); // Log every 10 seconds if no activity

    let output = "";
    let error = "";
    let messageCount = 0;
    let toolUseCount = 0;

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      logger.debug("claudeCode", `[PID ${pid}] stdout chunk (${text.length} bytes)`);

      // Try to parse JSON lines for progress
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const json = JSON.parse(line);

          // Log every JSON message type for debugging
          const messagePreview = json.message?.content?.[0]?.text?.substring(0, 200)
            || (json.message ? JSON.stringify(json.message).substring(0, 200) : undefined);
          logger.debug("claudeCode", `[PID ${pid}] JSON message type: ${json.type}`, {
            type: json.type,
            subtype: json.subtype,
            hasMessage: !!json.message,
            hasName: !!json.name,
            messagePreview,
          });

          // Report progress for assistant messages
          if (json.type === "assistant" && json.message && onProgress) {
            messageCount++;
            // Extract text content from message
            const textContent = json.message.content?.find(
              (c: { type: string }) => c.type === "text"
            );
            if (textContent?.text) {
              const preview = textContent.text.substring(0, 100) + "...";
              logger.debug("claudeCode", `[PID ${pid}] Assistant message #${messageCount}`, preview);
              onProgress(preview);
            }
          }

          // Check for tool use (file writes, etc.)
          if (json.type === "tool_use" && onProgress) {
            toolUseCount++;
            const toolName = json.name || "unknown";
            logger.info("claudeCode", `[PID ${pid}] Tool use #${toolUseCount}: ${toolName}`, {
              tool: toolName,
              input: json.input ? JSON.stringify(json.input).substring(0, 200) : undefined,
            });
            onProgress(`Using tool: ${toolName}`);
          }

          // Log tool results
          if (json.type === "tool_result") {
            logger.debug("claudeCode", `[PID ${pid}] Tool result received`, {
              isError: json.is_error,
              contentLength: json.content?.length,
            });
          }

          // Log result messages
          if (json.type === "result") {
            logger.info("claudeCode", `[PID ${pid}] Result message`, {
              subtype: json.subtype,
              costUsd: json.cost_usd,
              durationMs: json.duration_ms,
              numTurns: json.num_turns,
            });
          }

          // Log system messages
          if (json.type === "system") {
            logger.info("claudeCode", `[PID ${pid}] System message`, json);
          }
        } catch {
          // Not JSON - log raw output for debugging
          if (line.trim()) {
            logger.debug("claudeCode", `[PID ${pid}] Non-JSON stdout: ${line.substring(0, 200)}`);
          }
        }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      error += text;
      logger.warn("claudeCode", `[PID ${pid}] stderr: ${text}`);
    });

    proc.on("error", (err) => {
      clearInterval(heartbeatInterval);
      logger.error("claudeCode", `[PID ${pid}] Process error`, err.message);
      resolve({
        success: false,
        sessionId,
        output,
        error: err.message,
      });
    });

    proc.on("close", (code) => {
      clearInterval(heartbeatInterval);
      logger.info("claudeCode", `[PID ${pid}] Process exited`, {
        exitCode: code,
        outputLength: output.length,
        errorLength: error.length,
        messageCount,
        toolUseCount,
      });

      if (code !== 0) {
        logger.error("claudeCode", `[PID ${pid}] Non-zero exit`, {
          code,
          error: error || "No error output",
        });
      }

      resolve({
        success: code === 0,
        sessionId,
        output,
        error: code !== 0 ? error || `Process exited with code ${code}` : undefined,
      });
    });
  });
}

/**
 * Run Claude Code with progress notification
 *
 * @param prompt The prompt to send
 * @param workspaceRoot Workspace directory
 * @param title Progress notification title
 * @param sessionId Session ID to use
 * @param isResume Whether resuming an existing session
 */
export async function runClaudeCodeWithProgress(
  prompt: string,
  workspaceRoot: string,
  title: string,
  sessionId: string,
  isResume: boolean
): Promise<ClaudeCodeResult> {
  logger.info("claudeCode", `Starting Claude Code with progress: "${title}"`, {
    sessionId,
    isResume,
  });
  logger.show(); // Auto-show the output channel when starting a Claude operation

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (progress, token) => {
      // Create a promise that resolves when cancelled
      let cancelRequested = false;
      token.onCancellationRequested(() => {
        logger.warn("claudeCode", "Cancellation requested by user");
        cancelRequested = true;
      });

      const result = await runClaudeCode(
        prompt,
        workspaceRoot,
        sessionId,
        isResume,
        (message) => {
          progress.report({ message });
        }
      );

      if (cancelRequested) {
        logger.warn("claudeCode", "Operation cancelled by user", {
          sessionId,
          outputLength: result.output.length,
        });
        return {
          success: false,
          sessionId,
          output: result.output,
          error: "Cancelled by user",
        };
      }

      logger.info("claudeCode", `Claude Code completed: "${title}"`, {
        success: result.success,
        error: result.error,
      });

      return result;
    }
  );
}

/**
 * Get the spec generation prompt for a feature
 */
export async function getSpecGenerationPrompt(
  featureId: string,
  requestPath: string
): Promise<string> {
  const template = await getPrompt("specGenerationUser");
  return applyTemplate(template, { featureId, requestPath });
}

/**
 * Get the review incorporation prompt
 */
export async function getReviewIncorporationPrompt(
  featureId: string,
  artifactType: "spec" | "plan",
  reviewContent: string
): Promise<string> {
  const artifactPath =
    artifactType === "spec"
      ? `docs/features/${featureId}.spec.md`
      : `docs/features/${featureId}.plan.md`;

  const template = await getPrompt("reviewIncorporation");
  return applyTemplate(template, { artifactType, reviewContent, artifactPath, featureId });
}

/**
 * Get the plan generation prompt for a feature
 */
export async function getPlanGenerationPrompt(
  featureId: string,
  specPath: string
): Promise<string> {
  const template = await getPrompt("planGenerationUser");
  return applyTemplate(template, { featureId, specPath });
}
