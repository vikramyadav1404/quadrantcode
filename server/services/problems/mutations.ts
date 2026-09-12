/**
 * Catalog writes — create, update, archive, bulk tag.
 *
 * THE POLICY GATE (F1.1): every write passes through `assertContentPolicy`
 * before it reaches the database. That check duplicates the F0.2 CHECK
 * constraint on purpose — see `errors.ts` for why both exist.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  contentLicenses,
  editorials,
  problemExamples,
  problemLanguageTemplates,
  problemTags,
  problemTopics,
  problemVersions,
  problems,
  testCases,
  topics,
} from '@/server/db/schema';
import { normaliseProblemUrl } from '@/server/services/ingest/normalise-url';
import {
  ContentPolicyError,
  type ContentPolicyViolation,
  DuplicateSlugError,
  ProblemNotFoundError,
} from './errors';
import {
  type BulkTagInput,
  type CreateProblemInput,
  STATEMENT_FIELDS,
  type UpdateProblemInput,
  bulkTagSchema,
  createProblemSchema,
  updateProblemSchema,
} from '@/lib/problems/schemas';

/**
 * C1 gate.
 *
 * Rejects any attempt to attach statement-bearing content to a problem that
 * lives on someone else's platform. `null` is fine — that is clearing a field;
 * anything else is a violation, including an empty array of examples, because
 * writing `examples: []` to an external problem means someone's form is
 * submitting a field it should not have.
 */
export function assertContentPolicy(
  sourceType: 'external_link' | 'original',
  payload: Record<string, unknown>,
): void {
  if (sourceType !== 'external_link') return;

  const violations: ContentPolicyViolation[] = [];

  for (const field of STATEMENT_FIELDS) {
    const value = payload[field];
    if (value !== undefined && value !== null) {
      violations.push({
        field,
        reason: 'external-link problems store metadata and a link only',
      });
    }
  }

  if (violations.length > 0) throw new ContentPolicyError(violations);
}

/** External-link problems must carry the URL that sends the user to the platform. */
function assertExternalUrlPresent(
  sourceType: 'external_link' | 'original',
  externalUrl: string | null | undefined,
): void {
  if (sourceType === 'external_link' && !externalUrl) {
    throw new ContentPolicyError([
      { field: 'externalUrl', reason: 'an external-link problem must link to its platform' },
    ]);
  }
}

/**
 * Reads `sourceType` off unvalidated input so the policy gate can run BEFORE
 * Zod. Order matters: `externalProblemSchema` types the statement fields as
 * null-only, so parsing first turns a policy violation into a generic
 * "expected null, received string" — technically a rejection, but useless to
 * the admin who needs to know *why* the field is forbidden.
 */
function peekSourceType(rawInput: unknown): 'external_link' | 'original' | null {
  if (typeof rawInput !== 'object' || rawInput === null) return null;
  const value = (rawInput as Record<string, unknown>).sourceType;
  return value === 'external_link' || value === 'original' ? value : null;
}

