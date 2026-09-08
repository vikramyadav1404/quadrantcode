import { createHash } from 'node:crypto';
import { and, asc, countDistinct, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  companies,
  interviewReportQuestions,
  interviewReports,
  moderationDecisions,
} from '@/server/db/schema';
import { recordAudit } from '@/server/lib/observability/audit';
import { moderateInterviewReportSchema, submitInterviewReportSchema } from './input';

export async function submitInterviewReport(
  db: Database,
  userId: string,
  rawInput: unknown,
): Promise<string> {
  const input = submitInterviewReportSchema.parse(rawInput);
  const [company] = await db
    .select({ id: companies.id, slug: companies.slug })
    .from(companies)
    .where(and(eq(companies.id, input.companyId), eq(companies.isActive, true)))
    .limit(1);
  if (!company) throw new Error('Select a listed company.');

  const duplicateGroupKey = reportFingerprint({
    companySlug: company.slug,
    role: input.role,
    round: input.round,
    concept: input.concept,
  });
  const now = new Date();

  return db.transaction(async (tx) => {
    const [report] = await tx
      .insert(interviewReports)
      .values({
        userId,
        companyId: input.companyId,
        role: input.role,
        candidateLevel: input.candidateLevel,
        interviewYear: input.interviewYear,
        location: input.location,
        round: input.round,
        experience: input.experience,
        publicSourceUrl: input.publicSourceUrl,
        displayAnonymously: input.displayAnonymously,
        originalAndNdaSafe: input.originalAndNdaSafe,
        displayPermission: input.displayPermission,
        status: 'pending_review',
        duplicateGroupKey,
        submittedAt: now,
      })
      .returning({ id: interviewReports.id });
    if (!report) throw new Error('The report could not be saved.');

    await tx.insert(interviewReportQuestions).values({
      reportId: report.id,
      ordinal: 1,
      concept: input.concept,
      recollection: input.recollection,
      difficulty: input.difficulty,
      topicSlugs: input.topics,
    });
    await tx.insert(moderationDecisions).values({
      reportId: report.id,
      moderatorId: null,
      action: 'submitted',
      fromStatus: 'draft',
      toStatus: 'pending_review',
      reason: 'Candidate submitted the report for moderator review.',
    });
    return report.id;
  });
}

export async function listModerationQueue(db: Database) {
  return db
    .select({
      id: interviewReports.id,
      status: interviewReports.status,
      companyName: companies.name,
      role: interviewReports.role,
      round: interviewReports.round,
      interviewYear: interviewReports.interviewYear,
      location: interviewReports.location,
      experience: interviewReports.experience,
      publicSourceUrl: interviewReports.publicSourceUrl,
      duplicateGroupKey: interviewReports.duplicateGroupKey,
      safetyFlags: interviewReports.safetyFlags,
      concept: interviewReportQuestions.concept,
      recollection: interviewReportQuestions.recollection,
      difficulty: interviewReportQuestions.difficulty,
      topics: interviewReportQuestions.topicSlugs,
      submittedAt: interviewReports.submittedAt,
    })
    .from(interviewReports)
    .innerJoin(companies, eq(companies.id, interviewReports.companyId))
    .innerJoin(
      interviewReportQuestions,
      eq(interviewReportQuestions.reportId, interviewReports.id),
    )
    .where(
      inArray(interviewReports.status, [
        'pending_review',
        'needs_changes',
        'approved',
        'rejected',
      ]),
    )
    .orderBy(asc(interviewReports.submittedAt));
}

export async function moderateInterviewReport(
  db: Database,
  moderatorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = moderateInterviewReportSchema.parse(rawInput);
  const [current] = await db
    .select({
      id: interviewReports.id,
      status: interviewReports.status,
      publicSourceUrl: interviewReports.publicSourceUrl,
      experience: interviewReports.experience,
    })
    .from(interviewReports)
    .where(eq(interviewReports.id, input.reportId))
    .limit(1);
  if (!current) throw new Error('No such interview report.');

  assertModerationTransition(current.status, input.toStatus);
  if (['approved', 'published'].includes(input.toStatus)) {
    if (!input.sourceReviewed || !input.originalityReviewed || !input.ndaSafe) {
      throw new Error('Source, originality, and NDA safety reviews are required first.');
    }
  }
  if (input.assignedEvidenceType === 'frequently_reported' && !input.duplicateGroupKey) {
    throw new Error('Frequently reported needs a reviewed duplicate group.');
  }
  if (input.assignedEvidenceType === 'frequently_reported' && input.duplicateGroupKey) {
    const [group] = await db
      .select({ independentReports: countDistinct(interviewReports.userId) })
      .from(interviewReports)
      .where(eq(interviewReports.duplicateGroupKey, input.duplicateGroupKey));
    if (Number(group?.independentReports ?? 0) < 3) {
      throw new Error(
        'Frequently reported requires at least three independent candidate reports.',
      );
    }
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const editedFields: string[] = [];
    if (input.editedExperience && input.editedExperience !== current.experience) {
      editedFields.push('experience');
    }
    if (input.editedRecollection) editedFields.push('recollection');

    await tx
      .update(interviewReports)
      .set({
        status: input.toStatus,
        duplicateGroupKey: input.duplicateGroupKey,
        ...(input.editedExperience ? { experience: input.editedExperience } : {}),
        ...(input.toStatus === 'published' ? { publishedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(interviewReports.id, input.reportId));
    if (input.editedRecollection) {
      await tx
        .update(interviewReportQuestions)
        .set({ recollection: input.editedRecollection, updatedAt: now })
        .where(eq(interviewReportQuestions.reportId, input.reportId));
    }

    await tx.insert(moderationDecisions).values({
      reportId: input.reportId,
      moderatorId,
      action: actionFor(input.toStatus),
      fromStatus: current.status,
      toStatus: input.toStatus,
      reason: input.reason,
      sourceReviewed: input.sourceReviewed,
      originalityReviewed: input.originalityReviewed,
      ndaSafe: input.ndaSafe,
      assignedEvidenceType: input.assignedEvidenceType,
      editedFields,
    });
    await recordAudit(tx, {
      actorId: moderatorId,
      action: `interview_report.${input.toStatus}`,
      target: `interview_report:${input.reportId}`,
      before: { status: current.status },
      after: { status: input.toStatus, editedFields, evidence: input.assignedEvidenceType },
    });
  });
}

function reportFingerprint(input: {
  companySlug: string;
  role: string;
  round: string;
  concept: string;
}): string {
  const normalized = [input.companySlug, input.role, input.round, input.concept]
    .map((value) =>
      value
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    )
    .join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function assertModerationTransition(from: string, to: string): void {
  const allowed: Record<string, string[]> = {
    pending_review: ['needs_changes', 'approved', 'rejected'],
    needs_changes: ['approved', 'rejected'],
    approved: ['published', 'rejected'],
    rejected: ['pending_review', 'archived'],
    published: ['archived'],
  };
  if (!allowed[from]?.includes(to))
    throw new Error(`Cannot move a report from ${from} to ${to}.`);
}

function actionFor(to: string) {
  if (to === 'needs_changes') return 'requested_changes' as const;
  if (to === 'approved') return 'approved' as const;
  if (to === 'rejected') return 'rejected' as const;
  if (to === 'published') return 'published' as const;
  return 'archived' as const;
}
