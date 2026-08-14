/**
 * F1.1 EXPLAIN write-up. Appends the catalog plans to docs/performance.md.
 *
 * The dataset is the SYNTHETIC perf fixture (tests/fixtures/perf-dataset.ts) —
 * never the application seed, which is 30 hand-checked real problems. Padding
 * the real seed with invented URLs to reach a row count would be a C1
 * violation even in a test database.
 */
import { appendFileSync } from 'node:fs';
import 'dotenv/config';
import postgres from 'postgres';

const QUERIES = () => [
  {
    id: 'F1.1-1',
    what: 'Catalog list, first page (no filters)',
    index: 'problems_status_difficulty_idx',
    sql: `SELECT id, slug, title, difficulty, estimated_minutes FROM problems
          WHERE status = 'published'
          ORDER BY created_at DESC NULLS LAST, id DESC NULLS LAST LIMIT 25`,
    params: [] as unknown[],
  },
  {
    id: 'F1.1-2',
    what: 'Catalog list filtered by difficulty, second page (keyset)',
    index: 'problems_status_difficulty_idx',
    sql: `SELECT id, slug, title FROM problems
          WHERE status = 'published' AND difficulty = 'medium'
            AND (created_at, id) < (now() - interval '5 days', $1::uuid)
          ORDER BY created_at DESC NULLS LAST, id DESC NULLS LAST LIMIT 25`,
    params: ['00000000-0000-0000-0000-000000000000'],
  },
  {
    id: 'F1.1-3',
    what: 'Title search',
    index: 'problems_search_vector_idx',
    sql: `SELECT id, slug, title FROM problems
          WHERE status = 'published'
            AND search_vector @@ websearch_to_tsquery('english', 'dijkstra')
          ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', 'dijkstra')) DESC
          LIMIT 25`,
    params: [],
  },
  {
    id: 'F1.1-4',
    what: 'Catalog filtered by topic tag (EXISTS, not JOIN)',
    index: 'problem_tags_type_value_idx',
    sql: `SELECT p.id, p.slug FROM problems p
          WHERE p.status = 'published'
            AND EXISTS (SELECT 1 FROM problem_tags t
                        WHERE t.problem_id = p.id AND t.tag_type = 'topic' AND t.tag_value = 'graphs')
          ORDER BY p.created_at DESC NULLS LAST, p.id DESC NULLS LAST LIMIT 25`,
    params: [],
  },
];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL required.');
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    const [count] = await sql`SELECT count(*) AS n FROM problems`;

    const sections: string[] = [];
    for (const q of QUERIES()) {
      const rows = await sql.unsafe(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q.sql}`,
        q.params as never[],
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      const timing = /Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? '?';
      sections.push(
        `### ${q.id} · ${q.what}\n\nExpected index: \`${q.index}\` · **Execution: ${timing} ms**\n\n` +
          '```sql\n' +
          q.sql.replace(/^ +/gm, '  ').trim() +
          '\n```\n\n```\n' +
          plan +
          '\n```\n',
      );
    }

    appendFileSync(
      'docs/performance.md',
      `\n\n---\n\n# F1.1 · problem catalog\n\n` +
        `> **The dataset is synthetic.** These plans were captured against\n` +
        `> \`tests/fixtures/perf-dataset.ts\` (${count!.n} rows), NOT against the\n` +
        `> application seed. The seed is 30 hand-checked real problems; padding it\n` +
        `> with invented URLs to reach a row count would violate C1 even in a test\n` +
        `> database. Selectivity, not row count, decides a plan — see decisions D3.\n\n` +
        sections.join('\n'),
      'utf8',
    );
    console.log('appended F1.1 plans to docs/performance.md');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
