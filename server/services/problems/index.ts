/** Public surface of the problem-catalog service. Route handlers import only this. */
export * from './errors';
export * from '@/lib/problems/schemas';
export { encodeCursor, decodeCursor, isValidCursor, type Cursor } from './cursor';
export {
  listProblems,
  listProblemsOriginalsFirst,
  searchProblems,
  getProblemBySlug,
  parseFilters,
  listCatalogPlatforms,
  type ProblemListItem,
  type ProblemPage,
  type ProblemDetail,
} from './queries';
export {
  listTopicSections,
  listCatalogTopics,
  type TopicSection,
  type TopicProblem,
} from './topics';
export {
  createProblem,
  updateProblem,
  archiveProblem,
  unarchiveProblem,
  bulkUpdateTags,
  assertContentPolicy,
} from './mutations';
