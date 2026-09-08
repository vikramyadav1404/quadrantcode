import { loadNativeProblemBatches } from '@/server/services/native-content';
import { validateNativeLibrary } from '@/server/services/native-content/schema';

const batches = await loadNativeProblemBatches();
const summary = validateNativeLibrary(batches);
console.log(JSON.stringify(summary, null, 2));
