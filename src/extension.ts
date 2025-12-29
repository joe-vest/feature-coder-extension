import * as vscode from "vscode";
import {
  FeatureTreeDataProvider,
  ArtifactNode,
  FeatureNode,
} from "./featureTree";
import { Feature } from "./featureModel";
import {
  createNewFeature,
  generateSpec,
  generatePlan,
  markSpecApproved,
  markPlanApproved,
  markReadyForBuild,
  markImplemented,
  startBuild,
  runCodeReview,
  runTests,
  approveBuild,
  rejectBuild,
} from "./workflowCommands";
import * as logger from "./logger";

/**
 * Update the context key with the currently selected feature's status.
 * This is used to control which menu items are shown.
 */
async function updateStatusContext(
  treeView: vscode.TreeView<vscode.TreeItem>,
  provider: FeatureTreeDataProvider
) {
  const selected = treeView.selection[0];
  if (selected instanceof FeatureNode) {
    // Re-fetch the feature's current status from the provider
    // because the in-memory feature object may be stale after a refresh
    const featureId = selected.feature.meta.id;
    const freshFeatures = provider.getFeatures();
    const freshFeature = freshFeatures.find((f: Feature) => f.meta.id === featureId);
    const status = freshFeature?.meta.status ?? selected.feature.meta.status;

    logger.info("extension", `Updating status context for ${featureId}`, { status });
    await vscode.commands.executeCommand(
      "setContext",
      "featureWorkflow.featureStatus",
      status
    );
    logger.debug("extension", `Context updated to: ${status}`);
  } else {
    await vscode.commands.executeCommand(
      "setContext",
      "featureWorkflow.featureStatus",
      undefined
    );
    logger.debug("extension", "Context cleared (no feature selected)");
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Initialize the logger and add it to subscriptions for cleanup
  const outputChannel = logger.initLogger();
  context.subscriptions.push(outputChannel);
  logger.info("extension", "Feature Workflow extension activating...");

  const provider = new FeatureTreeDataProvider();

  const treeView = vscode.window.createTreeView("featureWorkflowView", {
    treeDataProvider: provider,
  });

  // When the selection changes, update a context key with the feature's status
  const selectionDisposable = treeView.onDidChangeSelection(() => {
    void updateStatusContext(treeView, provider);
  });

  // Refresh after doc save
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(async () => {
    await provider.refresh();
    void updateStatusContext(treeView, provider);
  });

  context.subscriptions.push(treeView, selectionDisposable, saveDisposable);

  // Helper to refresh tree, re-select the item, and update context
  async function refreshAndUpdateContext(featureId?: string) {
    // Remember the currently selected feature ID before refresh
    const selectedId = featureId ?? (
      treeView.selection[0] instanceof FeatureNode
        ? treeView.selection[0].feature.meta.id
        : undefined
    );

    await provider.refresh();

    // Re-select the feature after refresh if we had one selected
    if (selectedId) {
      const node = provider.getFeatureNode(selectedId);
      if (node) {
        try {
          // Reveal and select the item
          await treeView.reveal(node, { select: true, focus: false });
          logger.debug("extension", `Re-selected feature: ${selectedId}`);
        } catch (err) {
          logger.warn("extension", `Could not re-select feature: ${selectedId}`, err);
        }
      } else {
        logger.warn("extension", `Could not find node for feature: ${selectedId}`);
      }
    }

    await updateStatusContext(treeView, provider);
  }

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("featureWorkflow.refresh", () =>
      refreshAndUpdateContext()
    )
  );

  // Open artifact command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.openArtifact",
      async (node: ArtifactNode) => {
        const doc = await vscode.workspace.openTextDocument(node.fullPath);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    )
  );

  // New Feature command (no node required - can be called from command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.newFeature",
      async () => {
        await createNewFeature();
        await refreshAndUpdateContext();
      }
    )
  );

  // Generate Spec command (uses Claude Code + OpenAI review loop)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.generateSpec",
      async (node: FeatureNode) => {
        await generateSpec(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Generate Plan command (uses Claude Code + OpenAI review loop)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.generatePlan",
      async (node: FeatureNode) => {
        await generatePlan(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Mark Spec Approved command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.markSpecApproved",
      async (node: FeatureNode) => {
        await markSpecApproved(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Mark Plan Approved command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.markPlanApproved",
      async (node: FeatureNode) => {
        await markPlanApproved(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Mark Ready for Build command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.markReadyForBuild",
      async (node: FeatureNode) => {
        await markReadyForBuild(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Start Build command (launches BUILDER Claude session)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.startBuild",
      async (node: FeatureNode) => {
        await startBuild(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Run Code Review command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.runCodeReview",
      async (node: FeatureNode) => {
        await runCodeReview(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Run Tests command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.runTests",
      async (node: FeatureNode) => {
        await runTests(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Approve Build command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.approveBuild",
      async (node: FeatureNode) => {
        await approveBuild(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Reject Build command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.rejectBuild",
      async (node: FeatureNode) => {
        await rejectBuild(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Mark Implemented command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "featureWorkflow.markImplemented",
      async (node: FeatureNode) => {
        await markImplemented(node.feature);
        await refreshAndUpdateContext();
      }
    )
  );

  // Initial load
  provider.refresh();

  logger.info("extension", "Feature Workflow extension activated successfully");
}

export function deactivate() {
  logger.info("extension", "Feature Workflow extension deactivating...");
  logger.dispose();
}
