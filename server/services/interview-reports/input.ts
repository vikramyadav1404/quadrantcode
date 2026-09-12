import { z } from 'zod';

export const submitInterviewReportSchema = z.object({
  companyId: z.string().uuid(),
  role: z.string().trim().min(2).max(120),
  candidateLevel: z.enum(['internship', 'fresher', 'experienced']),
  interviewYear: z.coerce.number().int().min(1990).max(new Date().getUTCFullYear()),
  location: z.string().trim().max(160).nullable(),
  round: z.string().trim().min(2).max(120),
  concept: z.string().trim().min(5).max(240),
  recollection: z.string().trim().min(40).max(10_000),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  topics: z
    .array(z.string().regex(/^[a-z0-9-]+$/))
    .min(1)
    .max(8),
  experience: z.string().trim().min(80).max(20_000),
  publicSourceUrl: z.string().url().nullable(),
  displayAnonymously: z.boolean(),
  originalAndNdaSafe: z.literal(true),
  displayPermission: z.literal(true),
});

export const moderateInterviewReportSchema = z.object({
  reportId: z.string().uuid(),
  toStatus: z.enum(['needs_changes', 'approved', 'rejected', 'published', 'archived']),
  reason: z.string().trim().min(10).max(2_000),
  sourceReviewed: z.boolean(),
  originalityReviewed: z.boolean(),
  ndaSafe: z.boolean(),
  assignedEvidenceType: z
    .enum(['candidate_reported', 'frequently_reported', 'unverified'])
    .nullable(),
  duplicateGroupKey: z.string().trim().max(120).nullable(),
  editedExperience: z.string().trim().min(80).max(20_000).nullable(),
  editedRecollection: z.string().trim().min(40).max(10_000).nullable(),
});
