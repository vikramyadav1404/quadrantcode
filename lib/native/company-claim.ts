import { type EvidenceType } from './constants';

/**
 * How a company is named next to a problem (C3).
 *
 * C3 says company references are always "-style" and never "actual company
 * question". `problem_tags` has a database CHECK enforcing the suffix
 * (`problem_tags_company_style_suffix`), but company ASSOCIATIONS live in
 * `problem_company_evidence`, which that CHECK does not touch — so the solve
 * page rendered `{company.name} · {EVIDENCE_TYPE_LABELS[type]}` and produced
 * "Amazon · Company pattern", a bare company name, hyperlinked to that company.
 *
 * The string is built here, once, so that no component can interpolate a bare
 * name by accident. See `docs/c3-company-associations.md`.
 */

/** `Amazon` → `Amazon-style`, and `Amazon-style` → `Amazon-style`. */
export function companyStyleName(companyName: string): string {
  const trimmed = companyName.trim();
  return /-style$/i.test(trimmed) ? trimmed : `${trimmed}-style`;
}

/**
 * What the solve page says after the company name.
 *
 * Deliberately weaker than `EVIDENCE_TYPE_LABELS`, and deliberately the same for
 * every provenance type. The solve page's job is to say a problem is relevant to
 * a company's patterns; it is not the surface that publishes provenance. A chip
 * reading "Amazon-style · Verified PYQ" beside a problem statement is a
 * provenance claim wherever it appears, and C3 is about not making one.
 *
 * No information is lost from the system by this: `/companies/[slug]` shows the
 * real evidence label, under the disclaimer that route carries. What is dropped
 * is a claim on the one surface that should not be carrying it.
 *
 * The four provenance types are blocked at the database as of 2026-09-22
 * (`problem_company_evidence_no_unreviewed_provenance`), so in practice only two
 * branches are reachable. The map stays total anyway: this function must not
 * start returning `undefined` on the day that CHECK is relaxed.
 */
const SOLVE_EVIDENCE_SUFFIX: Record<EvidenceType, string> = {
  company_pattern: 'pattern practice',
  unverified: 'unconfirmed pattern',
  official_sample: 'pattern practice',
  verified_pyq: 'pattern practice',
  candidate_reported: 'pattern practice',
  frequently_reported: 'pattern practice',
};

/** The full chip text beside a problem: `Amazon-style · pattern practice`. */
export function solveCompanyLabel(companyName: string, evidenceType: EvidenceType): string {
  return `${companyStyleName(companyName)} · ${SOLVE_EVIDENCE_SUFFIX[evidenceType]}`;
}
