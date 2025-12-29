import * as vscode from "vscode";
import { spawn } from "child_process";

/**
 * Result from running tests
 */
export interface TestResult {
  passed: boolean;
  skipped: boolean;
  output: string;
  error?: string;
}

/**
 * Get the configured test command
 */
export function getTestCommand(): string {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  return config.get<string>("testCommand", "");
}

/**
 * Run tests for the feature
 *
 * If testCommand is configured, runs it automatically.
 * If not configured, prompts the user to run tests manually.
 */
export async function runTests(workspaceRoot: string): Promise<TestResult> {
  const testCommand = getTestCommand();

  if (!testCommand || testCommand.trim() === "") {
    // No test command configured - prompt user
    return promptUserForTestResult();
  }

  // Run the configured test command
  return executeTestCommand(testCommand, workspaceRoot);
}

/**
 * Prompt the user to run tests manually and report result
 */
async function promptUserForTestResult(): Promise<TestResult> {
  const result = await vscode.window.showInformationMessage(
    "No test command configured. Please run your tests manually and report the result.",
    { modal: true },
    "Tests Passed",
    "Tests Failed",
    "Skip Tests"
  );

  switch (result) {
    case "Tests Passed":
      return { passed: true, skipped: false, output: "User reported: tests passed" };
    case "Tests Failed":
      return { passed: false, skipped: false, output: "User reported: tests failed" };
    case "Skip Tests":
    default:
      return { passed: false, skipped: true, output: "Tests skipped by user" };
  }
}

/**
 * Execute the test command and capture output
 */
async function executeTestCommand(
  command: string,
  workspaceRoot: string
): Promise<TestResult> {
  return new Promise((resolve) => {
    const outputChannel = vscode.window.createOutputChannel("Feature Workflow Tests");
    outputChannel.show(true);
    outputChannel.appendLine(`Running: ${command}\n`);

    // Parse command into executable and args
    // Handle basic shell commands
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/sh";
    const shellFlag = isWindows ? "/c" : "-c";

    const proc = spawn(shell, [shellFlag, command], {
      cwd: workspaceRoot,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      outputChannel.append(text);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      outputChannel.append(text);
    });

    proc.on("close", (code) => {
      const passed = code === 0;
      const output = stdout + (stderr ? `\nStderr:\n${stderr}` : "");

      outputChannel.appendLine(`\n${"=".repeat(50)}`);
      outputChannel.appendLine(`Tests ${passed ? "PASSED" : "FAILED"} (exit code: ${code})`);

      if (passed) {
        vscode.window.showInformationMessage("Tests passed!");
      } else {
        vscode.window.showWarningMessage(
          `Tests failed with exit code ${code}. Check the output channel for details.`
        );
      }

      resolve({
        passed,
        skipped: false,
        output,
        error: passed ? undefined : `Exit code: ${code}`,
      });
    });

    proc.on("error", (err) => {
      const errorMessage = `Failed to run test command: ${err.message}`;
      outputChannel.appendLine(`\nError: ${errorMessage}`);

      vscode.window.showErrorMessage(errorMessage);

      resolve({
        passed: false,
        skipped: false,
        output: "",
        error: errorMessage,
      });
    });

    // Set a timeout for the test command (5 minutes)
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      outputChannel.appendLine("\nTest command timed out after 5 minutes");

      resolve({
        passed: false,
        skipped: false,
        output: stdout + stderr,
        error: "Test command timed out",
      });
    }, 5 * 60 * 1000);

    proc.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Check if a test command is configured
 */
export function hasTestCommand(): boolean {
  const command = getTestCommand();
  return command !== undefined && command.trim() !== "";
}
