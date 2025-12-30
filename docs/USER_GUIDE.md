# Feature Workflow Extension - User Guide

A VS Code extension for managing LLM-assisted feature development. Claude Code generates specs and plans while a configurable reviewer (OpenAI or Claude Code) provides critical review, with human checkpoints at each stage.

## Prerequisites

- **Claude Code CLI** installed and in PATH ([installation guide](https://docs.anthropic.com/en/docs/claude-code))
- **Reviewer Configuration** - Choose one:
  - **OpenAI (default)**: Set `OPENAI_API_KEY` environment variable or `featureWorkflow.openaiApiKey` in settings
  - **Claude**: Set `featureWorkflow.reviewerProvider` to `"claude"` (no additional API key needed)

## The Workflow

The workflow alternates between automated LLM steps and human checkpoints:

```
👤 Write Request
    ↓
🤖 Generate Spec (ARCHITECT Claude + REVIEWER loop)
    ↓
👤 Review & Approve Spec ← Human checkpoint
    ↓
🤖 Generate Plan with Phases (ARCHITECT Claude + REVIEWER loop)
    ↓
👤 Review & Approve Plan ← Human checkpoint
    ↓
👤 Mark Ready for Build
    ↓
🤖 Build Phase 1..N (BUILDER Claude + REVIEWER/ARCHITECT review loop)
    ↓
👤 OR 🤖 Run Tests (configurable)
    ↓
👤 Approve Build ← Human checkpoint
    ↓
✔️ Implemented
```

**Legend:** 👤 = Human action required · 🤖 = Automated (LLMs)

### Three Claude Personas

The extension uses distinct Claude Code sessions for different roles:

| Persona | Role | Session Scope |
|---------|------|---------------|
| **ARCHITECT** | Creates specs and plans | Spec/Plan generation phases |
| **BUILDER** | Implements code from approved plan | Build phase only |
| **REVIEWER** | Reviews specs, plans, and code | Fresh sessions for objectivity |

All personas use Claude Code CLI but with different prompts and contexts. When `reviewerProvider` is set to `openai`, OpenAI API is used for primary reviews instead of Claude REVIEWER. During build phase, there can be two reviewers: the primary reviewer (OpenAI or Claude based on `reviewerProvider`) and an optional Claude REVIEWER (when `buildReviewMode` is `architect-only` or `both`).

### Review Loops (Automated)

When you trigger "Generate Spec" or "Generate Plan", the extension runs an automated loop:

1. **ARCHITECT Claude** generates the artifact (has full codebase context)
2. **REVIEWER** (OpenAI or Claude, based on `reviewerProvider`) critiques it for issues, gaps, and risks
3. If **major issues** found → ARCHITECT addresses feedback and loop repeats
4. Loop ends when clean review OR max iterations reached (default: 3)

You don't interact during the loop—just wait for it to complete, then review the results.

#### Major vs Minor Issues

The review loop only iterates on **major issues** (blocking problems that must be fixed). Minor issues and recommendations are:

- Written to the review file (`*.spec.review.md` or `*.plan.review.md`)
- Logged in the feature history
- **Not** automatically sent back to ARCHITECT for incorporation

This is by design—minor issues are suggestions for human review rather than automatic incorporation. If the reviewer finds no major issues, the loop completes after the first review pass. You can:

1. Review minor recommendations in the `*.review.md` file
2. Manually edit the spec/plan to incorporate suggestions you agree with
3. Or proceed knowing the artifact passed major issue review

### States

| Status | Actor | Meaning |
|--------|-------|---------|
| 📋 requested | 👤 | Feature request created, awaiting spec generation |
| 📝 draft | 🤖 | Spec generated, awaiting human review |
| ✅ spec-reviewed | 👤 | Spec approved, ready for plan generation |
| 📐 plan-created | 🤖 | Plan generated, awaiting human review |
| ✅ plan-reviewed | 👤 | Plan approved, ready for build |
| 🔨 ready-for-build | 👤 | Approved for implementation |
| 🏗️ building | 🤖 | BUILDER implementing code phase by phase |
| 🔍 code-review | 🤖 | Code under review by REVIEWER/ARCHITECT |
| 🧪 testing | 👤/🤖 | Running tests (auto or manual) |
| ✔️ implemented | 👤 | Complete |

## Step-by-Step

### 1. Create a New Feature

- Click the **+** button in the Feature Workflow panel
- Enter a feature ID (e.g., `user-auth`, `dark-mode`)
- Enter a display name
- Fill in the `*.request.md` file that opens with your feature description

### 2. Generate Spec (ARCHITECT + REVIEWER Loop)

Right-click the feature and select **Generate Spec**.

What happens:
1. ARCHITECT Claude reads your request and codebase context
2. ARCHITECT generates a technical specification
3. REVIEWER (OpenAI or Claude) reviews the spec for issues
4. If issues found, ARCHITECT addresses feedback (same session)
5. Loop repeats until clean review or max iterations (default: 3)

Result: `*.spec.md` and `*.spec.review.md` files created.

### 3. Approve the Spec

- Review the generated spec and the REVIEWER's feedback
- Make any manual edits if needed
- Right-click and select **Mark Spec Approved**

### 4. Generate Plan (ARCHITECT + REVIEWER Loop)

Right-click and select **Generate Plan**.

Same loop process:
1. ARCHITECT Claude reads the approved spec
2. ARCHITECT generates an implementation plan with specific file changes
3. REVIEWER reviews for feasibility and missing steps
4. ARCHITECT addresses feedback
5. Loop until clean or max iterations

Result: `*.plan.md` and `*.plan.review.md` files created.

### 5. Approve the Plan

- Review the implementation plan
- Right-click and select **Mark Plan Approved**

### 6. Build Phase (Automated)

Once the plan is approved, you can start the automated build process:

1. Right-click and select **Mark Ready for Build**
2. Right-click and select **Start Build (Claude BUILDER)**

What happens during build:

1. The plan is parsed for phases (marked as `## Phase N: Description`)
2. BUILDER Claude implements each phase sequentially
3. After each phase, REVIEWER reviews the code diff
4. Optionally, ARCHITECT Claude also reviews (configurable via `buildReviewMode`)
5. If issues found, BUILDER addresses feedback and loop repeats
6. Once all phases complete, status advances to `code-review`

### 7. Testing

Right-click and select **Run Tests**:

- If `testCommand` is configured, tests run automatically
- If not configured, you're prompted to run tests manually and report results

### 8. Complete the Build

- **Approve Build** - marks the feature as implemented
- **Reject Build** - returns to building phase to address issues

## File Structure

Features live in `docs/features/`:

```
docs/features/
├── my-feature.status.md        # Workflow state and history
├── my-feature.request.md       # Your original request
├── my-feature.spec.md          # Generated specification
├── my-feature.spec.review.md   # OpenAI's spec review
├── my-feature.plan.md          # Generated implementation plan
├── my-feature.plan.review.md   # OpenAI's plan review
└── my-feature.code.review.md   # Code review feedback (build phase)
```

## Configuration

In VS Code settings (`featureWorkflow.*`):

| Setting | Default | Description |
|---------|---------|-------------|
| `reviewerProvider` | openai | Which provider for reviews: `openai` or `claude` |
| `maxReviewIterations` | 3 | Max ARCHITECT-REVIEWER loops for spec/plan |
| `sessionTimeoutMinutes` | 10 | Timeout for Claude Code sessions |
| `openaiModel` | gpt-4o | OpenAI model (when `reviewerProvider` is `openai`) |
| `openaiApiKey` | (empty) | OpenAI API key; falls back to env var if empty |
| `promptOverridesFile` | (empty) | Path to JSON file with custom prompts |
| `buildReviewMode` | both | Who reviews BUILDER's code: `openai-only` (uses configured reviewer), `architect-only`, or `both` |
| `testCommand` | (empty) | Command to run tests (e.g., `npm test`). If empty, prompts user |
| `maxBuildIterations` | 5 | Max review iterations per build phase |
| `debugMode` | false | Enable verbose debug logging for troubleshooting |

### Custom Prompts

You can customize the prompts used for generation and review by creating a JSON file and pointing to it via `promptOverridesFile`. The file can override any of these keys:

```json
{
  "specGenerationUser": "Spec generation prompt ({featureId}, {requestPath})",
  "planGenerationUser": "Plan generation prompt ({featureId}, {specPath})",
  "specReviewSystem": "System prompt for OpenAI spec reviews",
  "planReviewSystem": "System prompt for OpenAI plan reviews",
  "reviewIncorporation": "Feedback incorporation ({artifactType}, {reviewContent})",
  "buildPhaseSystem": "System prompt for BUILDER",
  "buildPhaseUser": "Build phase prompt ({planPath}, {phaseNumber}, {phaseDescription})",
  "buildReviewIncorporation": "Build feedback ({phaseNumber}, {reviewContent})",
  "codeReviewSystem": "System prompt for OpenAI code reviews",
  "codeReviewUser": "Code review prompt ({specContent}, {planContent}, {gitDiff})",
  "claudeBuilderReviewUser": "Claude REVIEWER code review ({planPath}, {phaseNumber}, {diffSummary})",
  "claudeSpecReviewSystem": "System prompt for Claude spec reviews",
  "claudeSpecReviewUser": "Claude spec review prompt ({specPath})",
  "claudePlanReviewSystem": "System prompt for Claude plan reviews",
  "claudePlanReviewUser": "Claude plan review prompt ({planPath})",
  "claudeCodeReviewSystem": "System prompt for Claude code reviews",
  "claudeCodeReviewUser": "Claude code review prompt ({specContent}, {planContent}, {gitDiff})"
}
```

Relative paths are resolved from the workspace root.

## Tips

- **Review the reviews**: REVIEWER feedback is saved to `*.review.md` files. Read them to understand what was flagged.
- **Edit anytime**: You can manually edit any generated file before approving.
- **Check history**: The `*.status.md` file contains a log of all workflow actions.
- **Concurrent features**: Each feature gets its own Claude session, so you can work on multiple features in parallel.
- **No project modifications**: The extension doesn't scaffold scripts or modify your `package.json`. All LLM integrations run within the extension itself.
- **Claude-only mode**: Set `reviewerProvider` to `claude` to use only Claude Code CLI (no OpenAI API key needed).
- **Troubleshooting**: Enable `debugMode` to see detailed logging of Claude Code interactions, prompts, and internal state in the Output panel.
