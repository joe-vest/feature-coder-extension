# Feature Workflow

A VS Code extension that orchestrates LLM-assisted feature development through a structured workflow. It uses **three Claude personas** (ARCHITECT, BUILDER, and optionally REVIEWER) with a configurable review provider (OpenAI or Claude) to take features from initial request through specification, planning, implementation, and testing.

## Why This Extension?

Modern LLM-assisted development often lacks structure. Developers prompt an AI, get code, and hope it works. This extension introduces a **formal workflow** with:

- **Separation of concerns**: ARCHITECT designs, BUILDER implements
- **Review gates**: Configurable reviewer (OpenAI or Claude) catches major issues early
- **Traceable artifacts**: Every feature has status files, specs, plans, and reviews
- **Phase-based implementation**: Complex features are built incrementally with review cycles

The result is higher quality code with full auditability of the AI-assisted development process.

## Workflow Overview

```
                        ┌─────────────────────────────────────────┐
                        │           FEATURE WORKFLOW              │
                        └─────────────────────────────────────────┘

    📋 requested ──→ 📝 draft ──→ ✅ spec-reviewed ──→ 📐 plan-created
         │              │              │                    │
         │         [ARCHITECT]    [REVIEWER]           [ARCHITECT]
         │         Generates      Reviews spec         Generates
         │         spec.md                             plan.md
         │                                                  │
         │                                                  ▼
         │                                        ✅ plan-reviewed
         │                                             │
         │                                        [REVIEWER]
         │                                        Reviews plan
         │                                             │
         │                                             ▼
         │                                        🔨 ready-for-build
         │                                             │
         │                                        [User approves]
         │                                             │
         │    ┌────────────────────────────────────────┘
         │    │
         │    ▼
         │  🏗️ building ◄──────────────────────────┐
         │       │                                  │
         │  [BUILDER implements phase]              │
         │       │                                  │
         │       ▼                                  │
         │  🔍 code-review                          │
         │       │                                  │
         │  [REVIEWER + ARCHITECT review]           │
         │       │                                  │
         │       ├── Issues found ─────────────────►┘
         │       │
         │       ▼
         │  🧪 testing
         │       │
         │  [Run tests]
         │       │
         │       ├── Tests fail ───────────────────►┘
         │       │
         │       ▼
         └──► ✔️ implemented
```

## Three Claude Personas

The extension uses Claude Code CLI with three distinct personas:

| Persona | Role | When Used |
|---------|------|-----------|
| **ARCHITECT** | Designs specifications and implementation plans. Understands the big picture. Optionally reviews BUILDER's code for architectural alignment. | Spec generation, plan generation, optional code review |
| **BUILDER** | Implements code from approved plans. Focuses on one phase at a time. Incorporates review feedback. | Build phase only |
| **REVIEWER** | Provides independent review of specs, plans, and code. Uses fresh sessions for objectivity. | When `reviewerProvider` is set to `claude` |

All personas use the same Claude Code CLI but with different system prompts and contexts. This separation prevents the "context pollution" that happens when a single AI session tries to both design and implement.

When `reviewerProvider` is set to `openai` (the default), OpenAI API is used for reviews instead of Claude REVIEWER.

## Prerequisites