export async function createProblem(
  db: Database,
  rawInput: unknown,
): Promise<{ id: string; slug: string }> {
  // Policy first — see peekSourceType.
  const declaredSource = peekSourceType(rawInput);
  if (declaredSource) {
    assertContentPolicy(declaredSource, rawInput as Record<string, unknown>);
  }

  const input: CreateProblemInput = createProblemSchema.parse(rawInput);

  assertContentPolicy(input.sourceType, input as unknown as Record<string, unknown>);
  assertExternalUrlPresent(input.sourceType, input.externalUrl ?? null);

  const [existing] = await db
    .select({ id: problems.id })
    .from(problems)
    .where(eq(problems.slug, input.slug))
    .limit(1);
  if (existing) throw new DuplicateSlugError(input.slug);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(problems)
      .values({
        slug: input.slug,
        title: input.title,
        sourceType: input.sourceType,
        platform: input.platform ?? null,
        externalUrl: input.externalUrl ?? null,
        /*
         * F1.2 dedup key, derived here rather than by the database — see the
         * column comment in schema/problems.ts for why it is not GENERATED.
         * Deriving it on the write path is what makes the unique index able to
         * enforce "one URL is one catalog row"; a caller cannot supply it.
         */
        externalUrlNormalised: normaliseProblemUrl(input.externalUrl ?? null),
        difficulty: input.difficulty,
        estimatedMinutes: input.estimatedMinutes,
        isPremium: input.isPremium,
        status: input.status,
        statement: input.sourceType === 'original' ? (input.statement ?? null) : null,
        inputFormat: input.sourceType === 'original' ? (input.inputFormat ?? null) : null,
        outputFormat: input.sourceType === 'original' ? (input.outputFormat ?? null) : null,
        constraintsText:
          input.sourceType === 'original' ? (input.constraintsText ?? null) : null,
        examples: input.sourceType === 'original' ? (input.examples ?? null) : null,
        editorial: input.sourceType === 'original' ? (input.editorial ?? null) : null,
      })
      .returning({ id: problems.id, slug: problems.slug });

    if (!row) throw new Error('createProblem: insert returned no row');

    if (input.tags.length > 0) {
      await tx
        .insert(problemTags)
        .values(input.tags.map((tag) => ({ problemId: row.id, ...tag })))
        .onConflictDoNothing();
    }

    if (input.sourceType === 'original') {
      const [license] = await tx
        .insert(contentLicenses)
        .values({
          provenance: 'quadrantcode-original',
          licenseName: 'Quadrantcode Original Draft Content License',
          author: 'Quadrantcode editorial team',
          independentlyCreated: true,
          reviewNotes:
            'Admin-created draft. All placeholder content must be reviewed before publishing.',
        })
        .onConflictDoUpdate({
          target: [
            contentLicenses.provenance,
            contentLicenses.licenseName,
            contentLicenses.author,
          ],
          set: { independentlyCreated: true },
        })
        .returning({ id: contentLicenses.id });
      if (!license) throw new Error('createProblem: content license insert returned no row');

      const draftStatement =
        input.statement ?? 'Replace this original draft statement before review.';
      const [version] = await tx
        .insert(problemVersions)
        .values({
          problemId: row.id,
          version: 1,
          status: 'draft',
          problemType: 'function',
          story: draftStatement,
          statement: draftStatement,
          inputFormat: 'Define the complete function input contract before review.',
          outputFormat: 'Define the exact serialized return value before review.',
          functionContract: {
            functionName: 'solve',
            parameters: [
              {
                name: 'values',
                type: 'integer[]',
                description: 'Replace this draft parameter description.',
              },
            ],
            returnType: '64-bit integer',
          },
          constraints: [
            'Replace with a minimum boundary.',
            'Replace with a maximum boundary.',
            'Replace with a value-domain constraint.',
          ],
          hints: [
            'Replace this draft hint with a useful first step.',
            'Replace this draft hint with a stronger direction.',
          ],
          timeLimitMs: 1_500,
          memoryLimitKb: 128_000,
          contentLicenseId: license.id,
          provenance: 'Admin-created Quadrantcode-original draft; requires editorial review.',
          reviewNotes:
            'Replace every placeholder, validate references on Judge0, then publish.',
        })
        .returning({ id: problemVersions.id });
      if (!version) throw new Error('createProblem: problem version insert returned no row');

      await tx.insert(problemExamples).values([
        {
          problemVersionId: version.id,
          ordinal: 1,
          input: '0',
          output: '0',
          explanation: 'Replace this placeholder with a fully explained original example.',
        },
        {
          problemVersionId: version.id,
          ordinal: 2,
          input: '1',
          output: '0',
          explanation: 'Replace this second placeholder with a distinct explained example.',
        },
      ]);
      await tx.insert(editorials).values({
        problemVersionId: version.id,
        overview: 'Replace this placeholder with an independently written editorial overview.',
        bruteForceApproach:
          'Describe the direct baseline approach and when it becomes too slow.',
        optimalApproach:
          'Replace this placeholder with the complete optimal algorithm and its invariants.',
        correctnessProof:
          'Replace this placeholder with a rigorous correctness argument covering every case.',
        timeComplexity: 'TBD',
        spaceComplexity: 'TBD',
      });
      await tx.insert(testCases).values([
        {
          problemVersionId: version.id,
          ordinal: 1,
          visibility: 'sample',
          coverage: 'sample',
          input: '0',
          expectedOutput: '0',
        },
        {
          problemVersionId: version.id,
          ordinal: 2,
          visibility: 'visible',
          coverage: 'typical',
          input: '1',
          expectedOutput: '0',
        },
        {
          problemVersionId: version.id,
          ordinal: 3,
          visibility: 'hidden',
          coverage: 'minimum',
          input: '0',
          expectedOutput: '0',
        },
        {
          problemVersionId: version.id,
          ordinal: 4,
          visibility: 'hidden',
          coverage: 'duplicates',
          input: '1 1',
          expectedOutput: '0',
        },
        {
          problemVersionId: version.id,
          ordinal: 5,
          visibility: 'hidden',
          coverage: 'maximum',
          input: '100',
          expectedOutput: '0',
          isPerformance: true,
        },
        {
          problemVersionId: version.id,
          ordinal: 6,
          visibility: 'hidden',
          coverage: 'adversarial',
          input: '-1',
          expectedOutput: '0',
        },
      ]);
      await tx.insert(problemLanguageTemplates).values(draftLanguageTemplates(version.id));

      for (const tag of input.tags.filter((entry) => entry.tagType === 'topic')) {
        const [topic] = await tx
          .insert(topics)
          .values({
            slug: tag.tagValue,
            name: tag.tagValue.split('-').map(capitalize).join(' '),
          })
          .onConflictDoUpdate({ target: topics.slug, set: { slug: tag.tagValue } })
          .returning({ id: topics.id });
        if (topic) {
          await tx
            .insert(problemTopics)
            .values({ problemId: row.id, topicId: topic.id, isPrimary: false })
            .onConflictDoNothing();
        }
      }
    }

    return row;
  });
}

