import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  companies,
  interviewReports,
  moderationDecisions,
} from '@/server/db/schema';
import {
  moderateInterviewReport,
  submitInterviewReport,
} from '@/server/services/interview-reports';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('candidate interview reports and moderation', () => {
  let ctx: TestContext;
  let companyId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    const [company] = await ctx.db
      .insert(companies)
      .values({ slug: 'example-company', name: 'Example Company', overview: 'Test overview.' })
      .returning();
    companyId = company!.id;
  });

  function reportInput() {
    return {
      companyId,
      role: 'Software Engineer',
      candidateLevel: 'fresher',
      interviewYear: 2026,
      location: 'Remote',
      round: 'Technical round 1',
      concept: 'Window frequency tracking',
      recollection:
        'I was asked to reason about a moving range and maintain counts as each boundary changed.',
      difficulty: 'medium',
      topics: ['arrays-hashing', 'sliding-window'],
      experience:
        'The interviewer asked for a direct approach first, then requested an optimization and a careful explanation of the boundary cases.',
      publicSourceUrl: null,
      displayAnonymously: true,
      originalAndNdaSafe: true,
      displayPermission: true,
    } as const;
  }

  it('stores a candidate report as pending review and never auto-publishes it', async () => {
    const user = await createUser(ctx.db);
    const reportId = await submitInterviewReport(ctx.db, user.id, reportInput());
    const [report] = await ctx.db
      .select()
      .from(interviewReports)
      .where(eq(interviewReports.id, reportId));
    expect(report).toMatchObject({ status: 'pending_review', publishedAt: null });
    const decisions = await ctx.db
      .select()
      .from(moderationDecisions)
      .where(eq(moderationDecisions.reportId, reportId));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: 'submitted', moderatorId: null });
  });

  it('requires consent and NDA-safety confirmation at the server boundary', async () => {
    const user = await createUser(ctx.db);
    await expect(
      submitInterviewReport(ctx.db, user.id, {
        ...reportInput(),
        originalAndNdaSafe: false,
      }),
    ).rejects.toThrow();
    expect(await ctx.db.select().from(interviewReports)).toHaveLength(0);
  });

  it('requires all reviews, follows state transitions, and appends moderator audit history', async () => {
    const candidate = await createUser(ctx.db);
    const moderator = await createUser(ctx.db, {
      email: 'moderator@example.com',
      role: 'admin',
    });
    const reportId = await submitInterviewReport(ctx.db, candidate.id, reportInput());
    const baseDecision = {
      reportId,
      reason:
        'The wording is independent and the recollection contains no restricted assessment material.',
      sourceReviewed: true,
      originalityReviewed: true,
      ndaSafe: true,
      assignedEvidenceType: 'candidate_reported',
      duplicateGroupKey: null,
      editedExperience: null,
      editedRecollection: null,
    } as const;

    await expect(
      moderateInterviewReport(ctx.db, moderator.id, {
        ...baseDecision,
        toStatus: 'approved',
        ndaSafe: false,
      }),
    ).rejects.toThrow('NDA safety');

    await moderateInterviewReport(ctx.db, moderator.id, {
      ...baseDecision,
      toStatus: 'approved',
    });
    await moderateInterviewReport(ctx.db, moderator.id, {
      ...baseDecision,
      toStatus: 'published',
    });

    const [published] = await ctx.db
      .select()
      .from(interviewReports)
      .where(eq(interviewReports.id, reportId));
    expect(published).toMatchObject({ status: 'published' });
    expect(published!.publishedAt).toBeInstanceOf(Date);
    expect(
      await ctx.db
        .select()
        .from(moderationDecisions)
        .where(eq(moderationDecisions.reportId, reportId)),
    ).toHaveLength(3);
    expect(
      await ctx.db.select().from(auditLogs).where(eq(auditLogs.actorId, moderator.id)),
    ).toHaveLength(2);
  });

  it('does not allow FREQUENTLY_REPORTED below three independent reporters', async () => {
    const candidate = await createUser(ctx.db);
    const moderator = await createUser(ctx.db, {
      email: 'moderator@example.com',
      role: 'admin',
    });
    const reportId = await submitInterviewReport(ctx.db, candidate.id, reportInput());
    const [report] = await ctx.db
      .select({ group: interviewReports.duplicateGroupKey })
      .from(interviewReports)
      .where(eq(interviewReports.id, reportId));
    await expect(
      moderateInterviewReport(ctx.db, moderator.id, {
        reportId,
        toStatus: 'approved',
        reason: 'Reviewed but the group does not have enough independent evidence yet.',
        sourceReviewed: true,
        originalityReviewed: true,
        ndaSafe: true,
        assignedEvidenceType: 'frequently_reported',
        duplicateGroupKey: report!.group,
        editedExperience: null,
        editedRecollection: null,
      }),
    ).rejects.toThrow('three independent');
  });
});
