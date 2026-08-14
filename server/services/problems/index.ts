/** Public surface of the problem-catalog service. Route handlers import only this. */
export * from './errors';
export * from '@/lib/problems/schemas';
export { encodeCursor, decodeCursor, isValidCursor, type Cursor } from './cursor';
export {
  listProblems,
  searchProblems,
  getProblemBySlug,
  parseFilters,
  type ProblemListItem,
  type ProblemPage,
  type ProblemDetail,
} from './queries';
export {
  createProblem,
  updateProblem,
  archiveProblem,
  unarchiveProblem,
  bulkUpdateTags,
  assertContentPolicy,
} from './mutations';