function draftLanguageTemplates(problemVersionId: string) {
  const serialization = {
    input: 'Whitespace-separated signed integers read into values.',
    output: 'One signed integer.',
    equality: 'exact_json' as const,
  };
  return [
    {
      problemVersionId,
      language: 'c11' as const,
      displayName: 'C',
      functionSignature: 'long long solve(const long long *values, int n)',
      starterCode: 'long long solve(const long long *values, int n) {\n  return 0;\n}',
      wrapperTemplate:
        '#include <stdio.h>\n#include <stdlib.h>\n/*__USER_CODE__*/\nint main(void){int n=0,cap=16;long long*a=malloc(sizeof(long long)*cap),x;while(scanf("%lld",&x)==1){if(n==cap){cap*=2;a=realloc(a,sizeof(long long)*cap);}a[n++]=x;}printf("%lld",solve(a,n));free(a);}',
      serialization,
      referenceSolution:
        'long long solve(const long long *values, int n) { (void)values; (void)n; return 0; }',
    },
    {
      problemVersionId,
      language: 'cpp17' as const,
      displayName: 'C++',
      functionSignature: 'long long solve(const vector<long long>& values)',
      starterCode: 'long long solve(const vector<long long>& values) {\n  return 0;\n}',
      wrapperTemplate:
        '#include <bits/stdc++.h>\nusing namespace std;\n/*__USER_CODE__*/\nint main(){vector<long long>a;long long x;while(cin>>x)a.push_back(x);cout<<solve(a);}',
      serialization,
      referenceSolution:
        'long long solve(const vector<long long>& values) { (void)values; return 0; }',
    },
    {
      problemVersionId,
      language: 'java' as const,
      displayName: 'Java',
      functionSignature: 'static long solve(long[] values)',
      starterCode: 'static long solve(long[] values) {\n  return 0L;\n}',
      wrapperTemplate:
        'import java.io.*;\npublic class Main {\n/*__USER_CODE__*/\npublic static void main(String[]args)throws Exception{String s=new String(System.in.readAllBytes()).trim();String[]p=s.isEmpty()?new String[0]:s.split("\\\\s+");long[]a=new long[p.length];for(int i=0;i<p.length;i++)a[i]=Long.parseLong(p[i]);System.out.print(solve(a));}\n}',
      serialization,
      referenceSolution: 'static long solve(long[] values) { return 0L; }',
    },
    {
      problemVersionId,
      language: 'python3' as const,
      displayName: 'Python',
      functionSignature: 'def solve(values: list[int]) -> int',
      starterCode: 'def solve(values: list[int]) -> int:\n    return 0',
      wrapperTemplate:
        '/*__USER_CODE__*/\nif __name__ == "__main__":\n    import sys\n    print(solve([int(x) for x in sys.stdin.read().split()]))',
      serialization,
      referenceSolution: 'def solve(values: list[int]) -> int:\n    return 0',
    },
    {
      problemVersionId,
      language: 'javascript' as const,
      displayName: 'JavaScript',
      functionSignature: 'function solve(values)',
      starterCode: 'function solve(values) {\n  return 0;\n}',
      wrapperTemplate:
        'const fs=require("fs");\n/*__USER_CODE__*/\nconst s=fs.readFileSync(0,"utf8").trim();console.log(String(solve(s?s.split(/\\s+/).map(Number):[])));',
      serialization,
      referenceSolution: 'function solve(values) { return 0; }',
    },
  ];
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

export async function updateProblem(db: Database, rawInput: unknown): Promise<void> {
  const input: UpdateProblemInput = updateProblemSchema.parse(rawInput);

  const [current] = await db
    .select({
      id: problems.id,
      sourceType: problems.sourceType,
      externalUrl: problems.externalUrl,
    })
    .from(problems)
    .where(eq(problems.id, input.id))
    .limit(1);

  if (!current) throw new ProblemNotFoundError(input.id);

  // The policy is evaluated against the STORED source type, not a client-sent
  // one — otherwise the gate is bypassed by claiming the problem is original.
  assertContentPolicy(current.sourceType, input as unknown as Record<string, unknown>);

  const nextUrl = input.externalUrl === undefined ? current.externalUrl : input.externalUrl;
  assertExternalUrlPresent(current.sourceType, nextUrl);

  await db.transaction(async (tx) => {
    await tx
      .update(problems)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.estimatedMinutes !== undefined
          ? { estimatedMinutes: input.estimatedMinutes }
          : {}),
        ...(input.isPremium !== undefined ? { isPremium: input.isPremium } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
        /*
         * The dedup key moves with the URL, in the SAME conditional so the two
         * cannot be updated apart. Splitting them would let a URL change while
         * the key kept pointing at the old one — dedup would then match the
         * previous URL forever, which is a silent wrong answer rather than a
         * visible failure.
         */
        ...(input.externalUrl !== undefined
          ? {
              externalUrl: input.externalUrl,
              externalUrlNormalised: normaliseProblemUrl(input.externalUrl),
            }
          : {}),
        ...(current.sourceType === 'original'
          ? {
              ...(input.statement !== undefined ? { statement: input.statement } : {}),
              ...(input.inputFormat !== undefined ? { inputFormat: input.inputFormat } : {}),
              ...(input.outputFormat !== undefined ? { outputFormat: input.outputFormat } : {}),
              ...(input.constraintsText !== undefined
                ? { constraintsText: input.constraintsText }
                : {}),
              ...(input.examples !== undefined ? { examples: input.examples } : {}),
              ...(input.editorial !== undefined ? { editorial: input.editorial } : {}),
            }
          : {}),
      })
      .where(eq(problems.id, input.id));

    if (input.tags) {
      await tx.delete(problemTags).where(eq(problemTags.problemId, input.id));
      if (input.tags.length > 0) {
        await tx
          .insert(problemTags)
          .values(input.tags.map((tag) => ({ problemId: input.id, ...tag })))
          .onConflictDoNothing();
      }
    }
  });
}

