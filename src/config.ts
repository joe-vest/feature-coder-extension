import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as logger from "./logger";

/**
 * Prompt overrides structure
 * Users can override any of these prompts via a JSON file
 */
export interface PromptOverrides {
  /** System prompt for spec generation (Claude Code) */
  specGenerationSystem?: string;
  /** User prompt template for spec generation. Use {requestPath} and {featureId} placeholders. */
  specGenerationUser?: string;
  /** System prompt for plan generation (Claude Code) */
  planGenerationSystem?: string;
  /** User prompt template for plan generation. Use {specPath} and {featureId} placeholders. */
  planGenerationUser?: string;
  /** System prompt for spec review (OpenAI) */
  specReviewSystem?: string;
  /** System prompt for plan review (OpenAI) */
  planReviewSystem?: string;
  /** Prompt for incorporating review feedback. Use {artifactType} and {reviewContent} placeholders. */
  reviewIncorporation?: string;

  // Build Phase Prompts
  /** System prompt for BUILDER Claude session */
  buildPhaseSystem?: string;
  /** User prompt for BUILDER to implement a phase. Use {planPath}, {featureId}, {phaseNumber}, {phaseDescription} placeholders. */
  buildPhaseUser?: string;
  /** Prompt for BUILDER to incorporate review feedback. Use {phaseNumber}, {reviewContent} placeholders. */
  buildReviewIncorporation?: string;
  /** System prompt for OpenAI code review */
  codeReviewSystem?: string;
  /** User prompt for OpenAI code review. Use {specContent}, {planContent}, {phaseNumber}, {gitDiff}, {intentSummary} placeholders. */
  codeReviewUser?: string;
  /** User prompt for Claude REVIEWER to review BUILDER's code. Use {planPath}, {phaseNumber}, {diffSummary} placeholders. */
  claudeBuilderReviewUser?: string;

  // Claude Code REVIEWER Prompts (when using Claude instead of OpenAI for reviews)
  /** System prompt for Claude REVIEWER spec review */
  claudeSpecReviewSystem?: string;
  /** User prompt for Claude REVIEWER spec review. Use {specPath} placeholder. */
  claudeSpecReviewUser?: string;
  /** System prompt for Claude REVIEWER plan review */
  claudePlanReviewSystem?: string;
  /** User prompt for Claude REVIEWER plan review. Use {planPath} placeholder. */
  claudePlanReviewUser?: string;
  /** System prompt for Claude REVIEWER code review */
  claudeCodeReviewSystem?: string;
  /** User prompt for Claude REVIEWER code review. Use {specContent}, {planContent}, {phaseNumber}, {gitDiff}, {intentSummary} placeholders. */
  claudeCodeReviewUser?: string;
}

/**
 * Default prompts used when no overrides are provided
 */
