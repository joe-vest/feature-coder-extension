import * as vscode from "vscode";
import * as path from "path";
import { Feature, FeatureStatus, loadFeatures } from "./featureModel";

const statusIcons: Record<FeatureStatus, string> = {
  requested: "📋",
  draft: "📝",
  "spec-reviewed": "✅",
  "plan-created": "📐",
  "plan-reviewed": "✅",
  "ready-for-build": "🔨",
  building: "🏗️",
  "code-review": "🔍",
  testing: "🧪",
  implemented: "✔️",
};

export class FeatureNode extends vscode.TreeItem {
  constructor(public readonly feature: Feature) {
    super(feature.meta.name, vscode.TreeItemCollapsibleState.Collapsed);

    // Use feature ID as the tree item ID to maintain selection across refreshes
    this.id = `feature:${feature.meta.id}`;

    const icon = statusIcons[feature.meta.status] || "❓";
    this.description = `${icon} [${feature.meta.status}]`;
    this.contextValue = "featureNode";

    this.tooltip = new vscode.MarkdownString(
      `**${feature.meta.name}**\n\nStatus: \`${feature.meta.status}\`\nID: \`${feature.meta.id}\``
    );
  }
}

export type ArtifactType =
  | "status"
  | "spec"
  | "specReview"
  | "plan"
  | "planReview"
  | "request"
  | "codeReview";


export class ArtifactNode extends vscode.TreeItem {
  constructor(
    public readonly feature: Feature,
    public readonly type: ArtifactType,
    public readonly fullPath: string
  ) {
    super(path.basename(fullPath), vscode.TreeItemCollapsibleState.None);

    // Use feature ID + artifact type as the tree item ID to maintain selection across refreshes
    this.id = `artifact:${feature.meta.id}:${type}`;

    this.command = {
      command: "featureWorkflow.openArtifact",
      title: "Open",
      arguments: [this],
    };

    this.contextValue = `artifactNode.${type}`;
    this.description = type;
  }
}

export class FeatureTreeDataProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData =
    new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private features: Feature[] = [];
  private featureNodes: Map<string, FeatureNode> = new Map();

  /**
   * Get the current list of features (for status context lookup)
   */
  getFeatures(): Feature[] {
    return this.features;
  }

  /**
   * Get a FeatureNode by feature ID (for re-selecting after refresh)
   */
  getFeatureNode(featureId: string): FeatureNode | undefined {
    return this.featureNodes.get(featureId);
  }

  async refresh() {
    this.features = await loadFeatures();
    // Pre-populate the node cache so getFeatureNode works immediately after refresh
    // (getChildren is called asynchronously by VS Code, so we can't rely on it)
    this.featureNodes.clear();
    for (const f of this.features) {
      const node = new FeatureNode(f);
      this.featureNodes.set(f.meta.id, node);
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(
    element: vscode.TreeItem
  ): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  /**
   * Get parent of an element (required for treeView.reveal to work)
   */
  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof ArtifactNode) {
      // Parent of an artifact is its feature node
      return this.featureNodes.get(element.feature.meta.id);
    }
    // FeatureNodes have no parent (they're at root level)
    return undefined;
  }

  async getChildren(
    element?: vscode.TreeItem
  ): Promise<vscode.TreeItem[]> {
    if (!element) {
      if (!this.features.length) {
        this.features = await loadFeatures();
        // Populate cache if this is the first load (before any refresh)
        for (const f of this.features) {
          if (!this.featureNodes.has(f.meta.id)) {
            this.featureNodes.set(f.meta.id, new FeatureNode(f));
          }
        }
      }
      // Return cached nodes (created in refresh() or above)
      return this.features.map((f) => this.featureNodes.get(f.meta.id)!);
    }

    if (element instanceof FeatureNode) {
      const f = element.feature;
      const children: vscode.TreeItem[] = [];

      const pushIfExists = async (type: ArtifactType, filePath?: string) => {
        if (!filePath) return;
        const uri = vscode.Uri.file(filePath);
        try {
          await vscode.workspace.fs.stat(uri);
          children.push(new ArtifactNode(f, type, filePath));
        } catch {
          // file missing; skip
        }
      };

      // status file first
      await pushIfExists("status", f.statusPath);

      await pushIfExists("request", f.requestPath);
      await pushIfExists("spec", f.specPath);
      await pushIfExists("specReview", f.specReviewPath);
      await pushIfExists("plan", f.planPath);
      await pushIfExists("planReview", f.planReviewPath);
      await pushIfExists("codeReview", f.codeReviewPath);

      return children;
    }

    return [];
  }
}
