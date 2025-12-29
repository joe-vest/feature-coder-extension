import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Git utility functions for capturing code changes for review
 */

export interface GitDiffResult {
  diff: string;
  filesChanged: string[];
  hasChanges: boolean;
}

/**
 * Stage all changes and get the staged diff
 * Used to capture BUILDER's changes for code review
 */
export async function getStagedDiff(workspaceRoot: string): Promise<GitDiffResult> {
  try {
    // Stage all changes made by BUILDER
    await execAsync("git add -A", { cwd: workspaceRoot });

    // Get diff of staged changes
    const { stdout: diff } = await execAsync("git diff --staged", { cwd: workspaceRoot });

    // Get list of staged files
    const { stdout: filesOutput } = await execAsync(
      "git diff --staged --name-only",
      { cwd: workspaceRoot }
    );
    const filesChanged = filesOutput.trim().split("\n").filter(Boolean);

    return {
      diff: diff.trim(),
      filesChanged,
      hasChanges: diff.trim().length > 0,
    };
  } catch (err) {
    console.error("Error getting staged diff:", err);
    return {
      diff: "",
      filesChanged: [],
      hasChanges: false,
    };
  }
}

/**
 * Get unstaged diff (changes not yet staged)
 */
export async function getUnstagedDiff(workspaceRoot: string): Promise<GitDiffResult> {
  try {
    const { stdout: diff } = await execAsync("git diff", { cwd: workspaceRoot });
    const { stdout: filesOutput } = await execAsync("git diff --name-only", { cwd: workspaceRoot });
    const filesChanged = filesOutput.trim().split("\n").filter(Boolean);

    return {
      diff: diff.trim(),
      filesChanged,
      hasChanges: diff.trim().length > 0,
    };
  } catch (err) {
    console.error("Error getting unstaged diff:", err);
    return {
      diff: "",
      filesChanged: [],
      hasChanges: false,
    };
  }
}

/**
 * Get all changes (staged and unstaged) as a single diff
 */
export async function getAllChanges(workspaceRoot: string): Promise<GitDiffResult> {
  try {
    // Get both staged and unstaged changes
    const { stdout: diff } = await execAsync("git diff HEAD", { cwd: workspaceRoot });
    const { stdout: filesOutput } = await execAsync("git diff HEAD --name-only", { cwd: workspaceRoot });
    const filesChanged = filesOutput.trim().split("\n").filter(Boolean);

    return {
      diff: diff.trim(),
      filesChanged,
      hasChanges: diff.trim().length > 0,
    };
  } catch (err) {
    console.error("Error getting all changes:", err);
    return {
      diff: "",
      filesChanged: [],
      hasChanges: false,
    };
  }
}

/**
 * Create a summary of changes for display (truncated if too long)
 */
export function summarizeDiff(diff: string, maxLines: number = 100): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) {
    return diff;
  }

  const truncatedLines = lines.slice(0, maxLines);
  truncatedLines.push(`\n... (${lines.length - maxLines} more lines truncated)`);
  return truncatedLines.join("\n");
}

/**
 * Check if git is available in the workspace
 */
export async function isGitAvailable(workspaceRoot: string): Promise<boolean> {
  try {
    await execAsync("git rev-parse --git-dir", { cwd: workspaceRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(workspaceRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: workspaceRoot });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Commit all staged changes with a message
 * Used after successful build phase completion
 */
export async function commitChanges(
  workspaceRoot: string,
  message: string
): Promise<boolean> {
  try {
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: workspaceRoot });
    return true;
  } catch (err) {
    console.error("Error committing changes:", err);
    return false;
  }
}

/**
 * Discard all uncommitted changes
 * Used if build is rejected and user wants to start fresh
 */
export async function discardAllChanges(workspaceRoot: string): Promise<boolean> {
  try {
    await execAsync("git checkout -- .", { cwd: workspaceRoot });
    await execAsync("git clean -fd", { cwd: workspaceRoot });
    return true;
  } catch (err) {
    console.error("Error discarding changes:", err);
    return false;
  }
}