export const DEFAULT_PROMPTS: Required<PromptOverrides> = {
  specGenerationSystem: "",  // Claude Code uses its own system prompt
  specGenerationUser: `Read the feature request at {requestPath}

Generate a complete technical specification and save it to docs/features/{featureId}.spec.md

The spec should include:
- Problem Statement
- Success Criteria
- Functional Requirements
- Data & API Changes
- Edge Cases
- Acceptance Tests
- Dependencies
- Risks

Consider the existing codebase architecture and conventions when writing the spec.
Do not include workflow metadata or status information in the spec.`,

  planGenerationSystem: "",  // Claude Code uses its own system prompt
  planGenerationUser: `Read the approved specification at {specPath}

Generate a detailed implementation plan and save it to docs/features/{featureId}.plan.md

IMPORTANT: Divide the implementation into logical PHASES. Each phase should be:
- A coherent unit of work that can be reviewed independently
- Small enough to review effectively (typically 1-3 files changed)
- Large enough to be meaningful (not individual lines)

Mark phases clearly with "## Phase N: <description>" headers.
Trivial changes can be grouped into a single phase.
Complex features should have multiple phases.

The plan should include per phase:
- Files to create/modify
- Key changes in each file
- Dependencies on other phases
- Test expectations

Also include:
- Overview
- Database migrations (if needed)
- API updates (if needed)
- Rollback considerations

Use your knowledge of the codebase to identify specific files that need changes.`,

  specReviewSystem: `You are a critical technical design reviewer. Assess clarity, completeness, risk, testability.
Return a JSON object with these fields:
- hasMajorIssues (boolean): true if there are blocking problems
- summary (string): brief overall assessment
- majorIssues (array of strings): blocking problems that must be fixed
- minorIssues (array of strings): suggestions for improvement
- questions (array of strings): clarifications needed
- missingRequirements (array of strings): requirements not addressed
- securityRisks (array of strings): security or data privacy concerns`,

  planReviewSystem: `You are a senior engineering critic. Evaluate implementation feasibility, risks, testability, and missing tasks.
Return a JSON object with these fields:
- hasMajorIssues (boolean): true if there are blocking problems
- summary (string): brief overall assessment
- majorIssues (array of strings): blocking problems that must be fixed
- minorIssues (array of strings): suggestions for improvement
- missingSteps (array of strings): tasks not included in the plan
- riskAssessment (string): overall risk evaluation
- testabilityConcerns (array of strings): issues with testing the implementation`,

  reviewIncorporation: `Here is a review of the {artifactType} you generated:

{reviewContent}

Please address any Major Issues and consider the Minor Issues.
Update the {artifactType} file with your changes.
Briefly summarize what you changed.`,

  // Build Phase Prompts
  buildPhaseSystem: `You are a BUILDER agent implementing an approved plan.
Your task is to write production-quality code that exactly follows the plan.
Focus on the current phase only. Do not implement future phases.
After implementation, summarize what you changed.`,

  buildPhaseUser: `Read the implementation plan at {planPath}

Implement PHASE {phaseNumber}: {phaseDescription}

Write the code changes to the appropriate files.
Follow existing code patterns and conventions in this codebase.
Include appropriate error handling and comments where helpful.
Do not modify files outside this phase's scope.

After making changes, provide a brief summary of what you implemented.`,

  buildReviewIncorporation: `Here is feedback on your implementation of Phase {phaseNumber}:

{reviewContent}

Address any Major Issues before proceeding.
Consider Minor Issues and incorporate where appropriate.
Update the relevant files and summarize your changes.`,

  codeReviewSystem: `You are a senior code reviewer. You will receive:
1. A code diff showing changes made
2. The feature specification
3. The implementation plan

Evaluate:
- Correctness: Do changes implement the spec/plan correctly?
- Completeness: Are any plan tasks missing from this phase?
- Quality: Clean code, proper error handling, no obvious bugs
- Security: No vulnerabilities introduced
- Testing: Are changes testable? Are tests included?

Return a JSON object with these fields:
- hasMajorIssues (boolean): true if there are blocking problems
- summary (string): brief overall assessment
- majorIssues (array of strings): blocking problems that must be fixed
- minorIssues (array of strings): suggestions for improvement
- securityConcerns (array of strings): security or data integrity risks
- missingFromPlan (array of strings): plan items not implemented in this phase
- testingSuggestions (array of strings): recommended test coverage`,

  codeReviewUser: `## Feature Specification
{specContent}

## Implementation Plan
{planContent}

## Code Changes (Phase {phaseNumber})
\`\`\`diff
{gitDiff}
\`\`\`

## Builder's Intent Summary
{intentSummary}

Please review these changes against the spec and plan.`,

  claudeBuilderReviewUser: `As the REVIEWER, evaluate the BUILDER's implementation against the plan.

Plan: {planPath}
Phase {phaseNumber} implementation changes:
{diffSummary}

Evaluate:
1. Does the implementation correctly follow the plan?
2. Are there any design or quality concerns?
3. Does this integrate well with the existing codebase?

IMPORTANT: You MUST end your review with a structured verdict block using EXACTLY this format:

---
## VERDICT

**Action Required**: [NONE | MINOR | MAJOR]
**Builder Must Fix**: [YES | NO]

[If YES, list ONLY the specific changes BUILDER must make - no commentary]
---

Definitions:
- **MAJOR**: Blocking issues - security vulnerabilities, incorrect requirements, breaking changes, missing critical functionality. BUILDER must fix these.
- **MINOR**: Suggestions that would improve quality - style, docs, minor optimizations. BUILDER gets ONE iteration to address.
- **NONE**: Implementation is correct. No changes needed from BUILDER.

Above the VERDICT block, you may include any analysis, observations, or commentary for human readers. This commentary does NOT trigger BUILDER action - only the VERDICT block matters.

Example verdicts:

Example 1 (approved):
---
## VERDICT

**Action Required**: NONE
**Builder Must Fix**: NO
---

Example 2 (minor suggestions):
---
## VERDICT

**Action Required**: MINOR
**Builder Must Fix**: YES

- Add error handling for null config values in settings.ts
- Consider extracting the validation logic to a helper function
---

Example 3 (blocking issues):
---
## VERDICT

**Action Required**: MAJOR
**Builder Must Fix**: YES

- Fix SQL injection vulnerability in query builder (line 45)
- Implement missing authentication check before data access
---`,

  // Claude Code REVIEWER Prompts
  claudeSpecReviewSystem: `You are a REVIEWER - a critical technical design reviewer.
Your role is to provide an independent, objective review of specifications.
You are NOT the author of this spec - you are reviewing someone else's work.

Be thorough but fair. Identify real problems, not stylistic preferences.`,

  claudeSpecReviewUser: `Read the specification at {specPath}

Review this specification for:
- Clarity: Is it clear and unambiguous?
- Completeness: Are all requirements covered?
- Feasibility: Is this implementable?
- Testability: Can the requirements be tested?
- Risk: Are there security, performance, or reliability concerns?

Format your response as a review document with these sections:

# Spec Review

## Summary
(Brief overall assessment)

**Status: [Major Issues Found / No Major Issues]**

## Major Issues
(List blocking problems that MUST be fixed, if any)

## Minor Issues
(List suggestions for improvement, if any)

## Questions
(List clarifications needed, if any)

## Missing Requirements
(List requirements not addressed, if any)

## Security Risks
(List security or data privacy concerns, if any)

Be direct and specific. If there are no issues in a section, omit that section.`,

  claudePlanReviewSystem: `You are a REVIEWER - a senior engineering critic.
Your role is to provide an independent, objective review of implementation plans.
You are NOT the author of this plan - you are reviewing someone else's work.

Evaluate feasibility, risks, and completeness. Be constructive but thorough.`,

  claudePlanReviewUser: `Read the implementation plan at {planPath}

Review this plan for:
- Feasibility: Can this be implemented as described?
- Completeness: Are all necessary tasks included?
- Order: Are tasks in the right sequence?
- Risk: Are there architectural, performance, or security risks?
- Testability: How will this be tested?

Format your response as a review document with these sections:

# Plan Review

## Summary
(Brief overall assessment)

**Status: [Major Issues Found / No Major Issues]**

## Major Issues
(List blocking problems that MUST be fixed, if any)

## Minor Issues
(List suggestions for improvement, if any)

## Missing Steps
(List tasks not included in the plan, if any)

## Risk Assessment
(Overall risk evaluation)

## Testability Concerns
(Issues with testing the implementation, if any)

Be direct and specific. If there are no issues in a section, omit that section.`,

  claudeCodeReviewSystem: `You are a REVIEWER - a senior code reviewer.
Your role is to provide an independent, objective review of code changes.
You are NOT the author of this code - you are reviewing someone else's work.

Focus on correctness, security, and adherence to the spec and plan.`,

  claudeCodeReviewUser: `Review the following code changes against the spec and plan.

## Feature Specification
{specContent}

## Implementation Plan
{planContent}

## Code Changes (Phase {phaseNumber})
\`\`\`diff
{gitDiff}
\`\`\`

## Builder's Intent Summary
{intentSummary}

Evaluate:
- Correctness: Do changes implement the spec/plan correctly?
- Completeness: Are any plan tasks missing from this phase?
- Quality: Clean code, proper error handling, no obvious bugs
- Security: No vulnerabilities introduced
- Testing: Are changes testable? Are tests included?

Format your response as a review document. Include analysis sections as needed, then end with a structured VERDICT:

# Code Review - Phase {phaseNumber}

## Summary
(Brief overall assessment)

[Optional sections for detailed analysis: Major Issues, Minor Issues, Security Concerns, etc.]

---
## VERDICT

**Action Required**: [NONE | MINOR | MAJOR]
**Builder Must Fix**: [YES | NO]

[If YES, list ONLY the specific changes required - no commentary]
---

Definitions:
- **MAJOR**: Blocking issues - security vulnerabilities, incorrect requirements, breaking changes. BUILDER must fix.
- **MINOR**: Quality improvements - style, docs, optimizations. BUILDER gets ONE iteration.
- **NONE**: Implementation is correct. No changes needed.

The VERDICT block determines loop behavior. Commentary sections are for human review only.`,
};

