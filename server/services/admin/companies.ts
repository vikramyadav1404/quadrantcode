import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CANDIDATE_LEVELS, EVIDENCE_TYPES } from '@/lib/native/constants';
import type { Database } from '@/server/db';
import { companies, problemCompanyEvidence, problems } from '@/server/db/schema';
import { recordAudit } from '@/server/lib/observability/audit';

const companySchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  overview: z.string().min(40).max(4_000),
  isActive: z.boolean(),
});

const evidenceSchema = z
  .object({
    problemSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    companySlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    role: optionalText(120),
    round: optionalText(120),
    candidateLevel: z.enum(CANDIDATE_LEVELS).nullable(),
    yearFrom: optionalYear(),
    yearTo: optionalYear(),
    location: optionalText(160),
    evidenceType: z.enum(EVIDENCE_TYPES),
    sourceUrl: z.string().url().max(2_048).nullable(),
    reportCount: z.coerce.number().int().min(0).max(100_000),
    confidenceScore: z.coerce.number().int().min(0).max(100),
    verificationStatus: z.enum(['unverified', 'reviewed', 'verified', 'rejected']),
    lastReviewedDate: z.iso.date().nullable(),
  })
  .superRefine((value, context) => {
    if (value.yearFrom && value.yearTo && value.yearTo < value.yearFrom) {
      context.addIssue({
        code: 'custom',
        path: ['yearTo'],
        message: 'End year must not precede start year.',
      });
    }
    if (
      (value.evidenceType === 'official_sample' || value.evidenceType === 'verified_pyq') &&
      (!value.sourceUrl || value.verificationStatus !== 'verified')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceUrl'],
        message: 'Official or verified evidence needs a verified public source.',
      });
    }
    if (value.evidenceType === 'frequently_reported' && value.reportCount < 3) {
      context.addIssue({
        code: 'custom',
        path: ['reportCount'],
        message: 'Frequently reported requires at least three independent reports.',
      });
    }
    if (
      value.evidenceType === 'company_pattern' &&
      (value.sourceUrl || value.reportCount > 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceType'],
        message: 'Pattern labels cannot pretend to have reports or a proof source.',
      });
    }
  });

export async function listAdminCompanies(db: Database) {
  return db.select().from(companies).orderBy(asc(companies.name));
}

export async function listAdminEvidence(db: Database, limit = 200) {
  return db
    .select({
      id: problemCompanyEvidence.id,
      company: companies.name,
      companySlug: companies.slug,
      problem: problems.title,
      problemSlug: problems.slug,
      role: problemCompanyEvidence.role,
      round: problemCompanyEvidence.round,
      evidenceType: problemCompanyEvidence.evidenceType,
      verificationStatus: problemCompanyEvidence.verificationStatus,
      reportCount: problemCompanyEvidence.reportCount,
      sourceUrl: problemCompanyEvidence.sourceUrl,
      updatedAt: problemCompanyEvidence.updatedAt,
    })
    .from(problemCompanyEvidence)
    .innerJoin(companies, eq(companies.id, problemCompanyEvidence.companyId))
    .innerJoin(problems, eq(problems.id, problemCompanyEvidence.problemId))
    .orderBy(desc(problemCompanyEvidence.updatedAt))
    .limit(limit);
}

export async function updateAdminCompany(
  db: Database,
  actorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = companySchema.parse(rawInput);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(companies).where(eq(companies.id, input.companyId));
    if (!before) throw new Error('Company was not found.');
    await tx
      .update(companies)
      .set({
        name: input.name,
        overview: input.overview,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, input.companyId));
    await recordAudit(tx, {
      actorId,
      action: 'company.updated',
      target: `company:${input.companyId}`,
      before: { name: before.name, isActive: before.isActive },
      after: { name: input.name, isActive: input.isActive },
    });
  });
}

export async function createAdminEvidence(
  db: Database,
  actorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = evidenceSchema.parse(rawInput);
  await db.transaction(async (tx) => {
    const [[problem], [company]] = await Promise.all([
      tx
        .select({ id: problems.id })
        .from(problems)
        .where(eq(problems.slug, input.problemSlug))
        .limit(1),
      tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.slug, input.companySlug))
        .limit(1),
    ]);
    if (!problem || !company) throw new Error('Problem or company slug was not found.');
    const [created] = await tx
      .insert(problemCompanyEvidence)
      .values({
        problemId: problem.id,
        companyId: company.id,
        role: input.role,
        round: input.round,
        candidateLevel: input.candidateLevel,
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        location: input.location,
        evidenceType: input.evidenceType,
        sourceUrl: input.sourceUrl,
        reportCount: input.reportCount,
        confidenceScore: input.confidenceScore,
        verificationStatus: input.verificationStatus,
        lastReviewedDate: input.lastReviewedDate,
        createdBy: actorId,
      })
      .returning({ id: problemCompanyEvidence.id });
    if (!created) throw new Error('Evidence insert returned no row.');
    await recordAudit(tx, {
      actorId,
      action: 'company_evidence.created',
      target: `evidence:${created.id}`,
      after: {
        problemSlug: input.problemSlug,
        companySlug: input.companySlug,
        evidenceType: input.evidenceType,
        verificationStatus: input.verificationStatus,
      },
    });
  });
}

function optionalText(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable(),
  );
}

function optionalYear() {
  return z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : Number(value)),
    z.number().int().min(1990).max(2100).nullable(),
  );
}
