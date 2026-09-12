/** Client-safe taxonomies for Quadrantcode-native practice content. */

export const PROBLEM_TYPES = ['function'] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

export const TEST_CASE_VISIBILITIES = ['sample', 'visible', 'hidden'] as const;
export const TEST_CASE_COVERAGE = [
  'sample',
  'empty',
  'minimum',
  'maximum',
  'duplicates',
  'adversarial',
  'performance',
  'typical',
] as const;
export type TestCaseVisibility = (typeof TEST_CASE_VISIBILITIES)[number];

export const EVIDENCE_TYPES = [
  'official_sample',
  'verified_pyq',
  'candidate_reported',
  'frequently_reported',
  'company_pattern',
  'unverified',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  official_sample: 'Official sample',
  verified_pyq: 'Verified PYQ',
  candidate_reported: 'Candidate reported',
  frequently_reported: 'Frequently reported',
  company_pattern: 'Company pattern',
  unverified: 'Unverified',
};

export const EVIDENCE_TYPE_DESCRIPTIONS: Record<EvidenceType, string> = {
  official_sample: 'Published by the company through a reviewable public source.',
  verified_pyq: 'Past-question claim reviewed against acceptable independent evidence.',
  candidate_reported: 'One approved candidate recollection; not independently confirmed.',
  frequently_reported: 'At least three moderated independent reports of the same pattern.',
  company_pattern:
    'Original practice selected for a broad preparation pattern; not a PYQ claim.',
  unverified: 'Evidence has not passed review and must not be treated as confirmed.',
};

export const EVIDENCE_VERIFICATION_STATUSES = [
  'unverified',
  'reviewed',
  'verified',
  'rejected',
] as const;

export const CANDIDATE_LEVELS = ['internship', 'fresher', 'experienced'] as const;

export const MODERATION_STATUSES = [
  'draft',
  'pending_review',
  'needs_changes',
  'approved',
  'rejected',
  'published',
  'archived',
] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const MODERATION_ACTIONS = [
  'submitted',
  'requested_changes',
  'approved',
  'rejected',
  'published',
  'archived',
  'edited',
  'grouped',
] as const;

export const ASSESSMENT_PAPER_TYPES = [
  'official_sample',
  'verified_past_paper',
  'candidate_reported_set',
  'pattern_based_mock',
] as const;

export const ASSESSMENT_ATTEMPT_STATUSES = [
  'in_progress',
  'submitted',
  'auto_submitted',
  'expired',
] as const;

export const EXECUTION_MODES = ['run', 'submit', 'assessment'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** A reviewed threshold; reports never promote themselves automatically. */
export const FREQUENTLY_REPORTED_MINIMUM = 3;
