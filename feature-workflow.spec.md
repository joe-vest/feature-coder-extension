# Feature Workflow Extension - Specification

## Overview

A VS Code extension that manages an LLM-assisted development workflow for software features. Each feature has a lifecycle tracked via a status file (`*.status.md`). The extension displays features and their workflow artifacts in a tree view panel and provides commands to execute workflow steps.

**Key Architecture:**

- **Claude Code CLI** handles generation tasks (spec, plan, code implementation) - invoked directly via `spawn("claude", ...)`
- **OpenAI SDK** handles reviews (spec, plan, code) - bundled within the extension, no external scripts
- **Review loops** feed OpenAI feedback back into the same Claude Code session for iterative refinement
- **Human checkpoints** gate progression between major phases
- **Two Claude Personas**: ARCHITECT (specs/plans) and BUILDER (code implementation)

**No Target Project Modifications:** The extension does NOT scaffold scripts or modify the target project's `package.json`. All LLM integrations run within the extension itself. Only feature workflow files (`docs/features/*.md`) are created in the target project.

---

## 1. Feature Artifacts

All feature data lives under:

```
docs/features/<feature-id>.*.md
```

Each feature consists of:

| File                   | Owned by        | Purpose                        |
| ---------------------- | --------------- | ------------------------------ |
| `<id>.status.md`       | Extension       | Status and workflow history    |
| `<id>.request.md`      | Human           | Feature description            |
| `<id>.spec.md`         | ARCHITECT       | Feature specification          |
| `<id>.spec.review.md`  | OpenAI Reviewer | Spec critique                  |
| `<id>.plan.md`         | ARCHITECT       | Implementation plan with phases|
| `<id>.plan.review.md`  | OpenAI Reviewer | Plan critique                  |
| `<id>.code.review.md`  | OpenAI/ARCHITECT| Code review feedback           |

---

## 2. Status Machine

Valid status values in `.status.md` frontmatter:

```
requested → draft → spec-reviewed → plan-created → plan-reviewed → ready-for-build → building → code-review → testing → implemented
```

### State Transitions

| From            | To              | Trigger                          | Actor   |
| --------------- | --------------- | -------------------------------- | ------- |
| (none)          | requested       | New Feature command              | User    |
| requested       | draft           | Generate Spec (with review loop) | ARCHITECT |
| draft           | spec-reviewed   | Mark Spec Approved               | User    |
| spec-reviewed   | plan-created    | Generate Plan (with review loop) | ARCHITECT |
| plan-created    | plan-reviewed   | Mark Plan Approved               | User    |
| plan-reviewed   | ready-for-build | Mark Ready for Build             | User    |
| ready-for-build | building        | Start Build                      | BUILDER |
| building        | code-review     | Build phases complete            | System  |
| code-review     | testing         | Run Tests                        | User    |
| code-review     | building        | Reject Build                     | User    |
| testing         | implemented     | Approve Build                    | User    |
| testing         | building        | Reject Build                     | User    |

---

## 3. Two Claude Personas

The extension uses two distinct Claude Code sessions with different roles:

| Persona      | Role                                              | Session Scope          |
| ------------ | ------------------------------------------------- | ---------------------- |
| **ARCHITECT**| Creates specs and plans; optionally reviews code  | Spec/Plan generation   |
| **BUILDER**  | Implements code from approved plan                | Build phase only       |

Both use Claude Code CLI but with different system prompts and session contexts.

---

## 4. Status File Format

**File:** `docs/features/<id>.status.md`

**Frontmatter:**

```yaml
---
id: <id>
name: <Friendly name>
status: <status-value>
created_at: <timestamp>
---
```

**Body:** History log (most recent first)

```
<ISO timestamp>  [<source>]  <message>
```

Valid `source` values: `system`, `user`, `openai`, `claude`

**Example:**

```
2025-03-01T12:00:00Z  [system]  Build approved, marked as implemented
2025-03-01T11:55:00Z  [system]  Tests passed
2025-03-01T11:50:00Z  [openai]  Code review (iteration 1): no major issues
2025-03-01T11:45:00Z  [claude]  BUILDER completed Phase 2
2025-03-01T11:30:00Z  [claude]  BUILDER completed Phase 1
2025-03-01T11:00:00Z  [system]  Starting build with 2 phase(s)
2025-03-01T10:05:01Z  [system]  Plan generation complete
2025-03-01T10:05:00Z  [openai]  Plan review (iteration 2): no major issues
2025-03-01T10:00:00Z  [system]  Starting plan generation
2025-03-01T09:00:00Z  [system]  Created feature
```

