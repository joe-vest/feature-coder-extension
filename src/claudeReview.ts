import * as vscode from "vscode";
import * as fs from "fs/promises";
import {
  runClaudeCodeWithProgress,
  generateSessionId,
  ensureClaudeCodeInstalled,
} from "./claudeCode";
import { getPrompt, applyTemplate } from "./config";

/**
 * Result from a Claude Code review (same interface as OpenAI ReviewResult)
 */
export interface ReviewResult {
  success: boolean;
  hasMajorIssues: boolean;
  reviewContent: string;
  error?: string;
}

/**
 * Result from a Claude Code code review (same interface as OpenAI CodeReviewResult)
 */
export interface CodeReviewResult {
  success: boolean;
  hasMajorIssues: boolean;
  hasMinorIssues: boolean;
  reviewContent: string;
  error?: string;
}

/**
 * Parse the structured VERDICT block from a review
 * Returns the action level based on explicit markers
 */
function parseVerdictBlock(reviewText: string): {
  hasMajorIssues: boolean;
  hasMinorIssues: boolean;
} {
  // Look for the structured VERDICT block
  // Pattern: **Action Required**: [NONE | MINOR | MAJOR]
  const actionMatch = /\*\*Action Required\*\*:\s*(NONE|MINOR|MAJOR)/i.exec(reviewText);

  if (actionMatch) {
    const action = actionMatch[1].toUpperCase();
    return {
      hasMajorIssues: action === "MAJOR",
      hasMinorIssues: action === "MINOR",
    };
  }

  // Fallback: check for **Builder Must Fix**: NO (explicit approval)
  const builderMustFixMatch = /\*\*Builder Must Fix\*\*:\s*(YES|NO)/i.exec(reviewText);
  if (builderMustFixMatch && builderMustFixMatch[1].toUpperCase() === "NO") {
    return {
      hasMajorIssues: false,
      hasMinorIssues: false,
    };
  }

  // Legacy fallback: **Status: Major Issues Found** or **Status: No Major Issues**
  if (/\*\*Status:\s*Major Issues Found\*\*/i.test(reviewText)) {
    return {
      hasMajorIssues: true,
      hasMinorIssues: false,
    };
  }

  if (/\*\*Status:\s*No Major Issues\*\*/i.test(reviewText)) {
    // Check for minor issues status
    const hasMinor = /\*\*Status:\s*Minor Issues Only\*\*/i.test(reviewText);
    return {
      hasMajorIssues: false,
      hasMinorIssues: hasMinor,
    };
  }

  // If no structured verdict found, assume approval
  // This prevents false positives from incidental word matches
  return {
    hasMajorIssues: false,
    hasMinorIssues: false,
  };
}

/**
 * Parse Claude's review output to extract structured feedback
 * Claude's response should include a clear assessment of major/minor issues
 */
function parseClaudeReviewOutput(output: string): {
  hasMajorIssues: boolean;
  hasMinorIssues: boolean;
  content: string;
} {
  // Try to extract the last assistant text content from Claude Code's JSON output
  const lines = output.split("\n").filter((l) => l.trim());
  let reviewText = "";

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const json = JSON.parse(lines[i]);
      if (json.type === "assistant" && json.message?.content) {
        const textContent = json.message.content.find(
          (c: { type: string; text?: string }) => c.type === "text"
        );
        if (textContent?.text) {
          reviewText = textContent.text;
          break;
        }
      }
    } catch {
      // Not JSON, ignore
    }
  }

  if (!reviewText) {
    // Fallback: use raw output
    reviewText = output;
  }

  // Parse structured VERDICT block
  const { hasMajorIssues, hasMinorIssues } = parseVerdictBlock(reviewText);

  return {
    hasMajorIssues,
    hasMinorIssues,
    content: reviewText,
  };
}

/**
 * Get workspace root path
 */
