import * as vscode from "vscode";

/**
 * Centralized logging for the Feature Workflow extension.
 * Logs are written to a dedicated VS Code Output Channel.
 *
 * In normal mode, only INFO, WARN, and ERROR messages are shown.
 * In debug mode (featureWorkflow.debugMode = true), DEBUG messages are also shown.
 */

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Check if debug mode is enabled
 */
function isDebugMode(): boolean {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  return config.get<boolean>("debugMode", false);
}

/**
 * Initialize the logger. Call this from extension.activate().
 */
export function initLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Feature Workflow");
  }
  return outputChannel;
}

/**
 * Get the output channel (creates it if needed)
 */
function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Feature Workflow");
  }
  return outputChannel;
}

/**
 * Log levels for categorizing messages
 */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/**
 * Format a timestamp for log entries
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Core logging function
 */
function log(level: LogLevel, category: string, message: string, data?: unknown): void {
  const channel = getChannel();
  const prefix = `[${timestamp()}] [${level}] [${category}]`;

  if (data !== undefined) {
    const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    channel.appendLine(`${prefix} ${message}`);
    // Indent data for readability
    dataStr.split("\n").forEach(line => {
      channel.appendLine(`    ${line}`);
    });
  } else {
    channel.appendLine(`${prefix} ${message}`);
  }
}

/**
 * Debug level logging - verbose information for troubleshooting.
 * Only outputs when featureWorkflow.debugMode is enabled.
 */
export function debug(category: string, message: string, data?: unknown): void {
  if (!isDebugMode()) {
    return; // Skip debug messages in normal mode
  }
  log("DEBUG", category, message, data);
}

/**
 * Info level logging - normal operational messages
 */
export function info(category: string, message: string, data?: unknown): void {
  log("INFO", category, message, data);
}

/**
 * Warning level logging - potential issues
 */
export function warn(category: string, message: string, data?: unknown): void {
  log("WARN", category, message, data);
}

/**
 * Error level logging - failures and exceptions
 */
export function error(category: string, message: string, data?: unknown): void {
  log("ERROR", category, message, data);
}

/**
 * Show the output channel to the user
 */
export function show(): void {
  getChannel().show(true);
}

/**
 * Clear the output channel
 */
export function clear(): void {
  getChannel().clear();
}

/**
 * Dispose the output channel (call from extension.deactivate())
 */
export function dispose(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
