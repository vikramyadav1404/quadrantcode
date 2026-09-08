import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessmentPaperLibrarySchema, type AssessmentPaperLibrary } from './content-schema';

export async function loadAssessmentPaperLibrary(
  filePath = resolve('data/assessment-papers.json'),
): Promise<AssessmentPaperLibrary> {
  return assessmentPaperLibrarySchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
}
