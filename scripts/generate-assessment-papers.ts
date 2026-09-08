import { writeFile } from 'node:fs/promises';
import { assessmentPaperLibrarySchema } from '@/server/services/assessments';
import { loadNativeProblemBatches } from '@/server/services/native-content';

const batches = await loadNativeProblemBatches();
const problems = batches.flatMap((batch) => batch.problems);
const companies = [
  { slug: 'amazon', name: 'Amazon' },
  { slug: 'google', name: 'Google' },
  { slug: 'microsoft', name: 'Microsoft' },
  { slug: 'meta', name: 'Meta' },
  { slug: 'adobe', name: 'Adobe' },
  { slug: 'flipkart', name: 'Flipkart' },
  { slug: 'atlassian', name: 'Atlassian' },
  { slug: 'uber', name: 'Uber' },
  { slug: 'goldman-sachs', name: 'Goldman Sachs' },
  { slug: 'walmart', name: 'Walmart' },
] as const;

const desiredDifficulties = ['easy', 'medium', 'medium', 'hard'] as const;
const papers = companies.flatMap((company) => {
  const associated = problems.filter((problem) =>
    problem.companies.some((association) => association.companySlug === company.slug),
  );
  if (associated.length < 8) {
    throw new Error(`Expected at least eight company-pattern problems for ${company.slug}.`);
  }

  const used = new Set<string>();
  return ['A', 'B'].map((edition) => {
    const selected = desiredDifficulties.map((difficulty) => {
      const usedTopics = new Set(
        [...used]
          .map((slug) => problems.find((problem) => problem.slug === slug)?.primaryTopic)
          .filter(Boolean),
      );
      const candidate =
        associated.find(
          (problem) =>
            problem.difficulty === difficulty &&
            !used.has(problem.slug) &&
            !usedTopics.has(problem.primaryTopic),
        ) ??
        associated.find(
          (problem) => problem.difficulty === difficulty && !used.has(problem.slug),
        );
      if (!candidate) {
        throw new Error(
          `Could not select a ${difficulty} problem for ${company.slug} paper ${edition}.`,
        );
      }
      used.add(candidate.slug);
      return candidate;
    });

    return {
      slug: `${company.slug}-original-pattern-mock-${edition.toLocaleLowerCase()}`,
      title: `${company.name} Original Pattern Mock ${edition}`,
      companySlug: company.slug,
      role: edition === 'A' ? 'Software Engineer' : 'Entry-Level Software Engineer',
      patternPeriod: `Evergreen original practice set — Edition ${edition}`,
      paperType: 'pattern_based_mock' as const,
      durationMinutes: 90,
      instructions:
        `This is an independently authored Quadrantcode pattern-based mock for descriptive ${company.name} preparation. ` +
        'It is not an official paper, verified past paper, hiring leak, or endorsement. Solve all four questions within the server-timed window. ' +
        'Run Code uses visible or custom cases; Submit Question uses the complete protected test set. The final score is based only on server-verified submissions.',
      status: 'needs_review' as const,
      version: 1,
      provenance: {
        contentSource: 'quadrantcode-original' as const,
        independentlyCreated: true as const,
        licenseName: 'Quadrantcode Original Practice Content License',
        author: 'Quadrantcode editorial team',
        note: 'Independently assembled from Quadrantcode-original problems and labelled only as a pattern-based mock.',
      },
      questions: selected.map((problem, index) => ({
        problemSlug: problem.slug,
        ordinal: index + 1,
        marks: 25,
      })),
    };
  });
});

const library = assessmentPaperLibrarySchema.parse({
  schemaVersion: 1,
  reviewStatus: 'needs_review',
  papers,
});

await writeFile('data/assessment-papers.json', `${JSON.stringify(library, null, 2)}\n`);
console.log(`validated ${library.papers.length} pattern-based mock papers`);
for (const company of companies) {
  console.log(
    `${company.name}: ${library.papers.filter((paper) => paper.companySlug === company.slug).length}`,
  );
}
