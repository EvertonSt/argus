/**
 * Planner — prompt construction.
 *
 * Ported from the AI Test Case Generator's `buildTestCasePrompt`. The original
 * took a single free-text feature description and asked for Gherkin cases;
 * this version takes a whole FeatureInventory, pins the output to Argus's
 * TestCase schema, and adds explicit prioritisation guidance so the model
 * ranks cases the way an SDET would rather than labelling everything "high".
 */
import type { FeatureInventory } from '../shared/types.js';

export const PLANNER_SYSTEM_PROMPT = `You are a senior SDET planning a regression suite for a web application.
You write test cases that a machine will turn directly into Playwright code, so
precision matters more than prose.

Rules you must follow:
- Respond with ONLY a valid JSON array. No markdown fences, no commentary, no
  explanation before or after.
- Every "featureId" must be copied exactly from the inventory you are given.
- Prioritise like an experienced SDET, not by labelling everything important:
  * "critical" — the core action the application exists to perform, and any
    flow whose failure means data loss or an unusable app.
  * "high"     — important supporting flows and state that must persist.
  * "medium"   — input validation, edge cases, empty states.
  * "low"      — cosmetic details and secondary information displays.
  A realistic suite has few critical cases and several medium ones.
- Write each Gherkin clause as one concrete, mechanical action or assertion.
  Good: "click the button labelled \\"Add task\\"".
  Bad:  "the user interacts with the form appropriately".
- Reference real UI text and selectors from the inventory wherever given.
- Cover the happy path first, then persistence, then validation and edge cases.`;

export function buildPlannerPrompt(inventory: FeatureInventory, maxCases: number): string {
  const features = inventory.features
    .map((feature) => {
      const selectors = feature.keySelectors?.length
        ? `\n  known selectors: ${feature.keySelectors.join(', ')}`
        : '';
      return `- id: ${feature.id}
  name: ${feature.name}
  routes: ${feature.routes.join(', ')}
  description: ${feature.description}${selectors}`;
    })
    .join('\n');

  return `Feature inventory (source: ${inventory.source}):

${features}

Produce at most ${maxCases} test cases covering these features.

Return a JSON array where each element has exactly this shape:

[
  {
    "id": "kebab-case-identifier",
    "featureId": "<one of the ids above, copied exactly>",
    "title": "short human-readable test case title",
    "priority": "critical" | "high" | "medium" | "low",
    "gherkin": {
      "given": "the starting state",
      "when": "the single action taken",
      "then": "the observable expected outcome"
    },
    "targetRoute": "the route the test starts on, e.g. /"
  }
]

Respond with the JSON array and nothing else.`;
}

/** Retry prompt: the original request plus precisely what was wrong. */
export function buildRetryPrompt(originalPrompt: string, issues: string): string {
  return `${originalPrompt}

---

Your previous response was rejected by schema validation with these problems:

${issues}

Return a corrected JSON array that fixes every problem listed above. Respond
with the JSON array and nothing else.`;
}
