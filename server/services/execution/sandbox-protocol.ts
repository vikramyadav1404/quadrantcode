import { z } from 'zod';

export const sandboxCommandResultSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(['exited', 'timed_out', 'oom', 'output_limit', 'signaled']),
    exitCode: z.number().int().nullable(),
    signal: z.number().int().nullable(),
    cpuMs: z.number().int().nonnegative(),
    wallMs: z.number().int().nonnegative(),
    memoryKb: z.number().int().nonnegative().nullable(),
    outputTruncated: z.boolean(),
  })
  .strict();

export type SandboxCommandResult = z.infer<typeof sandboxCommandResultSchema>;

export const sandboxToolchainSchema = z
  .object({
    c11: z.string().min(1).max(160),
    cpp17: z.string().min(1).max(160),
    java: z.string().min(1).max(160),
    python3: z.string().min(1).max(160),
    javascript: z.string().min(1).max(160),
  })
  .strict();

export const IMMUTABLE_SANDBOX_IMAGE = /^.+@sha256:[a-f0-9]{64}$/i;
