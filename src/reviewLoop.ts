import * as vscode from "vscode";
import { Feature } from "./featureModel";
import { updateFeatureStatus, logToFeatureHistory } from "./workflowStatus";
import {
  ensureClaudeCodeInstalled,
  runClaudeCodeWithProgress,
  getSpecGenerationPrompt,
  getPlanGenerationPrompt,
  getReviewIncorporationPrompt,
  generateSessionId,
} from "./claudeCode";
import {
  reviewSpec as reviewSpecOpenAI,
  reviewPlan as reviewPlanOpenAI,
  ensureOpenAIConfigured,
  ReviewResult,
} from "./openaiReview";
import {
  reviewSpecWithClaude,
  reviewPlanWithClaude,
  ensureClaudeReviewerConfigured,
} from "./claudeReview";
import { getReviewerProvider, ReviewerProvider } from "./config";
import * as logger from "./logger";

/**
 * Review a spec using the configured provider
 */
async function reviewSpec(
  specPath: string,
  reviewPath: string,
  provider: ReviewerProvider
): Promise<ReviewResult> {
  if (provider === "claude") {
    return reviewSpecWithClaude(specPath, reviewPath);
  }
  return reviewSpecOpenAI(specPath, reviewPath);
}

/**
 * Review a plan using the configured provider
 */
