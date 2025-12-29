import * as fs from "fs/promises";
import * as vscode from "vscode";
import { parseFrontmatter, Frontmatter } from "./utils/yaml";

/**
 * Logs a message to the feature's status file history without changing the status.
 * Used for review commands that don't advance state.
 */
export async function logToFeatureHistory(
  statusFilePath: string,
  source: string,
  message: string
): Promise<void> {
  try {
    const content = await fs.readFile(statusFilePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(content);

    // Build updated YAML section (unchanged)
    const updatedYaml = `---\n${Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n")}\n---\n`;

    // Build history line
    const now = new Date().toISOString();
    const historyLine = `${now}  [${source}]  ${message}\n`;

    // Prepend new history line at the start of body (most recent first)
    const trimmedBody = body.trimStart();
    const updatedBody =
      historyLine +
      (trimmedBody ? trimmedBody + (trimmedBody.endsWith("\n") ? "" : "\n") : "");

    // Write final content
    const updatedContent = updatedYaml + "\n" + updatedBody;
    await fs.writeFile(statusFilePath, updatedContent, "utf8");
  } catch (err) {
    console.error("Failed to log to status file:", err);
    vscode.window.showErrorMessage(
      `Failed to log to feature history: ${(err as Error).message}`
    );
  }
}

export async function updateFeatureStatus(
  statusFilePath: string,
  newStatus: string,
  source: string, // "openai", "claude", "system", "user"
  message: string
): Promise<Frontmatter | null> {
  try {
    let content = await fs.readFile(statusFilePath, "utf8");

    // Parse YAML frontmatter and body
    const { frontmatter, body} = parseFrontmatter(content);
    const oldStatus = frontmatter["status"] as string;

    // Update status in memory
    frontmatter["status"] = newStatus;

    // Build updated YAML section
    const updatedYaml = `---\n${Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n")}\n---\n`;

    // Build history line
    const now = new Date().toISOString(); // could convert to local if you prefer
    const historyLine = `${now}  [${source}]  ${message}\n`;

    // Prepend new history line at the start of body (most recent first)
    const trimmedBody = body.trimStart();
    const updatedBody = historyLine + (trimmedBody ? trimmedBody + (trimmedBody.endsWith("\n") ? "" : "\n") : "");

    // Write final content
    const updatedContent = updatedYaml + "\n" + updatedBody;
    await fs.writeFile(statusFilePath, updatedContent, "utf8");

    // Return updated frontmatter so UI can refresh
    return frontmatter as Frontmatter;
  } catch (err) {
    console.error("Failed to update status file:", err);
    vscode.window.showErrorMessage(
      `Failed to update status for feature: ${(err as Error).message}`
    );
    return null;
  }
}
