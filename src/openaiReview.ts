import * as vscode from "vscode";
import * as fs from "fs/promises";
import OpenAI from "openai";
import { getOpenAIApiKey, getOpenAIModel, getPrompt } from "./config";

/**
 * Result from an OpenAI review
 */
export interface ReviewResult {
  success: boolean;
  hasMajorIssues: boolean;
  reviewContent: string;
  error?: string;
}

/**
 * Spec review response structure
 */
interface SpecReviewResponse {
  hasMajorIssues: boolean;
  summary: string;
  majorIssues: string[];
  minorIssues: string[];
  questions: string[];
  missingRequirements: string[];
  securityRisks: string[];
}

/**
 * Plan review response structure
 */
interface PlanReviewResponse {
  hasMajorIssues: boolean;
  summary: string;
  majorIssues: string[];
  minorIssues: string[];
  missingSteps: string[];
  riskAssessment: string;
  testabilityConcerns: string[];
}

/**
 * Convert spec review JSON to markdown
 */
function specReviewToMarkdown(review: SpecReviewResponse): string {
  const lines: string[] = [];

  lines.push("# Spec Review\n");
  lines.push(`## Summary\n\n${review.summary}\n`);

  if (review.hasMajorIssues) {
    lines.push("**Status: Major Issues Found**\n");
  } else {
    lines.push("**Status: No Major Issues**\n");
  }

  if (review.majorIssues.length > 0) {
    lines.push("## Major Issues\n");
    for (const issue of review.majorIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  if (review.minorIssues.length > 0) {
    lines.push("## Minor Issues\n");
    for (const issue of review.minorIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  if (review.questions.length > 0) {
    lines.push("## Questions\n");
    for (const q of review.questions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  if (review.missingRequirements.length > 0) {
    lines.push("## Missing Requirements\n");
    for (const req of review.missingRequirements) {
      lines.push(`- ${req}`);
    }
    lines.push("");
  }

  if (review.securityRisks.length > 0) {
    lines.push("## Security Risks\n");
    for (const risk of review.securityRisks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Convert plan review JSON to markdown
 */
function planReviewToMarkdown(review: PlanReviewResponse): string {
  const lines: string[] = [];

  lines.push("# Plan Review\n");
  lines.push(`## Summary\n\n${review.summary}\n`);

  if (review.hasMajorIssues) {
    lines.push("**Status: Major Issues Found**\n");
  } else {
    lines.push("**Status: No Major Issues**\n");
  }

  if (review.majorIssues.length > 0) {
    lines.push("## Major Issues\n");
    for (const issue of review.majorIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  if (review.minorIssues.length > 0) {
    lines.push("## Minor Issues\n");
    for (const issue of review.minorIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  if (review.missingSteps.length > 0) {
    lines.push("## Missing Steps\n");
    for (const step of review.missingSteps) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }

  if (review.riskAssessment) {
    lines.push(`## Risk Assessment\n\n${review.riskAssessment}\n`);
  }

  if (review.testabilityConcerns.length > 0) {
    lines.push("## Testability Concerns\n");
    for (const concern of review.testabilityConcerns) {
      lines.push(`- ${concern}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Review a spec using OpenAI
 */
export async function reviewSpec(
  specPath: string,
  reviewOutputPath: string
): Promise<ReviewResult> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: "OpenAI API key not configured. Set OPENAI_API_KEY environment variable or featureWorkflow.openaiApiKey setting.",
    };
  }

  try {
    // Read the spec file
    const specContent = await fs.readFile(specPath, "utf8");

    const client = new OpenAI({ apiKey });
    const model = getOpenAIModel();
    const systemPrompt = await getPrompt("specReviewSystem");

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Please review this technical specification:\n\n${specContent}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        hasMajorIssues: true,
        reviewContent: "",
        error: "No response from OpenAI",
      };
    }

    const review = JSON.parse(content) as SpecReviewResponse;
    const markdown = specReviewToMarkdown(review);

    // Write the review markdown file
    await fs.writeFile(reviewOutputPath, markdown, "utf8");

    return {
      success: true,
      hasMajorIssues: review.hasMajorIssues,
      reviewContent: markdown,
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
 * Review a plan using OpenAI
 */
export async function reviewPlan(
  planPath: string,
  reviewOutputPath: string
): Promise<ReviewResult> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return {
      success: false,
      hasMajorIssues: true,
      reviewContent: "",
      error: "OpenAI API key not configured. Set OPENAI_API_KEY environment variable or featureWorkflow.openaiApiKey setting.",
    };
  }

  try {
    // Read the plan file
    const planContent = await fs.readFile(planPath, "utf8");

    const client = new OpenAI({ apiKey });
    const model = getOpenAIModel();
    const systemPrompt = await getPrompt("planReviewSystem");

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Please review this implementation plan:\n\n${planContent}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        hasMajorIssues: true,
        reviewContent: "",
        error: "No response from OpenAI",
      };
    }

    const review = JSON.parse(content) as PlanReviewResponse;
    const markdown = planReviewToMarkdown(review);

    // Write the review markdown file
    await fs.writeFile(reviewOutputPath, markdown, "utf8");

    return {
      success: true,
      hasMajorIssues: review.hasMajorIssues,
      reviewContent: markdown,
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
 * Check if OpenAI API key is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!getOpenAIApiKey();
}

/**
 * Show error message if OpenAI is not configured
 */
export async function ensureOpenAIConfigured(): Promise<boolean> {
  if (isOpenAIConfigured()) {
    return true;
  }

  vscode.window.showErrorMessage(
    "OpenAI API key not configured. Set OPENAI_API_KEY environment variable or featureWorkflow.openaiApiKey in settings."
  );
  return false;
}
