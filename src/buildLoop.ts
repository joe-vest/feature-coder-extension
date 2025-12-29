import * as vscode from "vscode";
import { Feature } from "./featureModel";
import { updateFeatureStatus, logToFeatureHistory } from "./workflowStatus";
import {
  runClaudeCodeWithProgress,
  generateSessionId,
  ensureClaudeCodeInstalled,
} from "./claudeCode";
import { getPrompt, applyTemplate, getReviewerProvider, ReviewerProvider } from "./config";
import { parsePlanPhases, Phase } from "./planParser";
import { getStagedDiff, isGitAvailable } from "./gitUtils";
import { reviewCode, mergeReviewFeedback, hasAnyMajorIssues, hasOnlyMinorIssues, CodeReviewResult } from "./codeReview";
import { ensureOpenAIConfigured } from "./openaiReview";
import { ensureClaudeReviewerConfigured } from "./claudeReview";

/**
 * Build configuration from VS Code settings
 */
interface BuildConfig {
  maxBuildIterations: number;
  buildReviewMode: "openai-only" | "architect-only" | "both";
  reviewerProvider: ReviewerProvider;
}

/**
 * Get build configuration from VS Code settings
 */
function getBuildConfig(): BuildConfig {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  return {
    maxBuildIterations: config.get<number>("maxBuildIterations", 5),
    buildReviewMode: config.get<"openai-only" | "architect-only" | "both">("buildReviewMode", "both"),
    reviewerProvider: getReviewerProvider(),
  };
}

/**
 * Ensure the configured reviewer provider is available
 */
async function ensureReviewerConfigured(provider: ReviewerProvider): Promise<boolean> {
  if (provider === "claude") {
    return ensureClaudeReviewerConfigured();
  }
  return ensureOpenAIConfigured();
}

/**
 * Get the display name for history logging
 */
function getReviewerLogSource(provider: ReviewerProvider): string {
  return provider === "claude" ? "claude-reviewer" : "openai";
}

/**
 * Get the build phase prompt for BUILDER
 */
async function getBuildPhasePrompt(
  featureId: string,
  planPath: string,
  phase: Phase
): Promise<string> {
  const template = await getPrompt("buildPhaseUser");
  return applyTemplate(template, {
    planPath,
    featureId,
    phaseNumber: String(phase.number),
    phaseDescription: phase.description,
  });
}

/**
 * Get the review incorporation prompt for BUILDER
 */
async function getBuildReviewIncorporationPrompt(
  phaseNumber: number,
  reviewContent: string
): Promise<string> {
  const template = await getPrompt("buildReviewIncorporation");
  return applyTemplate(template, {
    phaseNumber: String(phaseNumber),
    reviewContent,
  });
}

/**
 * Get the Claude REVIEWER code review prompt
 */
async function getClaudeReviewerPrompt(
  planPath: string,
  phaseNumber: number,
  diffSummary: string
): Promise<string> {
  const template = await getPrompt("claudeBuilderReviewUser");
  return applyTemplate(template, {
    planPath,
    phaseNumber: String(phaseNumber),
    diffSummary,
  });
}

/**
 * Extract intent summary from BUILDER's Claude Code output
 * BUILDER is asked to summarize what they changed at the end
 */
function extractIntentSummary(claudeOutput: string): string {
  // Try to find the last text block in the output
  // Claude Code outputs JSON lines; look for the last assistant message
  const lines = claudeOutput.split("\n").filter((l) => l.trim());

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const json = JSON.parse(lines[i]);
      if (json.type === "assistant" && json.message?.content) {
        const textContent = json.message.content.find(
          (c: { type: string; text?: string }) => c.type === "text"
        );
        if (textContent?.text) {
          return textContent.text;
        }
      }
    } catch {
      // Not JSON, ignore
    }
  }

  return "(No summary extracted from BUILDER output)";
}

/**
 * Parse the structured VERDICT block from REVIEWER's code review
 * Returns the action level (NONE, MINOR, MAJOR) or null if not found
 */
function parseReviewerVerdict(reviewText: string): {
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

  // Legacy fallback for older format: **Status: No Major Issues**
  if (/\*\*Status:\s*No Major Issues\*\*/i.test(reviewText)) {
    // Check if minor issues mentioned
    const hasMinor = /\*\*Status:\s*Minor Issues Only\*\*/i.test(reviewText);
    return {
      hasMajorIssues: false,
      hasMinorIssues: hasMinor,
    };
  }

  // If no structured verdict found, be conservative and assume no issues
  // (This prevents false positives from incidental word matches)
  // The absence of explicit issues is treated as approval
  return {
    hasMajorIssues: false,
    hasMinorIssues: false,
  };
}

/**
 * Run REVIEWER code review of BUILDER's implementation
 * Uses the provided session ID for continuity across reviews within a build
 */
