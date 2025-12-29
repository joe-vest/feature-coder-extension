# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run compile        # Type-check, lint, and bundle with esbuild
npm run check-types    # TypeScript type checking only (tsc --noEmit)
npm run lint           # ESLint on src/
npm run watch          # Watch mode for development (parallel esbuild + tsc)
npm run test           # Run VS Code extension tests
npm run package        # Production build for publishing
```

## Architecture

This is a VS Code extension that manages feature development workflows using Claude Code for generation and a configurable reviewer (OpenAI or Claude Code).

### Core Flow

1. **Feature Creation** (`workflowCommands.ts:createNewFeature`) - Creates `docs/features/<id>.status.md` and `<id>.request.md`
2. **Spec Generation** (`reviewLoop.ts:generateSpecWithReviewLoop`) - ARCHITECT Claude generates spec, REVIEWER reviews iteratively
3. **Plan Generation** (`reviewLoop.ts:generatePlanWithReviewLoop`) - ARCHITECT Claude generates plan with phases, REVIEWER reviews iteratively
4. **Build Phase** (`buildLoop.ts:executeBuildPhase`) - BUILDER Claude implements each phase, REVIEWER(s) review code diffs
5. **Testing** (`testRunner.ts:runTests`) - Auto-run test command or prompt user for manual testing
6. **Approvals** - User advances through statuses via context menu commands

### Three Claude Personas

- **ARCHITECT** - Creates specs and plans (spec/plan phases only). Uses persistent session within a feature for continuity.
- **BUILDER** - Implements code from approved plan (build phase only). Uses persistent session across all phases.
- **REVIEWER** - Reviews specs, plans, and code. All review sessions are separate from ARCHITECT/BUILDER for objectivity. In build phase, there are two potential reviewers:
  - Primary reviewer (configured via `reviewerProvider`): OpenAI or Claude
  - Claude REVIEWER (when `buildReviewMode` includes "architect"): separate Claude session

All personas use Claude Code CLI but with different prompts and session contexts. ARCHITECT and BUILDER maintain session continuity. REVIEWER sessions are kept separate for objectivity.

### Feature Status Lifecycle

`requested` → `draft` → `spec-reviewed` → `plan-created` → `plan-reviewed` → `ready-for-build` → `building` → `code-review` → `testing` → `implemented`

Status transitions are enforced in `featureModel.ts:allowedTransitions`.

### Key Components

- **claudeCode.ts** - Wraps Claude Code CLI invocation via `spawn("claude", ...)` with `--output-format stream-json`. Handles session management (`--session-id` for new, `--resume` for continuing).
- **openaiReview.ts** - Calls OpenAI API directly using the `openai` npm package. Handles spec and plan reviews with structured JSON output (`response_format: { type: "json_object" }`). Writes review markdown files and returns `hasMajorIssues` boolean for loop control.
- **claudeReview.ts** - Alternative reviewer using Claude Code CLI. Handles spec, plan, and code reviews when `reviewerProvider` is set to `claude`. Uses separate sessions (REVIEWER persona) for objectivity.
- **reviewLoop.ts** - Orchestrates the ARCHITECT→REVIEWER review loop for spec/plan generation. Uses configured `reviewerProvider`.
- **buildLoop.ts** - Orchestrates BUILDER phase: parses plan phases, implements each with Claude, reviews with configured REVIEWER(s).
- **codeReview.ts** - Unified code review interface. Routes to OpenAI or Claude based on `reviewerProvider` setting.
- **planParser.ts** - Extracts phases from plan files (parses `## Phase N: Description` headers).
- **gitUtils.ts** - Git utilities for capturing diffs of BUILDER's changes for code review.
- **testRunner.ts** - Executes test command or prompts user for manual test results.
- **featureTree.ts** - VS Code TreeDataProvider showing features and their artifacts in the Explorer sidebar.
- **workflowStatus.ts** - Reads/writes status files with YAML frontmatter and appends timestamped history lines.

### File Conventions

Feature artifacts in `docs/features/`:

