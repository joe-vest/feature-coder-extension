import * as fs from "fs/promises";
import OpenAI from "openai";
import { getOpenAIApiKey, getOpenAIModel, getPrompt, applyTemplate, getReviewerProvider, ReviewerProvider } from "./config";
import { reviewCodeWithClaude } from "./claudeReview";

/**
 * Result from a code review
 */
export interface CodeReviewResult {
  success: boolean;
  hasMajorIssues: boolean;
  hasMinorIssues: boolean;
  reviewContent: string;
  error?: string;
}

/**
 * Code review response structure from OpenAI
 */
interface CodeReviewResponse {
  hasMajorIssues: boolean;
  summary: string;
  majorIssues: string[];
  minorIssues: string[];
  securityConcerns: string[];
  missingFromPlan: string[];
  testingSuggestions: string[];
}

/**
 * Convert code review JSON to markdown
 */
function codeReviewToMarkdown(review: CodeReviewResponse, phaseNumber: number): string {
  const lines: string[] = [];

  lines.push(`# Code Review - Phase ${phaseNumber}\n`);
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

  if (review.securityConcerns.length > 0) {
    lines.push("## Security Concerns\n");
    for (const concern of review.securityConcerns) {
      lines.push(`- ${concern}`);
    }
    lines.push("");
  }

  if (review.missingFromPlan.length > 0) {
    lines.push("## Missing From Plan\n");
    for (const missing of review.missingFromPlan) {
      lines.push(`- ${missing}`);
    }
    lines.push("");
  }

  if (review.testingSuggestions.length > 0) {
    lines.push("## Testing Suggestions\n");
    for (const suggestion of review.testingSuggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Review code changes using OpenAI
 *
 * @param specPath Path to the feature specification
 * @param planPath Path to the implementation plan
 * @param gitDiff Git diff of the changes to review
 * @param phaseNumber The phase number being reviewed
 * @param intentSummary BUILDER's summary of what they implemented
 * @param reviewOutputPath Where to write the review markdown
 */
async function reviewCodeWithOpenAI(
  specPath: string,
  planPath: string,
  gitDiff: string,
  phaseNumber: number,
  intentSummary: string,
  reviewOutputPath: string
): Promise<CodeReviewResult> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return {
      success: false,
      hasMajorIssues: true,
      hasMinorIssues: false,
      reviewContent: "",
      error: "OpenAI API key not configured. Set OPENAI_API_KEY environment variable or featureWorkflow.openaiApiKey setting.",
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
    // Read spec and plan content
    const specContent = await fs.readFile(specPath, "utf8");
    const planContent = await fs.readFile(planPath, "utf8");

    const client = new OpenAI({ apiKey });
    const model = getOpenAIModel();

    const systemPrompt = await getPrompt("codeReviewSystem");
    const userPromptTemplate = await getPrompt("codeReviewUser");

    const userPrompt = applyTemplate(userPromptTemplate, {
      specContent,
      planContent,
      phaseNumber: String(phaseNumber),
      gitDiff,
      intentSummary: intentSummary || "(No summary provided)",
    });

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        hasMajorIssues: true,
        hasMinorIssues: false,
        reviewContent: "",
        error: "No response from OpenAI",
      };
    }

    const review = JSON.parse(content) as CodeReviewResponse;
    const markdown = codeReviewToMarkdown(review, phaseNumber);
    const hasMinorIssues = review.minorIssues.length > 0;

    // Write the review markdown file
    await fs.writeFile(reviewOutputPath, markdown, "utf8");

    return {
      success: true,
      hasMajorIssues: review.hasMajorIssues,
      hasMinorIssues,
      reviewContent: markdown,
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
 * Review code changes using the configured provider
 *
 * @param specPath Path to the feature specification
 * @param planPath Path to the implementation plan
 * @param gitDiff Git diff of the changes to review
 * @param phaseNumber The phase number being reviewed
 * @param intentSummary BUILDER's summary of what they implemented
 * @param reviewOutputPath Where to write the review markdown
 * @param provider Optional provider override; uses configured provider if not specified
 */
export async function reviewCode(
  specPath: string,
  planPath: string,
  gitDiff: string,
  phaseNumber: number,
  intentSummary: string,
  reviewOutputPath: string,
  provider?: ReviewerProvider
): Promise<CodeReviewResult> {
  const reviewerProvider = provider ?? getReviewerProvider();

  if (reviewerProvider === "claude") {
    return reviewCodeWithClaude(
      specPath,
      planPath,
      gitDiff,
      phaseNumber,
      intentSummary,
      reviewOutputPath
    );
  }

  return reviewCodeWithOpenAI(
    specPath,
    planPath,
    gitDiff,
    phaseNumber,
    intentSummary,
    reviewOutputPath
  );
}

/**
 * Merge multiple review results into a single feedback string
 * Used when combining reviewer + ARCHITECT reviews
 */
export function mergeReviewFeedback(
  primaryReview: CodeReviewResult,
  architectReview?: CodeReviewResult
): string {
  const parts: string[] = [];

  if (primaryReview.success) {
    parts.push("## Reviewer Feedback\n");
    parts.push(primaryReview.reviewContent);
  }

  if (architectReview?.success) {
    parts.push("\n## ARCHITECT Review\n");
    parts.push(architectReview.reviewContent);
  }

  return parts.join("\n");
}

/**
 * Determine if any review has major issues
 */
export function hasAnyMajorIssues(
  primaryReview: CodeReviewResult,
  architectReview?: CodeReviewResult
): boolean {
  return primaryReview.hasMajorIssues || (architectReview?.hasMajorIssues ?? false);
}

/**
 * Determine if any review has minor issues (but no major issues)
 */
export function hasOnlyMinorIssues(
  primaryReview: CodeReviewResult,
  architectReview?: CodeReviewResult
): boolean {
  const hasMajor = hasAnyMajorIssues(primaryReview, architectReview);
  if (hasMajor) return false;

  const hasMinor = primaryReview.hasMinorIssues || (architectReview?.hasMinorIssues ?? false);
  return hasMinor;
}