async function runCodeReview(
  planPath: string,
  phaseNumber: number,
  diffSummary: string,
  workspaceRoot: string,
  reviewerSessionId: string,
  isFirstReview: boolean
): Promise<CodeReviewResult> {
  const prompt = await getClaudeReviewerPrompt(planPath, phaseNumber, diffSummary);

  const result = await runClaudeCodeWithProgress(
    prompt,
    workspaceRoot,
    `REVIEWER checking Phase ${phaseNumber}...`,
    reviewerSessionId,
    !isFirstReview // Resume if not first review
  );

  if (!result.success) {
    return {
      success: false,
      hasMajorIssues: true,
      hasMinorIssues: false,
      reviewContent: "",
      error: result.error,
    };
  }

  // Parse REVIEWER's response
  const reviewText = extractIntentSummary(result.output);

  // Parse the structured VERDICT block
  const { hasMajorIssues, hasMinorIssues } = parseReviewerVerdict(reviewText);

  return {
    success: true,
    hasMajorIssues,
    hasMinorIssues,
    reviewContent: reviewText,
  };
}

/**
 * Execute the build phase for a feature
 *
 * This is the main orchestration function that:
 * 1. Parses phases from the plan
 * 2. For each phase: BUILDER implements, then OpenAI/ARCHITECT reviews
 * 3. Loops until clean review or max iterations
 */