- `<id>.status.md` - YAML frontmatter (id, name, status) + history log
- `<id>.request.md` - Initial feature request from user
- `<id>.spec.md` - Generated specification
- `<id>.spec.review.md` - Review of spec
- `<id>.plan.md` - Generated implementation plan (with phase headers)
- `<id>.plan.review.md` - Review of plan
- `<id>.code.review.p<N>.i<M>.md` - Code review for phase N, iteration M (preserves history)

### Configuration

VS Code settings under `featureWorkflow.*`:

- `reviewerProvider` (default: "openai") - Which provider to use for reviews: `openai` or `claude`
- `maxReviewIterations` (default: 3) - Max ARCHITECT↔REVIEWER review loops for spec/plan
- `sessionTimeoutMinutes` (default: 10) - Claude Code session timeout
- `openaiModel` (default: "gpt-4o") - Model for OpenAI reviews (when `reviewerProvider` is "openai")
- `openaiApiKey` (default: "") - OpenAI API key; falls back to `OPENAI_API_KEY` env var if empty
- `promptOverridesFile` (default: "") - Path to JSON file with custom prompts
- `buildReviewMode` (default: "both") - Who reviews BUILDER code: `openai-only` (primary reviewer only), `architect-only` (Claude REVIEWER only), or `both`
- `testCommand` (default: "") - Command to run tests (e.g., `npm test`). If empty, prompts user
- `maxBuildIterations` (default: 5) - Max review iterations per build phase

### Prompt Customization

Prompts can be overridden per-project via a JSON file specified in `featureWorkflow.promptOverridesFile`. The file can override any of these keys:

**Spec/Plan Phase:**

- `specGenerationSystem` / `specGenerationUser` - Spec generation prompts
- `planGenerationSystem` / `planGenerationUser` - Plan generation prompts
- `specReviewSystem` / `planReviewSystem` - OpenAI review system prompts
- `reviewIncorporation` - Prompt for incorporating review feedback

**Build Phase:**

- `buildPhaseSystem` / `buildPhaseUser` - BUILDER prompts
- `buildReviewIncorporation` - BUILDER feedback incorporation prompt
- `codeReviewSystem` / `codeReviewUser` - OpenAI code review prompts
- `claudeBuilderReviewUser` - Claude REVIEWER code review prompt (used when `buildReviewMode` includes "architect")

**Claude REVIEWER (when `reviewerProvider` is "claude"):**

- `claudeSpecReviewSystem` / `claudeSpecReviewUser` - Claude spec review prompts
- `claudePlanReviewSystem` / `claudePlanReviewUser` - Claude plan review prompts
- `claudeCodeReviewSystem` / `claudeCodeReviewUser` - Claude code review prompts

Template placeholders vary by prompt. See `config.ts:DEFAULT_PROMPTS` for full prompt text and `config.ts:applyTemplate` for substitution logic.

### External Dependencies

- **Claude Code CLI** - Must be installed and in PATH (`claude --version` check in `claudeCode.ts:isClaudeCodeInstalled`). Required for ARCHITECT, BUILDER, and Claude REVIEWER.
- **OpenAI API** - Required only when `reviewerProvider` is "openai". Requires API key via `featureWorkflow.openaiApiKey` setting or `OPENAI_API_KEY` environment variable (checked in `config.ts:getOpenAIApiKey`).

When `reviewerProvider` is "claude", the extension uses only Claude Code CLI (no OpenAI API key needed).

### Review Loop Behavior

**Spec/Plan Reviews:**
- Loop iterates only on **major issues** (blocking problems)
- Minor issues are logged to the review file but don't trigger re-iteration
- Max iterations controlled by `maxReviewIterations` setting

**Code Reviews (Build Phase):**
- **Major issues**: Loop continues until resolved or max iterations
- **Minor issues only**: Allows ONE additional iteration to address them, then stops
- **No issues**: Loop exits immediately
- Review files are preserved with phase/iteration numbers (e.g., `.code.review.p1.i2.md`)

This prevents excessive iteration on trivial suggestions while still allowing important improvements.

### No Target Project Modifications

The extension does NOT install anything in the target project (no scaffolding). All LLM integrations run within the extension itself:

- Claude Code CLI is invoked directly
- OpenAI SDK is bundled with the extension (`openai` in `dependencies`)

Only feature workflow files (`docs/features/*.md`) are created in the target project.
