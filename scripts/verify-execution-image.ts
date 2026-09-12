import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { IMMUTABLE_SANDBOX_IMAGE, sandboxToolchainSchema } from '@/server/services/execution';

const lockSchema = z.object({
  schemaVersion: z.literal(1),
  verified: z.boolean(),
  imageDigest: z.string().nullable(),
  baseImage: z.object({ required: z.string(), digest: z.string().nullable() }),
  nodeImage: z.object({ required: z.string(), digest: z.string().nullable() }),
  toolchains: sandboxToolchainSchema,
  note: z.string(),
});

async function main(): Promise<void> {
  const path = resolve('sandbox/toolchain-lock.json');
  const lock = lockSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const issues: string[] = [];

  if (!lock.verified) issues.push('toolchain lock is not marked verified');
  if (!lock.imageDigest || !IMMUTABLE_SANDBOX_IMAGE.test(lock.imageDigest)) {
    issues.push('built VCR image digest is missing or mutable');
  }
  if (!lock.baseImage.digest || !IMMUTABLE_SANDBOX_IMAGE.test(lock.baseImage.digest)) {
    issues.push('base image digest is missing or mutable');
  }
  if (!lock.nodeImage.digest || !IMMUTABLE_SANDBOX_IMAGE.test(lock.nodeImage.digest)) {
    issues.push('Node image digest is missing or mutable');
  }

  if (issues.length > 0) {
    for (const issue of issues) console.error(`execution image: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log('execution image lock is release-ready');
}

void main();
