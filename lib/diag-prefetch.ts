/**
 * DIAGNOSTIC BRANCH ONLY — never merged (issue #26 experiments).
 *
 * Inlined at build time. Unset → `undefined`, which is Next's default prefetch
 * behaviour, so the default build is identical to main. Set to '1' → links
 * that use it do not prefetch, which is experiment E3.
 */
export const DIAG_PREFETCH: false | undefined =
  process.env.NEXT_PUBLIC_DIAG_NO_PREFETCH === '1' ? false : undefined;