async function reviewPlan(
  planPath: string,
  reviewPath: string,
  provider: ReviewerProvider
): Promise<ReviewResult> {
  if (provider === "claude") {
    return reviewPlanWithClaude(planPath, reviewPath);
  }
  return reviewPlanOpenAI(planPath, reviewPath);
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
 * Configuration for the review loop
 */
interface ReviewLoopConfig {
  maxIterations: number;
  sessionTimeoutMs: number;
}

/**
 * Get review loop configuration from VS Code settings
 */
function getConfig(): ReviewLoopConfig {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  return {
    maxIterations: config.get<number>("maxReviewIterations", 3),
    sessionTimeoutMs: config.get<number>("sessionTimeoutMinutes", 10) * 60 * 1000,
  };
}

/**
 * Generate a spec with the Claude + reviewer loop
 */
export async function generateSpecWithReviewLoop(
  feature: Feature,
  workspaceRoot: string
): Promise<boolean> {
  logger.info("reviewLoop", "=== Starting generateSpecWithReviewLoop ===", {
    featureId: feature.meta.id,
    featureName: feature.meta.name,
    workspaceRoot,
  });

  // Ensure Claude Code is installed (for ARCHITECT)
  logger.debug("reviewLoop", "Checking Claude Code installation...");
  if (!(await ensureClaudeCodeInstalled())) {
    logger.error("reviewLoop", "Claude Code not installed, aborting");
    return false;
  }
  logger.debug("reviewLoop", "Claude Code is installed");

  // Get the configured reviewer provider
  const reviewerProvider = getReviewerProvider();
  logger.info("reviewLoop", `Using reviewer provider: ${reviewerProvider}`);

  // Ensure the reviewer provider is configured
  logger.debug("reviewLoop", "Checking reviewer configuration...");
  if (!(await ensureReviewerConfigured(reviewerProvider))) {
    logger.error("reviewLoop", "Reviewer provider not configured, aborting");
    return false;
  }
  logger.debug("reviewLoop", "Reviewer provider is configured");

  const config = getConfig();
  logger.debug("reviewLoop", "Review loop config", config);

  const featureId = feature.meta.id;
  const requestPath = feature.requestPath;
  const specPath = feature.specPath;
  const reviewPath = feature.specReviewPath;

  logger.debug("reviewLoop", "Feature paths", {
    featureId,
    requestPath,
    specPath,
    reviewPath,
    statusPath: feature.statusPath,
  });

  if (!requestPath) {
    logger.error("reviewLoop", "No request file found for this feature");
    vscode.window.showErrorMessage("No request file found for this feature");
    return false;
  }

  if (!specPath || !reviewPath) {
    logger.error("reviewLoop", "Spec paths not configured", { specPath, reviewPath });
    vscode.window.showErrorMessage("Spec paths not configured for this feature");
    return false;
  }

  // Log start
  await logToFeatureHistory(
    feature.statusPath,
    "system",
    "Starting spec generation"
  );

  // Initial spec generation - create a new session
  const sessionId = generateSessionId();
  logger.info("reviewLoop", "Generated new session ID", { sessionId });

  logger.debug("reviewLoop", "Getting spec generation prompt...");
  const initialPrompt = await getSpecGenerationPrompt(featureId, requestPath);
  logger.debug("reviewLoop", "Spec generation prompt ready", {
    promptLength: initialPrompt.length,
    promptPreview: initialPrompt.substring(0, 300),
  });

  logger.info("reviewLoop", "Starting initial spec generation via Claude Code...");
  let result = await runClaudeCodeWithProgress(
    initialPrompt,
    workspaceRoot,
    "Generating spec from request...",
    sessionId,
    false // New session, not a resume
  );

  logger.info("reviewLoop", "Initial spec generation completed", {
    success: result.success,
    error: result.error,
    outputLength: result.output.length,
  });

  if (!result.success) {
    logger.error("reviewLoop", "Spec generation failed", {
      error: result.error,
      output: result.output.substring(0, 500),
    });
    vscode.window.showErrorMessage(
      `Failed to generate spec: ${result.error || "Unknown error"}`
    );
    await logToFeatureHistory(
      feature.statusPath,
      "system",
      `Spec generation failed: ${result.error || "Unknown error"}`
    );
    return false;
  }

  await logToFeatureHistory(
    feature.statusPath,
    "claude",
    "Generated initial spec (iteration 1)"
  );
  logger.info("reviewLoop", "Initial spec generation successful, starting review loop");

  // Review loop
  const reviewerLogSource = getReviewerLogSource(reviewerProvider);

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    logger.info("reviewLoop", `=== Review iteration ${iteration}/${config.maxIterations} ===`);

    // Run review using configured provider
    logger.debug("reviewLoop", `Starting spec review with ${reviewerProvider}...`);
    const reviewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running spec review (${reviewerProvider}, iteration ${iteration})...`,
        cancellable: false,
      },
      async () => reviewSpec(specPath, reviewPath, reviewerProvider)
    );

    logger.info("reviewLoop", "Review completed", {
      success: reviewResult.success,
      hasMajorIssues: reviewResult.hasMajorIssues,
      error: reviewResult.error,
      reviewContentLength: reviewResult.reviewContent?.length,
    });

    if (!reviewResult.success) {
      logger.warn("reviewLoop", "Review failed, continuing without review", {
        error: reviewResult.error,
      });
      vscode.window.showWarningMessage(
        `Review failed: ${reviewResult.error}. Continuing without review.`
      );
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        `Review failed: ${reviewResult.error}`
      );
      break;
    }

    // Log review result
    const issueStatus = reviewResult.hasMajorIssues
      ? "has major issues"
      : "no major issues";
    await logToFeatureHistory(
      feature.statusPath,
      reviewerLogSource,
      `Spec review (iteration ${iteration}): ${issueStatus}`
    );

    // Check if we're done
    if (!reviewResult.hasMajorIssues) {
      logger.info("reviewLoop", "No major issues found, review loop complete");
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        "Spec review passed - no major issues"
      );
      break;
    }

    // Check if we've hit max iterations
    if (iteration >= config.maxIterations) {
      logger.warn("reviewLoop", "Max iterations reached with issues remaining");
      vscode.window.showWarningMessage(
        `Max review iterations (${config.maxIterations}) reached. Please review the spec manually.`
      );
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        `Max iterations reached with issues remaining`
      );
      break;
    }

    // Use the review content directly (it's already in reviewResult)
    const reviewContent = reviewResult.reviewContent;
    if (!reviewContent) {
      logger.warn("reviewLoop", "No review content available, breaking out of loop");
      vscode.window.showWarningMessage(
        "No review content available. Continuing without feedback."
      );
      break;
    }

    logger.debug("reviewLoop", "Getting review incorporation prompt...");
    const incorporatePrompt = await getReviewIncorporationPrompt(
      featureId,
      "spec",
      reviewContent
    );
    logger.debug("reviewLoop", "Incorporation prompt ready", {
      promptLength: incorporatePrompt.length,
    });

    logger.info("reviewLoop", `Starting revision (iteration ${iteration + 1})...`);
    result = await runClaudeCodeWithProgress(
      incorporatePrompt,
      workspaceRoot,
      `Addressing review feedback (iteration ${iteration + 1})...`,
      sessionId,
      true // Resume existing session
    );

    logger.info("reviewLoop", "Revision completed", {
      success: result.success,
      error: result.error,
    });

    if (!result.success) {
      logger.error("reviewLoop", "Failed to incorporate review", {
        error: result.error,
      });
      vscode.window.showErrorMessage(
        `Failed to incorporate review: ${result.error || "Unknown error"}`
      );
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        `Failed to incorporate review: ${result.error || "Unknown error"}`
      );
      break;
    }

    await logToFeatureHistory(
      feature.statusPath,
      "claude",
      `Addressed review feedback (iteration ${iteration + 1})`
    );
  }

  // Update status to draft
  logger.info("reviewLoop", "Updating feature status to 'draft'");
  await updateFeatureStatus(
    feature.statusPath,
    "draft",
    "system",
    "Spec generation complete"
  );

  logger.info("reviewLoop", "=== generateSpecWithReviewLoop completed successfully ===");
  vscode.window.showInformationMessage(
    `Spec generated for ${feature.meta.name}`
  );

  return true;
}

/**
 * Generate a plan with the Claude + reviewer loop
 */
export async function generatePlanWithReviewLoop(
  feature: Feature,
  workspaceRoot: string
): Promise<boolean> {
  // Ensure Claude Code is installed (for ARCHITECT)
  if (!(await ensureClaudeCodeInstalled())) {
    return false;
  }

  // Get the configured reviewer provider
  const reviewerProvider = getReviewerProvider();

  // Ensure the reviewer provider is configured
  if (!(await ensureReviewerConfigured(reviewerProvider))) {
    return false;
  }

  const config = getConfig();
  const featureId = feature.meta.id;
  const specPath = feature.specPath;
  const planPath = feature.planPath;
  const reviewPath = feature.planReviewPath;

  if (!specPath) {
    vscode.window.showErrorMessage("No spec file found for this feature");
    return false;
  }

  if (!planPath || !reviewPath) {
    vscode.window.showErrorMessage("Plan paths not configured for this feature");
    return false;
  }

  // Log start
  await logToFeatureHistory(
    feature.statusPath,
    "system",
    "Starting plan generation"
  );

  // Initial plan generation - create a new session
  const sessionId = generateSessionId();
  const initialPrompt = await getPlanGenerationPrompt(featureId, specPath);
  let result = await runClaudeCodeWithProgress(
    initialPrompt,
    workspaceRoot,
    "Generating implementation plan...",
    sessionId,
    false // New session, not a resume
  );

  if (!result.success) {
    vscode.window.showErrorMessage(
      `Failed to generate plan: ${result.error || "Unknown error"}`
    );
    await logToFeatureHistory(
      feature.statusPath,
      "system",
      `Plan generation failed: ${result.error || "Unknown error"}`
    );
    return false;
  }

  await logToFeatureHistory(
    feature.statusPath,
    "claude",
    "Generated initial plan (iteration 1)"
  );

  // Review loop
  const reviewerLogSource = getReviewerLogSource(reviewerProvider);

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    // Run review using configured provider
    const reviewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running plan review (${reviewerProvider}, iteration ${iteration})...`,
        cancellable: false,
      },
      async () => reviewPlan(planPath, reviewPath, reviewerProvider)
    );

    if (!reviewResult.success) {
      vscode.window.showWarningMessage(
        `Review failed: ${reviewResult.error}. Continuing without review.`
      );
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        `Review failed: ${reviewResult.error}`
      );
      break;
    }

    // Log review result
    const issueStatus = reviewResult.hasMajorIssues
      ? "has major issues"
      : "no major issues";
    await logToFeatureHistory(
      feature.statusPath,
      reviewerLogSource,
      `Plan review (iteration ${iteration}): ${issueStatus}`
    );

    // Check if we're done
    if (!reviewResult.hasMajorIssues) {
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        "Plan review passed - no major issues"
      );
      break;
    }

    // Check if we've hit max iterations
    if (iteration >= config.maxIterations) {
      vscode.window.showWarningMessage(
        `Max review iterations (${config.maxIterations}) reached. Please review the plan manually.`
      );
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        `Max iterations reached with issues remaining`
      );
      break;
    }

    // Use the review content directly
    const reviewContent = reviewResult.reviewContent;
    if (!reviewContent) {
      vscode.window.showWarningMessage(
        "No review content available. Continuing without feedback."
      );
      break;
    }

    const incorporatePrompt = await getReviewIncorporationPrompt(
      featureId,
      "plan",
      reviewContent
    );

    result = await runClaudeCodeWithProgress(
      incorporatePrompt,
      workspaceRoot,
      `Addressing review feedback (iteration ${iteration + 1})...`,
      sessionId,
      true // Resume existing session
    );

    if (!result.success) {
      vscode.window.showErrorMessage(
        `Failed to incorporate review: ${result.error || "Unknown error"}`
      );
      await logToFeatureHistory(
        feature.statusPath,
        "system",
        `Failed to incorporate review: ${result.error || "Unknown error"}`
      );
      break;
    }

    await logToFeatureHistory(
      feature.statusPath,
      "claude",
      `Addressed review feedback (iteration ${iteration + 1})`
    );
  }

  // Update status to plan-created
  await updateFeatureStatus(
    feature.statusPath,
    "plan-created",
    "system",
    "Plan generation complete"
  );

  vscode.window.showInformationMessage(
    `Plan generated for ${feature.meta.name}`
  );

  return true;
}
