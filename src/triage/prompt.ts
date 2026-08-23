/**
 * Triage — prompt construction.
 *
 * The category definitions are spelled out deliberately: the whole value of
 * this stage is the distinction between "the app is broken" and "the test is
 * broken", and a vague prompt collapses that distinction into "real_bug" for
 * everything.
 */
import type { RunFailure, TestCase } from '../shared/types.js';

export const TRIAGE_SYSTEM_PROMPT = `You are a senior SDET triaging a failed automated test. Decide why it failed.

Classify into exactly one verdict:

- "real_bug" — the application did the wrong thing. The test's expectation was
  correct and the app failed to meet it. Data was lost, state did not persist,
  validation was missing, or the wrong entity was affected. This is a defect in
  the product, not the test.

- "selector_drift" — the test's assumptions about the UI are stale, but the
  application itself most likely behaves correctly. A button was renamed, a
  data-testid changed, an element moved. The symptom is usually a locator
  resolving to nothing ("strict mode violation", "waiting for locator", zero
  matches) rather than a wrong value. Populate "suggestedFix" with the specific
  locator change you would make.

- "flaky" — the same test would plausibly pass on a re-run with no code change:
  a race with an animation or network request, a timeout that was simply too
  tight, or a transient ordering issue. The evidence must actively suggest
  timing; do not use this as a catch-all.

- "environment_issue" — the failure is about the harness, not the app or test:
  the server was unreachable, a port was in use, a browser failed to launch, a
  dependency was missing.

Judgement rules:
- An assertion that found an element but read the WRONG VALUE is evidence of a
  real bug, not selector drift.
- An assertion that could not find the element AT ALL is evidence of selector
  drift, unless the element's absence is itself the bug the test checks for.
- Set "confidence" honestly. Ambiguous evidence deserves a value near 0.5.
- Keep "reasoning" to one or two sentences a human can scan quickly.

Respond with ONLY a JSON object. No markdown fences, no commentary:

{
  "verdict": "real_bug" | "flaky" | "selector_drift" | "environment_issue",
  "confidence": 0.0,
  "reasoning": "one or two sentences",
  "suggestedFix": "only for selector_drift; omit otherwise"
}`;

export function buildTriagePrompt(failure: RunFailure, testCase: TestCase | undefined): string {
  const intent = testCase
    ? `Test case: ${testCase.title}
Priority: ${testCase.priority}
Route: ${testCase.targetRoute}

What the test intended to verify:
  Given ${testCase.gherkin.given}
  When  ${testCase.gherkin.when}
  Then  ${testCase.gherkin.then}`
    : `Test case id: ${failure.testCaseId} (original intent unavailable)`;

  const dom = failure.domSnapshot
    ? `\n\nDOM of the route at failure time (truncated):\n${failure.domSnapshot.slice(0, 2500)}`
    : '\n\nNo DOM snapshot was captured for this failure.';

  const artifacts = [
    failure.screenshotPath ? `screenshot: ${failure.screenshotPath}` : null,
    failure.tracePath ? `trace: ${failure.tracePath}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${intent}

Playwright error:
"""
${failure.errorMessage}
"""
${artifacts ? `\nArtifacts captured:\n${artifacts}` : ''}${dom}

Classify this failure.`;
}
