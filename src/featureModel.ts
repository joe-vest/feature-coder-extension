import * as path from "path";
import * as vscode from "vscode";
import { parseFrontmatter } from "./utils/yaml";
import { getWorkspaceRoot, readFileIfExists } from "./utils/fs";

export type FeatureStatus =
  | "requested"
  | "draft"
  | "spec-reviewed"
  | "plan-created"
  | "plan-reviewed"
  | "ready-for-build"
  | "building"       // BUILDER implementing code
  | "code-review"    // Code under review (OpenAI + optionally ARCHITECT)
  | "testing"        // Running tests
  | "implemented";

export interface FeatureMeta {
  id: string;
  name: string;
  status: FeatureStatus;
  owner?: string;
}

export interface Feature {
  meta: FeatureMeta;
  statusPath: string;
  specPath: string;
  specReviewPath?: string;
  planPath?: string;
  planReviewPath?: string;
  requestPath?: string;
  codeReviewPath?: string;
}


export const allowedTransitions: Record<FeatureStatus, FeatureStatus[]> = {
  requested: ["draft"],
  draft: ["spec-reviewed"],
  "spec-reviewed": ["plan-created"],
  "plan-created": ["plan-reviewed"],
  "plan-reviewed": ["ready-for-build"],
  "ready-for-build": ["building"],
  building: ["code-review"],
  "code-review": ["testing", "building"],  // Can go back to building if issues
  testing: ["implemented", "building"],     // Can go back if tests fail
  implemented: [],
};

export function canTransition(from: FeatureStatus, to: FeatureStatus): boolean {
  return allowedTransitions[from]?.includes(to) ?? false;
}

export async function loadFeatures(): Promise<Feature[]> {
  const root = await getWorkspaceRoot();
  if (!root) return [];

  // Status files are the source of truth
  const uris = await vscode.workspace.findFiles("docs/features/*.status.md");

  const features: Feature[] = [];

  for (const uri of uris) {
    const content = await readFileIfExists(uri.fsPath);
    if (!content) continue;

    const { frontmatter } = parseFrontmatter(content);

    const id =
      (frontmatter["id"] as string) ||
      path.basename(uri.fsPath).replace(".status.md", "");

    const name =
      (frontmatter["name"] as string) ||
      id.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

    const status =
      (frontmatter["status"] as FeatureStatus) || ("draft" as FeatureStatus);

    const base = uri.fsPath.replace(".status.md", "");

    const feature: Feature = {
      meta: {
        id,
        name,
        status,
        owner: frontmatter["owner"] as string | undefined,
      },
      statusPath: uri.fsPath,
      specPath: `${base}.spec.md`,
      specReviewPath: `${base}.spec.review.md`,
      planPath: `${base}.plan.md`,
      planReviewPath: `${base}.plan.review.md`,
      requestPath: `${base}.request.md`,
      codeReviewPath: `${base}.code.review.md`,
    };

    features.push(feature);
  }

  return features;
}

