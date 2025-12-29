import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { Feature } from "./featureModel";
import { updateFeatureStatus } from "./workflowStatus";
import { getWorkspaceRoot, writeFile } from "./utils/fs";
import {
  generateSpecWithReviewLoop,
  generatePlanWithReviewLoop,
} from "./reviewLoop";
import { executeBuildPhase } from "./buildLoop";
import { runTests as executeTests } from "./testRunner";

// ============================================================================
// New Feature Command
// ============================================================================

export async function createNewFeature(): Promise<Feature | undefined> {
  const root = await getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("No workspace folder open");
    return undefined;
  }

  // Prompt for feature ID
  const id = await vscode.window.showInputBox({
    prompt: "Enter feature ID (e.g., user-auth, dark-mode)",
    placeHolder: "feature-id",
    validateInput: (value) => {
      if (!value) return "Feature ID is required";
      if (!/^[a-z0-9-]+$/.test(value)) {
        return "ID must be lowercase letters, numbers, and hyphens only";
      }
      return null;
    },
  });
  if (!id) return undefined;

  // Prompt for feature name
  const name = await vscode.window.showInputBox({
    prompt: "Enter feature display name",
    placeHolder: "User Authentication",
    value: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  });
  if (!name) return undefined;

  // Create docs/features directory if it doesn't exist
  const featuresDir = path.join(root, "docs", "features");
  await fs.mkdir(featuresDir, { recursive: true });

  const now = new Date().toISOString();
  const basePath = path.join(featuresDir, id);

  // Create status file
  const statusContent = `---
id: ${id}
name: ${name}
status: requested
created_at: ${now}
---

${now}  [system]  Created feature
`;
  await writeFile(`${basePath}.status.md`, statusContent);

  // Create request file
  const requestContent = `# ${name}

## Description

<!-- Describe the feature you want to build -->

## User Story

<!-- As a [type of user], I want [goal] so that [benefit] -->

## Requirements

<!-- List the key requirements -->

`;
  await writeFile(`${basePath}.request.md`, requestContent);

  // Open request file for editing
  const requestDoc = await vscode.workspace.openTextDocument(
    `${basePath}.request.md`
  );
  await vscode.window.showTextDocument(requestDoc, { preview: false });

  vscode.window.showInformationMessage(`Created new feature: ${name}`);

  // Return the feature object
  return {
    meta: {
      id,
      name,
      status: "requested",
    },
    statusPath: `${basePath}.status.md`,
    specPath: `${basePath}.spec.md`,
    specReviewPath: `${basePath}.spec.review.md`,
    planPath: `${basePath}.plan.md`,
    planReviewPath: `${basePath}.plan.review.md`,
    requestPath: `${basePath}.request.md`,
  };
}

// ============================================================================
// Generate Spec Command (with Claude Code + OpenAI review loop)
// ============================================================================

export async function generateSpec(feature: Feature): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  await generateSpecWithReviewLoop(feature, root);
}

// ============================================================================
// Generate Plan Command (with Claude Code + OpenAI review loop)
// ============================================================================

export async function generatePlan(feature: Feature): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  await generatePlanWithReviewLoop(feature, root);
}

// ============================================================================
// Mark Status Commands
// ============================================================================

export async function markSpecApproved(feature: Feature): Promise<void> {
  await updateFeatureStatus(
    feature.statusPath,
    "spec-reviewed",
    "user",
    "Marked spec as approved"
  );
  vscode.window.showInformationMessage(
    `Spec approved for ${feature.meta.name}`
  );
}

export async function markPlanApproved(feature: Feature): Promise<void> {
  await updateFeatureStatus(
    feature.statusPath,
    "plan-reviewed",
    "user",
    "Marked plan as approved"
  );
  vscode.window.showInformationMessage(
    `Plan approved for ${feature.meta.name}`
  );
}

export async function markReadyForBuild(feature: Feature): Promise<void> {
  await updateFeatureStatus(
    feature.statusPath,
    "ready-for-build",
    "user",
    "Marked ready for build"
  );
  vscode.window.showInformationMessage(
    `${feature.meta.name} is ready for build`
  );
}

export async function markBuilding(feature: Feature): Promise<void> {
  await updateFeatureStatus(
    feature.statusPath,
    "building",
    "user",
    "Started building"
  );
  vscode.window.showInformationMessage(
    `${feature.meta.name} is now building`
  );
}

export async function markImplemented(feature: Feature): Promise<void> {
  await updateFeatureStatus(
    feature.statusPath,
    "implemented",
    "user",
    "Marked as implemented"
  );
  vscode.window.showInformationMessage(
    `${feature.meta.name} has been implemented!`
  );
}

// ============================================================================
// Build Phase Commands
// ============================================================================

export async function startBuild(feature: Feature): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  // Execute the build phase with BUILDER Claude session
  await executeBuildPhase(feature, root);
}

export async function runCodeReview(feature: Feature): Promise<void> {
  // Transition to code-review state
  // The actual review happens during the build loop, but user can manually trigger this
  await updateFeatureStatus(
    feature.statusPath,
    "code-review",
    "user",
    "Manually advanced to code review"
  );
  vscode.window.showInformationMessage(
    `${feature.meta.name} is now in code review phase.`
  );
}

export async function runTests(feature: Feature): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  // Transition to testing state
  await updateFeatureStatus(
    feature.statusPath,
    "testing",
    "system",
    "Running tests"
  );

  // Execute tests
  const result = await executeTests(root);

  if (result.skipped) {
    vscode.window.showInformationMessage(
      `Tests skipped for ${feature.meta.name}. You can approve or reject the build.`
    );
  } else if (result.passed) {
    vscode.window.showInformationMessage(
      `Tests passed for ${feature.meta.name}! Ready to approve build.`
    );
  } else {
    vscode.window.showWarningMessage(
      `Tests failed for ${feature.meta.name}. Consider rejecting the build to fix issues.`
    );
  }
}

export async function approveBuild(feature: Feature): Promise<void> {
  await updateFeatureStatus(
    feature.statusPath,
    "implemented",
    "user",
    "Build approved and marked as implemented"
  );
  vscode.window.showInformationMessage(
    `Build approved! ${feature.meta.name} is now implemented.`
  );
}

export async function rejectBuild(feature: Feature): Promise<void> {
  await updateFeatureStatus(
    feature.statusPath,
    "building",
    "user",
    "Build rejected, returning to building phase"
  );
  vscode.window.showInformationMessage(
    `Build rejected for ${feature.meta.name}. Returning to building phase.`
  );
}