export async function executeBuildPhase(
  feature: Feature,
  workspaceRoot: string
): Promise<boolean> {
  // Get config first to know which reviewer to check
  const config = getBuildConfig();

  // Pre-flight checks
  if (!(await ensureClaudeCodeInstalled())) {
    return false;
  }

  // Only check reviewer config if we're using it (not architect-only mode)
  if (config.buildReviewMode !== "architect-only") {
    if (!(await ensureReviewerConfigured(config.reviewerProvider))) {
      return false;
    }
  }

  if (!(await isGitAvailable(workspaceRoot))) {
    vscode.window.showErrorMessage(
      "Git is not available in this workspace. Git is required for code review diff capture."
    );
    return false;
  }

  // Parse phases from plan
  if (!feature.planPath) {
    vscode.window.showErrorMessage("No plan found for this feature");
    return false;
  }

  let phases: Phase[];
  try {
    phases = await parsePlanPhases(feature.planPath);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to parse plan: ${err}`);
    return false;
  }

  if (phases.length === 0) {
    vscode.window.showWarningMessage(
      "No phases found in plan. Please ensure the plan has '## Phase N: Description' headers."
    );
    return false;
  }

  // Update status to building
  await updateFeatureStatus(
    feature.statusPath,
    "building",
    "system",
    `Starting build with ${phases.length} phase(s)`
  );

  // Create BUILDER session - persistent across all phases
  const builderSessionId = generateSessionId();

  // Create REVIEWER session - persistent across all code reviews for this feature
  // This gives REVIEWER continuity to remember prior reviews in this build
  const reviewerSessionId = generateSessionId();
  let isFirstReviewerCheck = true;

  // Build each phase
  for (const phase of phases) {
    await logToFeatureHistory(
      feature.statusPath,
      "system",
      `Starting Phase ${phase.number}: ${phase.description}`
    );

    // Initial build
    const buildPrompt = await getBuildPhasePrompt(
      feature.meta.id,
      feature.planPath,
      phase
    );

    let buildResult = await runClaudeCodeWithProgress(
      buildPrompt,
      workspaceRoot,
      `Building Phase ${phase.number}: ${phase.description}`,
      builderSessionId,
      phase.number > 1 // Resume for subsequent phases
    );

    if (!buildResult.success) {
      await logToFeatureHistory(
        feature.statusPath,
        "claude",
        `Build failed for Phase ${phase.number}: ${buildResult.error}`
      );
      vscode.window.showErrorMessage(
        `Build failed for Phase ${phase.number}: ${buildResult.error}`
      );
      return false;
    }

    await logToFeatureHistory(
      feature.statusPath,
      "claude",
      `BUILDER completed Phase ${phase.number} initial implementation`
    );

    // Review loop for this phase
    const reviewerLogSource = getReviewerLogSource(config.reviewerProvider);
    let minorIssuesIteration = false; // Track if we've done a minor-issues-only iteration

    for (let iteration = 1; iteration <= config.maxBuildIterations; iteration++) {
      // Get git diff for review
      const diffResult = await getStagedDiff(workspaceRoot);
      if (!diffResult.hasChanges) {
        await logToFeatureHistory(
          feature.statusPath,
          "system",
          `No changes detected for Phase ${phase.number}, skipping review`
        );
        break;
      }

      const intentSummary = extractIntentSummary(buildResult.output);

      // Generate review file path with phase and iteration numbers
      const reviewBasePath = feature.statusPath.replace(".status.md", "");
      const reviewPath = `${reviewBasePath}.code.review.p${phase.number}.i${iteration}.md`;

      // Primary code review (OpenAI or Claude based on config)
      let primaryReview: CodeReviewResult = {
        success: false,
        hasMajorIssues: false,
        hasMinorIssues: false,
        reviewContent: "",
      };

      if (config.buildReviewMode !== "architect-only") {
        primaryReview = await reviewCode(
          feature.specPath,
          feature.planPath,
          diffResult.diff,
          phase.number,
          intentSummary,
          reviewPath,
          config.reviewerProvider
        );

        if (primaryReview.success) {
          const status = primaryReview.hasMajorIssues
            ? "major issues found"
            : primaryReview.hasMinorIssues
              ? "minor issues only"
              : "approved";
          await logToFeatureHistory(
            feature.statusPath,
            reviewerLogSource,
            `Code review (iteration ${iteration}): ${status}`
          );
        } else {
          await logToFeatureHistory(
            feature.statusPath,
            reviewerLogSource,
            `Code review failed: ${primaryReview.error}`
          );
        }
      }

      // Claude REVIEWER code review (if configured)
      // Note: "openai-only" setting now means "primary reviewer only" (uses configured reviewerProvider)
      let claudeReview: CodeReviewResult | undefined;
      if (config.buildReviewMode !== "openai-only") {
        claudeReview = await runCodeReview(
          feature.planPath,
          phase.number,
          diffResult.diff,
          workspaceRoot,
          reviewerSessionId,
          isFirstReviewerCheck
        );
        isFirstReviewerCheck = false; // Subsequent reviews resume the session

        if (claudeReview.success) {
          const status = claudeReview.hasMajorIssues
            ? "major issues found"
            : claudeReview.hasMinorIssues
              ? "minor issues only"
              : "approved";
          await logToFeatureHistory(
            feature.statusPath,
            "claude-reviewer",
            `Code review (iteration ${iteration}): ${status}`
          );
        } else {
          await logToFeatureHistory(
            feature.statusPath,
            "claude-reviewer",
            `Code review failed: ${claudeReview.error}`
          );
        }
      }

      // Check if approved (no issues at all)
      const hasMajor = hasAnyMajorIssues(primaryReview, claudeReview);
      const hasOnlyMinor = hasOnlyMinorIssues(primaryReview, claudeReview);

      if (!hasMajor && !hasOnlyMinor) {
        // Fully approved - no major or minor issues
        await logToFeatureHistory(
          feature.statusPath,
          "system",
          `Phase ${phase.number} approved after ${iteration} iteration(s)`
        );
        break;
      }

      if (!hasMajor && hasOnlyMinor) {
        // Only minor issues - allow ONE iteration to address them
        if (minorIssuesIteration) {
          // We've already done a minor-issues-only iteration, don't loop forever
          await logToFeatureHistory(
            feature.statusPath,
            "system",
            `Phase ${phase.number} approved after ${iteration} iteration(s) (minor issues logged for human review)`
          );
          break;
        }
        minorIssuesIteration = true;
        await logToFeatureHistory(
          feature.statusPath,
          "system",
          `Minor issues only - one iteration to address (iteration ${iteration})`
        );
      }

      // Max iterations check
      if (iteration >= config.maxBuildIterations) {
        await logToFeatureHistory(
          feature.statusPath,
          "system",
          `Max iterations (${config.maxBuildIterations}) reached for Phase ${phase.number} with issues remaining`
        );
        vscode.window.showWarningMessage(
          `Phase ${phase.number} has unresolved issues after ${config.maxBuildIterations} iterations. Please review manually.`
        );
        break;
      }

      // Incorporate feedback
      const combinedFeedback = mergeReviewFeedback(primaryReview, claudeReview);
      const incorporationPrompt = await getBuildReviewIncorporationPrompt(
        phase.number,
        combinedFeedback
      );

      buildResult = await runClaudeCodeWithProgress(
        incorporationPrompt,
        workspaceRoot,
        `Addressing feedback (Phase ${phase.number}, iteration ${iteration + 1})...`,
        builderSessionId,
        true // Resume same session
      );

      if (!buildResult.success) {
        await logToFeatureHistory(
          feature.statusPath,
          "claude",
          `Failed to incorporate feedback: ${buildResult.error}`
        );
        vscode.window.showErrorMessage(
          `Failed to incorporate feedback for Phase ${phase.number}: ${buildResult.error}`
        );
        return false;
      }

      await logToFeatureHistory(
        feature.statusPath,
        "claude",
        `BUILDER addressed feedback (iteration ${iteration + 1})`
      );
    }
  }

  // All phases complete
  await updateFeatureStatus(
    feature.statusPath,
    "code-review",
    "system",
    `Build complete: ${phases.length} phase(s) implemented`
  );

  vscode.window.showInformationMessage(
    `Build complete for ${feature.meta.name}! ${phases.length} phase(s) implemented. Ready for final review and testing.`
  );

  return true;
}
