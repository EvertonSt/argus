import { describe, it, expect } from 'vitest';
import type { FeatureInventory, TestCase } from '../../src/shared/types';

/**
 * Verifies coverage gap identification: uncovered features are surfaced.
 */
describe('coverage gap identification', () => {
  const inventory: FeatureInventory = {
    source: 'crawl',
    features: [
      { id: 'f1', name: 'Task list', description: 'View tasks', routes: ['/'] },
      { id: 'f2', name: 'Add task form', description: 'Create tasks', routes: ['/'] },
      { id: 'f3', name: 'Task filtering', description: 'Filter by status', routes: ['/'] },
      { id: 'f4', name: 'Search', description: 'Search tasks', routes: ['/'] },
    ],
  };

  const testCases: TestCase[] = [
    {
      id: 'tc-1',
      featureId: 'f1',
      title: 'Task list displays',
      priority: 'high',
      gherkin: { given: 'tasks exist', when: 'I view the list', then: 'they appear' },
      targetRoute: '/',
    },
    {
      id: 'tc-2',
      featureId: 'f2',
      title: 'Add task form',
      priority: 'critical',
      gherkin: { given: 'empty input', when: 'I submit', then: 'no task is created' },
      targetRoute: '/',
    },
    {
      id: 'tc-3',
      featureId: 'f1',
      title: 'Task list empty state',
      priority: 'low',
      gherkin: { given: 'no tasks', when: 'I view the list', then: 'empty message shows' },
      targetRoute: '/',
    },
  ];

  it('identifies uncovered features', () => {
    const testedIds = new Set(testCases.map((tc) => tc.featureId));
    const uncovered = inventory.features.filter((f) => !testedIds.has(f.id));
    expect(uncovered).toHaveLength(2);
    expect(uncovered.map((f) => f.name)).toEqual(['Task filtering', 'Search']);
  });

  it('counts covered vs total', () => {
    const covered = new Set(testCases.map((tc) => tc.featureId)).size;
    expect(covered).toBe(2); // f1 and f2
    expect(inventory.features.length).toBe(4);
  });

  it('handles full coverage', () => {
    const fullTestCases = [
      ...testCases,
      {
        id: 'tc-4',
        featureId: 'f3',
        title: 'Filter tasks',
        priority: 'medium',
        gherkin: { given: 'tasks with statuses', when: 'I filter', then: 'results match' },
        targetRoute: '/',
      },
      {
        id: 'tc-5',
        featureId: 'f4',
        title: 'Search tasks',
        priority: 'medium',
        gherkin: { given: 'tasks exist', when: 'I search', then: 'matches show' },
        targetRoute: '/',
      },
    ];
    const testedIds = new Set(fullTestCases.map((tc) => tc.featureId));
    const uncovered = inventory.features.filter((f) => !testedIds.has(f.id));
    expect(uncovered).toHaveLength(0);
  });
});
