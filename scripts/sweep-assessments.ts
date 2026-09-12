import 'dotenv/config';
import { closeDb, getDb } from '@/server/db/client';
import { sweepExpiredAssessments } from '@/server/services/assessments';

try {
  const count = await sweepExpiredAssessments(getDb(), new Date());
  console.log(`auto-submitted ${count} expired assessment attempt(s)`);
} finally {
  await closeDb();
}
