import { describe, it, expect } from 'vitest';
import { compileClause } from '../../src/codegen/templates';

describe('security + accessibility template rules', () => {
  describe('reject-empty-input', () => {
    it('generates expect(input).toHaveValue() for empty input rejection', () => {
      const result = compileClause('We reject empty input submissions');
      expect(result.unmatched).toHaveLength(0);
      expect(result.steps[0]!.code).toContain('expect(input).toHaveValue()');
      expect(result.steps[0]!.rule).toBe('reject-empty-input');
    });

    it('matches "guard against empty input"', () => {
      const result = compileClause('Guard against empty input names');
      expect(result.steps[0]!.rule).toBe('reject-empty-input');
    });
  });

  describe('validate-email-format', () => {
    it('generates email format validation', () => {
      // Use "that" to match the regex: (?:that\s+an?)?
      const result = compileClause('We validate that an email format is correct');
      expect(result.unmatched).toHaveLength(0);
      expect(result.steps[0]!.rule).toBe('validate-email-format');
      expect(result.steps[0]!.code).toContain('page.getByLabelText');
    });

    it('generates email validation without "that"', () => {
      const result = compileClause('Check the email format on the form');
      expect(result.steps[0]!.rule).toBe('validate-email-format');
    });
  });

  describe('require-https', () => {
    it('generates HTTPS URL validation', () => {
      const result = compileClause('We require https for the application');
      expect(result.unmatched).toHaveLength(0);
      expect(result.steps[0]!.rule).toBe('require-https');
      expect(result.steps[0]!.code).toContain('page.url()');
    });
  });

  describe('accessible-name', () => {
    it('generates accessible name check', () => {
      const result = compileClause('We check for an accessible name on the button');
      expect(result.unmatched).toHaveLength(0);
      expect(result.steps[0]!.rule).toBe('accessible-name');
      expect(result.steps[0]!.code).toContain('getByRole');
    });
  });

  describe('keyboard-navigable', () => {
    it('generates keyboard navigation test', () => {
      const result = compileClause('The page should be keyboard navigable');
      expect(result.unmatched).toHaveLength(0);
      expect(result.steps[0]!.rule).toBe('keyboard-navigable');
      expect(result.steps[0]!.code).toContain('page.keyboard.press');
    });
  });

  describe('no-autoplay-media', () => {
    it('generates autoplay media check', () => {
      const result = compileClause('There should be no autoplay media on the page');
      expect(result.unmatched).toHaveLength(0);
      expect(result.steps[0]!.rule).toBe('no-autoplay-media');
      expect(result.steps[0]!.code).toContain('video');
    });
  });

  describe('color-contrast', () => {
    it('generates color contrast check', () => {
      const result = compileClause('We maintain sufficient color contrast');
      expect(result.unmatched).toHaveLength(0);
      expect(result.steps[0]!.rule).toBe('color-contrast');
      expect(result.steps[0]!.code).toContain('CONTRAST_MIN');
    });
  });
});