/**
 * Archive — a visibility change, never a delete.
 *
 * `user_problems` rows are untouched: a user who solved this problem keeps
 * their history, their attempt counts and their best time, and the problem
 * stays reachable by direct slug for them.
 */
export async function archiveProblem(db: Database, id: string): Promise<void> {
  const [row] = await db
    .update(problems)
    .set({ status: 'archived' })
    .where(eq(problems.id, id))
    .returning({ id: problems.id });

  if (!row) throw new ProblemNotFoundError(id);
}

export async function unarchiveProblem(db: Database, id: string): Promise<void> {
  const [row] = await db
    .update(problems)
    .set({ status: 'published' })
    .where(eq(problems.id, id))
    .returning({ id: problems.id });

  if (!row) throw new ProblemNotFoundError(id);
}

/** Bulk tag management for admins. One transaction, so a partial apply is impossible. */
export async function bulkUpdateTags(db: Database, rawInput: unknown): Promise<void> {
  const input: BulkTagInput = bulkTagSchema.parse(rawInput);

  await db.transaction(async (tx) => {
    for (const tag of input.remove) {
      await tx
        .delete(problemTags)
        .where(
          and(
            inArray(problemTags.problemId, input.problemIds),
            eq(problemTags.tagType, tag.tagType),
            eq(problemTags.tagValue, tag.tagValue),
          ),
        );
    }

    if (input.add.length > 0) {
      const rows = input.problemIds.flatMap((problemId) =>
        input.add.map((tag) => ({ problemId, ...tag })),
      );
      await tx.insert(problemTags).values(rows).onConflictDoNothing();
    }
  });
}