let cachedOverrides: PromptOverrides | null = null;
let cachedOverridesPath: string | null = null;

/**
 * Get the OpenAI API key from settings or environment
 */
export function getOpenAIApiKey(): string | undefined {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  const settingsKey = config.get<string>("openaiApiKey", "");

  if (settingsKey && settingsKey.trim() !== "") {
    return settingsKey.trim();
  }

  return process.env.OPENAI_API_KEY;
}

/**
 * Get the OpenAI model from settings
 */
export function getOpenAIModel(): string {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  return config.get<string>("openaiModel", "gpt-4o");
}

/**
 * Reviewer provider type
 */
export type ReviewerProvider = "openai" | "claude";

/**
 * Get the configured reviewer provider
 */
export function getReviewerProvider(): ReviewerProvider {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  return config.get<ReviewerProvider>("reviewerProvider", "openai");
}

/**
 * Load prompt overrides from the configured file
 */
export async function loadPromptOverrides(): Promise<PromptOverrides> {
  const config = vscode.workspace.getConfiguration("featureWorkflow");
  const overridesPath = config.get<string>("promptOverridesFile", "");

  if (!overridesPath || overridesPath.trim() === "") {
    logger.debug("config", "No prompt overrides file configured");
    return {};
  }

  // Resolve relative paths from workspace root
  let fullPath = overridesPath;
  if (!path.isAbsolute(overridesPath)) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      logger.warn("config", "Cannot resolve relative overrides path - no workspace root");
      return {};
    }
    fullPath = path.join(workspaceRoot, overridesPath);
  }

  // Use cache if path hasn't changed
  if (cachedOverrides && cachedOverridesPath === fullPath) {
    logger.debug("config", "Using cached prompt overrides");
    return cachedOverrides;
  }

  try {
    logger.debug("config", `Loading prompt overrides from: ${fullPath}`);
    const content = await fs.readFile(fullPath, "utf8");
    const overrides = JSON.parse(content) as PromptOverrides;
    cachedOverrides = overrides;
    cachedOverridesPath = fullPath;
    logger.info("config", `Loaded prompt overrides`, {
      path: fullPath,
      keys: Object.keys(overrides),
    });
    return overrides;
  } catch (err) {
    // File doesn't exist or is invalid - log but don't fail
    logger.warn("config", `Could not load prompt overrides from ${fullPath}`, err);
    return {};
  }
}

/**
 * Clear the prompt overrides cache (call when settings change)
 */
export function clearPromptOverridesCache(): void {
  cachedOverrides = null;
  cachedOverridesPath = null;
}

/**
 * Get a prompt with overrides applied
 */
export async function getPrompt<K extends keyof PromptOverrides>(
  key: K
): Promise<string> {
  logger.debug("config", `Getting prompt: ${key}`);
  const overrides = await loadPromptOverrides();
  const isOverridden = key in overrides && overrides[key];
  const prompt = (overrides[key] as string) || DEFAULT_PROMPTS[key];
  logger.debug("config", `Prompt "${key}" resolved`, {
    isOverridden,
    promptLength: prompt.length,
  });
  return prompt;
}

/**
 * Apply template substitutions to a prompt
 */
export function applyTemplate(
  prompt: string,
  substitutions: Record<string, string>
): string {
  let result = prompt;
  for (const [key, value] of Object.entries(substitutions)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}