1. **Claude Code CLI** - Install from [Anthropic](https://docs.anthropic.com/en/docs/claude-code)
   ```bash
   # Verify installation
   claude --version
   ```

2. **Reviewer Configuration** - Choose one:
   - **OpenAI (default)**: Set `OPENAI_API_KEY` environment variable or `featureWorkflow.openaiApiKey` in settings
   - **Claude**: Set `featureWorkflow.reviewerProvider` to `"claude"` (no additional API key needed)

3. **Git** - Required for diff-based code review during build phase

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/your-username/feature-workflow.git
cd feature-workflow

# Install dependencies
npm install

# Compile
npm run compile

# Package (optional)
npx vsce package
```

### Development Mode

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. The extension activates when you open a workspace

## Quick Start

1. **Create a feature request**
   - Create `docs/features/my-feature.request.md` with your feature description
   - Or use the command palette: `Feature Workflow: Request Feature`

2. **Generate specification**
   - Right-click the feature in the tree view
   - Select "Generate Spec"
   - ARCHITECT creates `my-feature.spec.md`
   - REVIEWER automatically reviews, iterating only on **major issues**

3. **Review and approve spec**
   - Check `my-feature.spec.review.md` for reviewer feedback
   - Minor issues are logged but not auto-incorporated—review manually
   - Approve via "Approve Spec" command

4. **Generate implementation plan**
   - "Generate Plan" creates `my-feature.plan.md`
   - Plan includes numbered phases for incremental implementation

5. **Build the feature**
   - "Start Build" triggers BUILDER to implement each phase
   - Code is reviewed after each phase
   - Issues trigger revision cycles

6. **Test and complete**
   - Run tests (configured command or manual)
   - "Approve Build" marks feature as implemented

## Configuration

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `featureWorkflow.reviewerProvider` | Which provider for reviews: `openai` or `claude` | `openai` |
| `featureWorkflow.openaiApiKey` | OpenAI API key (when using OpenAI reviewer) | `$OPENAI_API_KEY` |
| `featureWorkflow.openaiModel` | OpenAI model for reviews | `gpt-4o` |
| `featureWorkflow.promptOverridesFile` | Custom prompts JSON file | (none) |
| `featureWorkflow.buildReviewMode` | Review mode: `openai-only` (uses configured reviewer), `architect-only`, `both` | `both` |
| `featureWorkflow.testCommand` | Test command (empty = manual) | (empty) |
| `featureWorkflow.maxBuildIterations` | Max review cycles per phase | `5` |

> **Note on Review Behavior:** The review loop only iterates when **major issues** are found. Minor issues and recommendations are written to the review file but not automatically sent back to ARCHITECT/BUILDER for incorporation. This keeps the loop efficient while preserving all feedback for human review.

### Custom Prompts

Create a JSON file with prompt overrides:

```json
{
  "specGenerationSystem": "You are a senior software architect...",
  "buildPhaseUser": "Implement phase {phaseNumber}..."
}
```

Set `featureWorkflow.promptOverridesFile` to the file path.

Available prompt keys:

**Generation & OpenAI Review:**
- `specGenerationSystem`, `specGenerationUser`
- `specReviewSystem`, `specReviewUser`
- `planGenerationSystem`, `planGenerationUser`
- `planReviewSystem`, `planReviewUser`
- `buildPhaseSystem`, `buildPhaseUser`
- `buildReviewIncorporation`
- `codeReviewSystem`, `codeReviewUser`
- `architectCodeReviewUser`

**Claude REVIEWER (when `reviewerProvider` is "claude"):**
- `claudeSpecReviewSystem`, `claudeSpecReviewUser`
- `claudePlanReviewSystem`, `claudePlanReviewUser`
- `claudeCodeReviewSystem`, `claudeCodeReviewUser`

## Feature Artifacts

Each feature generates these files in `docs/features/`:

| File | Purpose |
|------|---------|
| `<id>.request.md` | Initial feature request |
| `<id>.status.md` | Current status and history (source of truth) |
| `<id>.spec.md` | Detailed specification |
| `<id>.spec.review.md` | REVIEWER's spec review |
| `<id>.plan.md` | Implementation plan with phases |
| `<id>.plan.review.md` | REVIEWER's plan review |
| `<id>.code.review.md` | Code review feedback |

### Status File Format

```yaml
---
id: my-feature
name: My Feature
status: building
owner: developer-name
---
2024-01-15T10:30:00.000Z  [system]  Starting Phase 1: Core implementation
2024-01-15T10:25:00.000Z  [claude]  BUILDER completed initial implementation
2024-01-15T10:20:00.000Z  [openai]  Code review: approved   # or [claude-reviewer] if using Claude
```

## Architecture

```
src/
├── extension.ts          # Extension entry point, command registration
├── featureModel.ts       # Feature types, status machine, transitions
├── featureTree.ts        # TreeDataProvider for feature explorer
├── workflowCommands.ts   # Command implementations
├── workflowStatus.ts     # Status file read/write operations
├── claudeCode.ts         # Claude Code CLI wrapper
├── openaiReview.ts       # OpenAI review (spec/plan)
├── claudeReview.ts       # Claude Code review (when reviewerProvider is "claude")
├── codeReview.ts         # Unified code review interface (routes to OpenAI or Claude)
├── buildLoop.ts          # Build phase orchestration
├── reviewLoop.ts         # ARCHITECT + REVIEWER loop orchestration
├── planParser.ts         # Extract phases from plan.md
├── testRunner.ts         # Test execution
├── gitUtils.ts           # Git diff capture
├── config.ts             # Settings and prompt management
└── utils/
    ├── fs.ts             # File system utilities
    └── yaml.ts           # YAML frontmatter parsing
```

### Key Design Decisions

1. **Status files as source of truth**: Each feature's state is stored in a YAML-frontmatter markdown file. This makes state human-readable and git-trackable.

2. **Git diff for code review**: Instead of sending full files to the reviewer, we send `git diff --staged`. This is more token-efficient and focuses the reviewer on actual changes.

3. **Phase-based implementation**: ARCHITECT defines phases in the plan with `## Phase N: Description` headers. BUILDER implements one phase at a time, allowing targeted review cycles.

4. **Separate sessions for each persona**: ARCHITECT, BUILDER, and REVIEWER each get their own Claude Code session to prevent context mixing. BUILDER maintains session continuity across phases; REVIEWER gets fresh sessions for objectivity.

5. **Configurable reviewer provider**: Choose between OpenAI (structured JSON output) or Claude (markdown output) for reviews. Teams without OpenAI API access can use Claude-only mode.

6. **Configurable review chain**: Some teams want only the configured reviewer, some want ARCHITECT review (architectural consistency), some want both.

## Commands

| Command | Description |
|---------|-------------|
| `featureWorkflow.requestFeature` | Create a new feature request |
| `featureWorkflow.generateSpec` | Generate specification from request |
| `featureWorkflow.reviewSpec` | Run review on spec |
| `featureWorkflow.approveSpec` | Approve spec, advance to plan phase |
| `featureWorkflow.generatePlan` | Generate implementation plan |
| `featureWorkflow.reviewPlan` | Run review on plan |
| `featureWorkflow.approvePlan` | Approve plan, advance to ready-for-build |
| `featureWorkflow.markReadyForBuild` | Mark feature ready for building |
| `featureWorkflow.startBuild` | Start BUILDER implementation |
| `featureWorkflow.runCodeReview` | Manually trigger code review |
| `featureWorkflow.runTests` | Run configured test command |
| `featureWorkflow.approveBuild` | Mark feature as implemented |
| `featureWorkflow.rejectBuild` | Return to building with feedback |
| `featureWorkflow.refreshTree` | Refresh feature tree view |
| `featureWorkflow.openArtifact` | Open a feature artifact file |

## Extending the Extension

### Adding New Status States

1. Add the state to `FeatureStatus` type in `featureModel.ts`
2. Update `allowedTransitions` with valid transitions
3. Add icon to `statusIcons` in `featureTree.ts`

### Adding New Prompts

1. Add the prompt key to `PromptOverrides` interface in `config.ts`
2. Add default text to `DEFAULT_PROMPTS`
3. Use `getPrompt(key)` and `applyTemplate(template, vars)` in your code

### Adding New Commands

1. Add command to `package.json` in `contributes.commands`
2. Add enablement condition if needed
3. Add menu item in `contributes.menus`
4. Implement handler in `workflowCommands.ts`
5. Register in `extension.ts`

## Testing Status

- **TypeScript compilation**: Passes
- **Unit tests**: Not yet implemented
- **Integration testing needed**:
  - End-to-end workflow (request → implemented)
  - Claude Code CLI invocation
  - OpenAI API integration (when using OpenAI reviewer)
  - Claude REVIEWER integration (when using Claude reviewer)
  - Git diff capture
  - VS Code extension activation

## Contributing

Contributions are welcome! Areas that could use help:

- Unit tests for core modules
- Integration test framework
- Additional reviewer providers (Gemini, local models, etc.)
- UI improvements (webview for status visualization)

## License

MIT

## Acknowledgments

This extension demonstrates a pattern for structured LLM-assisted development. It was built using Claude Code and represents an example of AI-assisted software engineering with proper workflow controls.

---

**Note**: This is an experimental extension. The LLM landscape evolves rapidly; prompts and workflows may need adjustment as models improve.
