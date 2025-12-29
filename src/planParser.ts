import * as fs from "fs/promises";

/**
 * Represents a phase extracted from an implementation plan
 */
export interface Phase {
  number: number;
  description: string;
  content: string;  // Full phase content for context
}

/**
 * Parse an implementation plan file and extract phases
 *
 * Phases are expected to be marked with headers like:
 * ## Phase 1: Description
 * ## Phase 2: Another Description
 */
export async function parsePlanPhases(planPath: string): Promise<Phase[]> {
  const content = await fs.readFile(planPath, "utf8");
  return parsePlanPhasesFromContent(content);
}

/**
 * Parse phases from plan content string
 */
export function parsePlanPhasesFromContent(content: string): Phase[] {
  const phases: Phase[] = [];

  // Match "## Phase N: Description" headers
  // Also support "## Phase N - Description" and "## Phase N. Description"
  const phaseRegex = /^##\s*Phase\s+(\d+)\s*[:.\-–—]\s*(.+)$/gim;

  const lines = content.split("\n");
  let currentPhase: Phase | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s*Phase\s+(\d+)\s*[:.\-–—]\s*(.+)$/i);

    if (match) {
      // Save previous phase if exists
      if (currentPhase) {
        currentPhase.content = currentContent.join("\n").trim();
        phases.push(currentPhase);
      }

      // Start new phase
      currentPhase = {
        number: parseInt(match[1], 10),
        description: match[2].trim(),
        content: "",
      };
      currentContent = [line];
    } else if (currentPhase) {
      // Accumulate content for current phase
      currentContent.push(line);
    }
  }

  // Don't forget the last phase
  if (currentPhase) {
    currentPhase.content = currentContent.join("\n").trim();
    phases.push(currentPhase);
  }

  // Sort phases by number (in case they're out of order)
  phases.sort((a, b) => a.number - b.number);

  return phases;
}

/**
 * Get a specific phase by number
 */
export async function getPhase(planPath: string, phaseNumber: number): Promise<Phase | undefined> {
  const phases = await parsePlanPhases(planPath);
  return phases.find(p => p.number === phaseNumber);
}

/**
 * Get total number of phases in a plan
 */
export async function getPhaseCount(planPath: string): Promise<number> {
  const phases = await parsePlanPhases(planPath);
  return phases.length;
}
