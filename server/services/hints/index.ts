/**
 * AI hint coach.
 *
 * A user stuck on an ORIGINAL problem asks for a hint and gets the next of
 * three levels — a nudge, then the approach, then the next concrete step —
 * never a solution. The model sees the public statement (what the problem
 * panel already shows), the user's current code and the hints already given;
 * never a hidden test, the reference solution or the editorial.
 *
 * External problems get no hints: their statements are not ours (C1).
 *
 * Provider: the Gemini API, one HTTPS call per hint, key from GEMINI_API_KEY.
 * Limits: three hints per problem per day, `HINT_DAILY_LIMIT` per user per day.
 */
import { and, asc, count, eq, gte } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { aiHints, problems } from '@/server/db/schema';
import { getPublicNativeProblem } from '@/server/services/native-content';

export const HINT_DAILY_LIMIT = 15;
export const HINT_MAX_LEVEL = 3;
// A stable free-tier model (Gemini API models page, 2026-11-18). Override with GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const MAX_CODE_CHARS = 8_000;

const LEVEL_GUIDE: Record<number, string> = {
  1: 'Level 1 — a NUDGE: one or two sentences pointing at what to notice in the problem or at the flaw in the code. Name no algorithm or data structure.',
  2: 'Level 2 — the APPROACH: name the technique or data structure and why it fits, in at most four sentences. No code.',
  3: 'Level 3 — the NEXT STEP: the single next concrete step to implement or fix, with at most one short line of pseudocode. Still not a full solution.',
};

export class HintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HintError';
  }
}

export type HintView = { level: number; hint: string; createdAt: Date };

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The prompt. Pure, so its contents — and what it leaves out — are testable. */
export function buildHintPrompt(input: {
  title: string;
  statement: string;
  language: string;
  code: string;
  level: number;
  previous: readonly string[];
}): string {
  const code = input.code.slice(0, MAX_CODE_CHARS);
  return [
    'You are a coding-interview coach. The student is stuck on the problem below.',
    'Give exactly ONE hint at the level requested. Never give the full solution,',
    'never write complete code, and never reveal expected outputs that are not in',
    'the statement. If the code is close, say what to check rather than fixing it.',
    'Answer in plain text, under 90 words.',
    '',
    LEVEL_GUIDE[input.level],
    '',
    `Problem: ${input.title}`,
    input.statement,
    '',
    input.previous.length > 0
      ? `Hints already given (do not repeat them):\n${input.previous.map((hint, i) => `${i + 1}. ${hint}`).join('\n')}`
      : 'No hints given yet.',
    '',
    `Student's current ${input.language} code:`,
    code.trim().length > 0 ? code : '(empty — they have not started)',
  ].join('\n');
}

async function callGemini(
  prompt: string,
  config: { apiKey: string; model: string; fetchImpl: typeof fetch },
): Promise<string> {
  let response: Response;
  try {
    response = await config.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(25_000),
      },
    );
  } catch {
    throw new HintError('The hint service did not answer. Try again in a moment.');
  }
  if (response.status === 429) {
    throw new HintError('The hint service is busy right now. Try again in a minute.');
  }
  if (!response.ok) {
    throw new HintError('The hint service is unavailable right now.');
  }
  const body = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  const text = body?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) throw new HintError('The hint service returned nothing. Try again.');
  return text.slice(0, 2000);
}

/** Today's hints for this problem, oldest first. */
export async function hintsToday(
  db: Database,
  input: { userId: string; problemId: string; now: Date },
): Promise<HintView[]> {
  return db
    .select({ level: aiHints.level, hint: aiHints.hint, createdAt: aiHints.createdAt })
    .from(aiHints)
    .where(
      and(
        eq(aiHints.userId, input.userId),
        eq(aiHints.problemId, input.problemId),
        gte(aiHints.createdAt, startOfUtcDay(input.now)),
      ),
    )
    .orderBy(asc(aiHints.createdAt));
}

/** How many hints were taken on this problem since `since` — the solve signal. */
export async function hintsSince(
  db: Database | Transaction,
  input: { userId: string; problemId: string; since: Date },
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(aiHints)
    .where(
      and(
        eq(aiHints.userId, input.userId),
        eq(aiHints.problemId, input.problemId),
        gte(aiHints.createdAt, input.since),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function requestHint(
  db: Database,
  input: {
    userId: string;
    problemId: string;
    language: string;
    code: string;
    now: Date;
    apiKey: string;
    model?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<HintView & { remainingToday: number }> {
  const [problem] = await db
    .select({
      title: problems.title,
      sourceType: problems.sourceType,
      status: problems.status,
      currentVersion: problems.currentVersion,
    })
    .from(problems)
    .where(eq(problems.id, input.problemId))
    .limit(1);
  if (!problem || problem.sourceType !== 'original' || problem.status !== 'published') {
    throw new HintError('Hints are available only on Quadrantcode problems.');
  }

  const [used] = await db
    .select({ value: count() })
    .from(aiHints)
    .where(
      and(eq(aiHints.userId, input.userId), gte(aiHints.createdAt, startOfUtcDay(input.now))),
    );
  const usedToday = Number(used?.value ?? 0);
  if (usedToday >= HINT_DAILY_LIMIT) {
    throw new HintError(`You have used all ${HINT_DAILY_LIMIT} hints for today.`);
  }

  const previous = await hintsToday(db, input);
  if (previous.length >= HINT_MAX_LEVEL) {
    throw new HintError('That was the last hint for this problem today. You have got this.');
  }
  const level = previous.length + 1;

  const native = await getPublicNativeProblem(db, {
    problemId: input.problemId,
    version: problem.currentVersion,
  });
  if (!native) throw new HintError('Hints are available only on Quadrantcode problems.');

  const statement = [
    native.story,
    `Input: ${native.inputFormat}`,
    `Output: ${native.outputFormat}`,
    `Constraints:\n${native.constraints.join('\n')}`,
    ...native.examples.map(
      (example, i) => `Example ${i + 1} input:\n${example.input}\nOutput:\n${example.output}`,
    ),
  ].join('\n');

  const model = input.model ?? DEFAULT_GEMINI_MODEL;
  const hint = await callGemini(
    buildHintPrompt({
      title: problem.title,
      statement,
      language: input.language,
      code: input.code,
      level,
      previous: previous.map((row) => row.hint),
    }),
    { apiKey: input.apiKey, model, fetchImpl: input.fetchImpl ?? fetch },
  );

  const [row] = await db
    .insert(aiHints)
    .values({ userId: input.userId, problemId: input.problemId, level, hint, model })
    .returning({ level: aiHints.level, hint: aiHints.hint, createdAt: aiHints.createdAt });

  return { ...row!, remainingToday: HINT_DAILY_LIMIT - usedToday - 1 };
}