async function getWorkspaceRoot(): Promise<string | undefined> {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Review a spec using Claude Code CLI
 * Uses a fresh session (REVIEWER persona) distinct from ARCHITECT
 */
export async function reviewSpecWithClaude(
  specPath: string,
  reviewOutputPath: string
): Promise<ReviewResult> {
  // Ensure Claude Code is installed
  if (!(await ensureClaudeCodeInstalled())) {
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: "Claude Code CLI is not installed",
    };
  }

  const workspaceRoot = await getWorkspaceRoot();
  if (!workspaceRoot) {
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: "No workspace folder open",
    };
  }

  try {
    // Generate a fresh session for the REVIEWER (not ARCHITECT)
    const reviewerSessionId = generateSessionId();

    const systemPrompt = await getPrompt("claudeSpecReviewSystem");
    const userPromptTemplate = await getPrompt("claudeSpecReviewUser");

    const userPrompt = applyTemplate(userPromptTemplate, {
      specPath,
    });

    // Combine system + user prompt for Claude Code CLI
    // Claude Code doesn't have a separate system prompt param, so we prepend it
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${userPrompt}`
      : userPrompt;

    const result = await runClaudeCodeWithProgress(
      fullPrompt,
      workspaceRoot,
      "Claude REVIEWER: Reviewing spec...",
      reviewerSessionId,
      false // Fresh session
    );

    if (!result.success) {
      return {
        success: false,
        hasMajorIssues: true,
        reviewContent: "",
        error: result.error || "Claude Code review failed",
      };
    }

    const { hasMajorIssues, content } = parseClaudeReviewOutput(result.output);

    // Write the review markdown file
    await fs.writeFile(reviewOutputPath, content, "utf8");

    return {
      success: true,
      hasMajorIssues,
      reviewContent: content,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: errorMessage,
    };
  }
}

/**
 * Review a plan using Claude Code CLI
 * Uses a fresh session (REVIEWER persona) distinct from ARCHITECT
 */
export async function reviewPlanWithClaude(
  planPath: string,
  reviewOutputPath: string
): Promise<ReviewResult> {
  // Ensure Claude Code is installed
  if (!(await ensureClaudeCodeInstalled())) {
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: "Claude Code CLI is not installed",
    };
  }

  const workspaceRoot = await getWorkspaceRoot();
  if (!workspaceRoot) {
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: "No workspace folder open",
    };
  }

  try {
    // Generate a fresh session for the REVIEWER
    const reviewerSessionId = generateSessionId();

    const systemPrompt = await getPrompt("claudePlanReviewSystem");
    const userPromptTemplate = await getPrompt("claudePlanReviewUser");

    const userPrompt = applyTemplate(userPromptTemplate, {
      planPath,
    });

    // Combine system + user prompt
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${userPrompt}`
      : userPrompt;

    const result = await runClaudeCodeWithProgress(
      fullPrompt,
      workspaceRoot,
      "Claude REVIEWER: Reviewing plan...",
      reviewerSessionId,
      false // Fresh session
    );

    if (!result.success) {
      return {
        success: false,
        hasMajorIssues: true,
        reviewContent: "",
        error: result.error || "Claude Code review failed",
      };
    }

    const { hasMajorIssues, content } = parseClaudeReviewOutput(result.output);

    // Write the review markdown file
    await fs.writeFile(reviewOutputPath, content, "utf8");

    return {
      success: true,
      hasMajorIssues,
      reviewContent: content,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: errorMessage,
    };
  }
}

/**
 * Review code changes using Claude Code CLI
 * Uses a fresh session (REVIEWER persona)
 *
 * @param specPath Path to the feature specification
 * @param planPath Path to the implementation plan
 * @param gitDiff Git diff of the changes to review
 * @param phaseNumber The phase number being reviewed
 * @param intentSummary BUILDER's summary of what they implemented
 * @param reviewOutputPath Where to write the review markdown
 */
export async function reviewCodeWithClaude(
  specPath: string,
  planPath: string,
  gitDiff: string,
  phaseNumber: number,
  intentSummary: string,
  reviewOutputPath: string
): Promise<CodeReviewResult> {
  // Ensure Claude Code is installed
  if (!(await ensureClaudeCodeInstalled())) {
    return {
      success: false,
      hasMajorIssues: true,
      hasMinorIssues: false,
      reviewContent: "",
      error: "Claude Code CLI is not installed",
    };
  }

  const workspaceRoot = await getWorkspaceRoot();
  if (!workspaceRoot) {
    return {
      success: false,
      hasMajorIssues: true,
      hasMinorIssues: false,
      reviewContent: "",
      error: "No workspace folder open",
    };
  }

  if (!gitDiff || gitDiff.trim().length === 0) {
    return {
      success: false,
      hasMajorIssues: true,
      hasMinorIssues: false,
      reviewContent: "",
      error: "No code changes to review",
    };
  }

  try {
    // Read spec and plan for context
    const specContent = await fs.readFile(specPath, "utf8");
    const planContent = await fs.readFile(planPath, "utf8");

    // Generate a fresh session for the REVIEWER
    const reviewerSessionId = generateSessionId();

    const systemPrompt = await getPrompt("claudeCodeReviewSystem");
    const userPromptTemplate = await getPrompt("claudeCodeReviewUser");

    const userPrompt = applyTemplate(userPromptTemplate, {
      specContent,
      planContent,
      phaseNumber: String(phaseNumber),
      gitDiff,
      intentSummary: intentSummary || "(No summary provided)",
    });

    // Combine system + user prompt
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${userPrompt}`
      : userPrompt;

    const result = await runClaudeCodeWithProgress(
      fullPrompt,
      workspaceRoot,
      `Claude REVIEWER: Reviewing code (Phase ${phaseNumber})...`,
      reviewerSessionId,
      false // Fresh session
    );

    if (!result.success) {
      return {
        success: false,
        hasMajorIssues: true,
        hasMinorIssues: false,
        reviewContent: "",
        error: result.error || "Claude Code review failed",
      };
    }

    const { hasMajorIssues, hasMinorIssues, content } = parseClaudeReviewOutput(result.output);

    // Write the review markdown file
    await fs.writeFile(reviewOutputPath, content, "utf8");

    return {
      success: true,
      hasMajorIssues,
      hasMinorIssues,
      reviewContent: content,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      hasMajorIssues: true,
      hasMinorIssues: false,
      reviewContent: "",
      error: errorMessage,
    };
  }
}

/**
 * Check if Claude Code is available for reviews
 */
export async function isClaudeReviewerConfigured(): Promise<boolean> {
  return ensureClaudeCodeInstalled();
}

/**
 * Ensure Claude Code is available for reviews (with user feedback)
 */
export async function ensureClaudeReviewerConfigured(): Promise<boolean> {
  return ensureClaudeCodeInstalled();
}