---

## 5. Spec/Plan Generation + Review Loop

For both spec and plan generation, the workflow follows this pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│  ARCHITECT Claude Code Session (persistent, has codebase context)│
│                                                                 │
│  1. Initial prompt: "Generate spec/plan from <input>"           │
│     └─► Claude Code explores codebase, writes artifact          │
│                                                                 │
│  2. OpenAI reviews artifact (SDK call within extension)         │
│     └─► Writes <artifact>.review.md                             │
│                                                                 │
│  3. Review fed back to SAME Claude Code session:                │
│     "Here is the review: <content>. Address any issues."        │
│     └─► Claude Code updates artifact                            │
│                                                                 │
│  4. Repeat steps 2-3 until:                                     │
│     - OpenAI gives clean review (no major issues), OR           │
│     - Max iterations reached (default: 3)                       │
│                                                                 │
│  5. Session ends, status advances                               │
└─────────────────────────────────────────────────────────────────┘
```

### Plan Phase Requirements

Plans must include phases marked with headers:

```markdown
## Phase 1: Setup database models
...
## Phase 2: Implement API endpoints
...
## Phase 3: Add frontend components
```

Each phase should be:
- A coherent unit of work reviewable independently
- Small enough to review effectively (typically 1-3 files)
- Large enough to be meaningful

---

## 6. Build Phase

Once a plan is approved and marked ready for build, the BUILDER implements the code:

```
┌─────────────────────────────────────────────────────────────────┐
│  BUILDER Claude Code Session (persistent across all phases)      │
│                                                                 │
│  For each Phase in plan:                                        │
│                                                                 │
│  1. Prompt: "Implement Phase N: <description>"                  │
│     └─► BUILDER writes code to appropriate files                │
│                                                                 │
│  2. Git diff captured (staged changes)                          │
│                                                                 │
│  3. OpenAI reviews code diff against spec + plan                │
│     └─► Writes <id>.code.review.md                              │
│                                                                 │
│  4. (Optional) ARCHITECT reviews code diff                      │
│     └─► Feedback appended to review                             │
│                                                                 │
│  5. If major issues:                                            │
│     └─► Feedback sent to BUILDER, loop repeats (max 5 times)    │
│                                                                 │
│  6. Phase complete, move to next phase                          │
│                                                                 │
│  After all phases: status → code-review                         │
└─────────────────────────────────────────────────────────────────┘
```

### Code Review Context

OpenAI code review receives:
- Git diff of changes (`git diff --staged`)
- Feature specification content
- Implementation plan content
- BUILDER's intent summary

This diff-based approach is token-efficient and focuses review on actual changes.

### Build Review Mode

Configurable via `buildReviewMode` setting:
- `openai-only` - Only OpenAI reviews BUILDER's code
- `architect-only` - Only ARCHITECT reviews BUILDER's code
- `both` (default) - Both review in sequence

---

## 7. Testing Phase

After build completes, tests can be run:

- If `testCommand` is configured (e.g., `npm test`), runs automatically
- If not configured, user is prompted to run tests manually and report results

Test results determine next action:
- **Pass**: User can approve build → `implemented`
- **Fail**: User can reject build → back to `building`

---

## 8. VS Code UI

### Tree View

Name: **Feature Workflow** (in Explorer sidebar)

- Root nodes: Features loaded from `*.status.md`
- Label format: `<name> <emoji> [<status>]`
- Children: Existing artifact files only

Status emojis:

| Status          | Emoji |
| --------------- | ----- |
| requested       | 📋    |
| draft           | 📝    |
| spec-reviewed   | ✅    |
| plan-created    | 📐    |
| plan-reviewed   | ✅    |
| ready-for-build | 🔨    |
| building        | 🏗️    |
| code-review     | 🔍    |
| testing         | 🧪    |
| implemented     | ✔️    |

Clicking a file opens it in an editor.

### Commands

Commands appear in the feature context menu and enable/disable based on current status.

| Command              | ID                                | Enablement                | Action                            |
| -------------------- | --------------------------------- | ------------------------- | --------------------------------- |
| New Feature          | featureWorkflow.newFeature        | Always                    | Create status + request files     |
| Generate Spec        | featureWorkflow.generateSpec      | status == requested       | ARCHITECT + review loop → draft   |
| Mark Spec Approved   | featureWorkflow.markSpecApproved  | status == draft           | → spec-reviewed                   |
| Generate Plan        | featureWorkflow.generatePlan      | status == spec-reviewed   | ARCHITECT + review loop → plan-created |
| Mark Plan Approved   | featureWorkflow.markPlanApproved  | status == plan-created    | → plan-reviewed                   |
| Mark Ready for Build | featureWorkflow.markReadyForBuild | status == plan-reviewed   | → ready-for-build                 |
| Start Build          | featureWorkflow.startBuild        | status == ready-for-build | BUILDER implements → building     |
| Run Code Review      | featureWorkflow.runCodeReview     | status == building        | → code-review                     |
| Run Tests            | featureWorkflow.runTests          | status == code-review     | → testing                         |
| Approve Build        | featureWorkflow.approveBuild      | status == testing         | → implemented                     |
| Reject Build         | featureWorkflow.rejectBuild       | status == code-review OR testing | → building               |

### View Title Actions

- **New Feature** button (+ icon)
- **Refresh** button (refresh icon)

---

## 9. Configuration

VS Code settings under `featureWorkflow.*`:

| Setting                | Type   | Default  | Description                                   |
| ---------------------- | ------ | -------- | --------------------------------------------- |
| `maxReviewIterations`  | number | 3        | Max Claude-OpenAI review loops for spec/plan  |
| `sessionTimeoutMinutes`| number | 10       | Timeout for Claude Code sessions              |
| `openaiModel`          | string | "gpt-4o" | OpenAI model for reviews                      |
| `openaiApiKey`         | string | ""       | API key (falls back to OPENAI_API_KEY env var)|
| `promptOverridesFile`  | string | ""       | Path to JSON file with custom prompts         |
| `buildReviewMode`      | string | "both"   | Who reviews code: openai-only, architect-only, both |
| `testCommand`          | string | ""       | Command to run tests. If empty, prompts user  |
| `maxBuildIterations`   | number | 5        | Max review iterations per build phase         |

### Prompt Customization

Prompts can be overridden per-project via a JSON file specified in `promptOverridesFile`:

**Spec/Plan Phase:**
- `specGenerationUser` - Spec generation prompt (`{featureId}`, `{requestPath}`)
- `planGenerationUser` - Plan generation prompt (`{featureId}`, `{specPath}`)
- `specReviewSystem` - System prompt for spec review
- `planReviewSystem` - System prompt for plan review
- `reviewIncorporation` - Feedback incorporation (`{artifactType}`, `{reviewContent}`)

**Build Phase:**
- `buildPhaseSystem` - System prompt for BUILDER
- `buildPhaseUser` - Build phase prompt (`{planPath}`, `{phaseNumber}`, `{phaseDescription}`)
- `buildReviewIncorporation` - Build feedback (`{phaseNumber}`, `{reviewContent}`)
- `codeReviewSystem` - System prompt for code reviews
- `codeReviewUser` - Code review prompt (`{specContent}`, `{planContent}`, `{gitDiff}`, `{intentSummary}`)
- `architectCodeReviewUser` - ARCHITECT review (`{planPath}`, `{phaseNumber}`, `{diffSummary}`)

---

## 10. OpenAI Review Formats

Reviews use structured JSON output (`response_format: { type: "json_object" }`).

### Spec Review Response

```json
{
  "hasMajorIssues": true,
  "summary": "...",
  "majorIssues": ["issue 1", "issue 2"],
  "minorIssues": ["suggestion 1"],
  "questions": ["clarification needed"],
  "missingRequirements": [],
  "securityRisks": []
}
```

### Plan Review Response

```json
{
  "hasMajorIssues": true,
  "summary": "...",
  "majorIssues": ["issue 1"],
  "minorIssues": ["suggestion 1"],
  "missingSteps": [],
  "riskAssessment": "...",
  "testabilityConcerns": []
}
```

### Code Review Response

```json
{
  "hasMajorIssues": true,
  "summary": "...",
  "majorIssues": ["blocking problem"],
  "minorIssues": ["suggestion"],
  "securityConcerns": ["potential vulnerability"],
  "missingFromPlan": ["unimplemented task"],
  "testingSuggestions": ["add unit test for..."]
}
```

Reviews are converted to human-readable markdown and written to `*.review.md` files.

---

## 11. External Dependencies

- **Claude Code CLI** - Must be installed and in PATH. Checked via `claude --version`.
- **OpenAI API** - Requires API key via setting or `OPENAI_API_KEY` environment variable.
- **Git** - Required for build phase to capture code diffs for review.

---

## 12. Error Handling

| Error                     | Behavior                                          |
| ------------------------- | ------------------------------------------------- |
| Claude Code not installed | Show error with install link                      |
| Claude Code session fails | Log error, keep current status, show notification |
| OpenAI API key missing    | Show error, abort generation                      |
| OpenAI API call fails     | Log error, continue without review (warn user)    |
| Max iterations with issues| Warn user, advance status anyway                  |
| Git not available         | Show error, abort build phase                     |
| No phases in plan         | Show warning, abort build                         |
| Test command fails        | Show warning, let user decide next action         |

---

## 13. Extension Files

| File                 | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `extension.ts`       | Activation, command registration, tree view setup    |
| `featureModel.ts`    | Feature type definitions, status loading             |
| `featureTree.ts`     | TreeDataProvider for Feature Workflow panel          |
| `workflowCommands.ts`| Command implementations                              |
| `workflowStatus.ts`  | Status file reading/writing                          |
| `claudeCode.ts`      | Claude Code CLI invocation wrapper                   |
| `openaiReview.ts`    | OpenAI SDK review calls for spec/plan                |
| `reviewLoop.ts`      | Orchestrates Claude-OpenAI review loop for spec/plan |
| `config.ts`          | Settings access, prompt overrides                    |
| `buildLoop.ts`       | Orchestrates BUILDER phase with code review loop     |
| `codeReview.ts`      | OpenAI SDK code review calls                         |
| `planParser.ts`      | Extracts phases from plan files                      |
| `gitUtils.ts`        | Git utilities for diff capture                       |
| `testRunner.ts`      | Test execution and result handling                   |

---

## Appendix: Full Workflow Sequence Diagram

```
User          Extension       ARCHITECT         OpenAI          BUILDER
 |                |                |               |               |
 |--[New Feature]-->|             |               |               |
 |<--[status: requested]--|       |               |               |
 |                |                |               |               |
 |--[Generate Spec]-->|           |               |               |
 |                |--[prompt]----->|              |               |
 |                |<--[spec.md]----|              |               |
 |                |--[review]-------------------->|               |
 |                |<--[review JSON]---------------|               |
 |                |--[incorporate]-->|            |               |
 |                |<--[spec.md updated]--|        |               |
 |                |--[review]-------------------->|               |
 |                |<--["No issues"]---------------|               |
 |<--[status: draft]--|            |               |               |
 |                |                |               |               |
 |--[Mark Spec Approved]-->|      |               |               |
 |<--[status: spec-reviewed]--|   |               |               |
 |                |                |               |               |
 |--[Generate Plan]-->|           |               |               |
 |                |--[prompt]----->|              |               |
 |                |<--[plan.md]----|              |               |
 |                |    (similar review loop)      |               |
 |<--[status: plan-created]--|    |               |               |
 |                |                |               |               |
 |--[Mark Plan Approved]-->|      |               |               |
 |--[Mark Ready for Build]-->|    |               |               |
 |<--[status: ready-for-build]--| |               |               |
 |                |                |               |               |
 |--[Start Build]-->|             |               |               |
 |                |--[Phase 1 prompt]-------------------------->|
 |                |<--[code written]-----------------------------|
 |                |--[git diff]--------------------------------->|
 |                |--[code review]------------>|               |
 |                |<--[review JSON]------------|               |
 |                |    (optionally ARCHITECT reviews too)       |
 |                |--[Phase 2 prompt]-------------------------->|
 |                |    (repeat for all phases)                  |
 |<--[status: code-review]--|     |               |               |
 |                |                |               |               |
 |--[Run Tests]-->|               |               |               |
 |<--[test results]--|            |               |               |
 |<--[status: testing]--|         |               |               |
 |                |                |               |               |
 |--[Approve Build]-->|           |               |               |
 |<--[status: implemented]--|     |               |               |
```
