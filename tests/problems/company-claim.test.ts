/**
 * C3 · how a company is named beside a problem.
 *
 * The solve page used to render `{company.name} · {EVIDENCE_TYPE_LABELS[type]}`,
 * producing "Amazon · Company pattern" as a hyperlink to that company. Bare
 * name, and a link implying something authoritative sits behind it.
 *
 * `problem_tags_company_style_suffix` does NOT cover this — it constrains
 * `problem_tags`, and associations live in `problem_company_evidence`. So the
 * suffix rule has to be held by the code that builds the string, and by this
 * file. See `docs/c3-company-associations.md`.
 */
import { describe, expect, it } from 'vitest';
import { EVIDENCE_TYPES, type EvidenceType } from '@/lib/native/constants';
import { companyStyleName, solveCompanyLabel } from '@/lib/native/company-claim';

const COMPANIES = ['Amazon', 'Google', 'Goldman Sachs', 'Meta'];

describe('companyStyleName', () => {
  it('adds the suffix', () => {
    expect(companyStyleName('Amazon')).toBe('Amazon-style');
    expect(companyStyleName('Goldman Sachs')).toBe('Goldman Sachs-style');
  });

  it('does not double it', () => {
    expect(companyStyleName('Amazon-style')).toBe('Amazon-style');
    expect(companyStyleName('Amazon-STYLE')).toBe('Amazon-STYLE');
  });

  it('trims before deciding', () => {
    expect(companyStyleName('  Amazon  ')).toBe('Amazon-style');
    expect(companyStyleName('Amazon-style ')).toBe('Amazon-style');
  });
});

describe('solveCompanyLabel · C3 holds for EVERY evidence type', () => {
  it('never emits a bare company name', () => {
    // Walks the real enum rather than a hand-written list, so adding a seventh
    // evidence type cannot quietly skip this rule.
    expect(EVIDENCE_TYPES.length).toBeGreaterThan(0);
    for (const company of COMPANIES) {
      for (const evidenceType of EVIDENCE_TYPES) {
        const label = solveCompanyLabel(company, evidenceType);
        expect(label, `${company}/${evidenceType}`).toContain(`${company}-style`);
        expect(label, `${company}/${evidenceType}`).not.toBe(company);
      }
    }
  });

  it('never asserts provenance on the solve surface', () => {
    // The whole point of collapsing the suffix: this page says a problem is
    // pattern-relevant, never that a company really asked it. /companies shows
    // the real evidence label, under the disclaimer that route carries.
    const FORBIDDEN = /\b(pyq|previously asked|past question|official|reported|verified)\b/i;
    for (const evidenceType of EVIDENCE_TYPES) {
      expect(solveCompanyLabel('Amazon', evidenceType), evidenceType).not.toMatch(FORBIDDEN);
    }
  });

  it('is total — no evidence type falls through to undefined', () => {
    for (const evidenceType of EVIDENCE_TYPES) {
      const label = solveCompanyLabel('Amazon', evidenceType);
      expect(label, evidenceType).not.toContain('undefined');
      expect(label.endsWith(' · '), evidenceType).toBe(false);
    }
  });

  it('reads as intended for the only two types the database now permits', () => {
    expect(solveCompanyLabel('Amazon', 'company_pattern')).toBe(
      'Amazon-style · pattern practice',
    );
    expect(solveCompanyLabel('Amazon', 'unverified')).toBe(
      'Amazon-style · unconfirmed pattern',
    );
  });
});

describe('C3 · the rule can actually fail', () => {
  /*
   * Positive control.
   *
   * "Every label contains -style" is an absence claim about bare names, and an
   * absence claim needs something that trips it. Without this, the assertions
   * above would pass just as happily against a function that returned the
   * company name unchanged for a type nobody tested.
   */
  const bareLabel = (companyName: string, _evidenceType: EvidenceType) => companyName;

  it('a bare-name implementation FAILS the suffix rule', () => {
    expect(bareLabel('Amazon', 'company_pattern')).not.toContain('Amazon-style');
  });

  it('a provenance-leaking implementation FAILS the wording rule', () => {
    const leaky = (companyName: string, _evidenceType: EvidenceType) =>
      `${companyName}-style · Verified PYQ`;
    expect(leaky('Amazon', 'verified_pyq')).toMatch(/pyq/i);
    // ...and the real one does not, for the same input.
    expect(solveCompanyLabel('Amazon', 'verified_pyq')).not.toMatch(/pyq/i);
  });
});
