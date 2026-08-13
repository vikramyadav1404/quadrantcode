/**
 * Admin authorisation boundary.
 *
 * Every /admin/* route renders inside this layout, so the role check cannot be
 * forgotten on a new admin page. A signed-in non-admin gets a rendered 403 —
 * NOT a redirect to sign-in, which for an already-authenticated user is a
 * redirect loop (F0.3 acceptance criterion).
 */
import { forbidden, unauthorized } from 'next/navigation';
import { getCurrentUser } from '@/server/services/auth/session';
import { hasRole } from '@/server/services/auth/rbac';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) unauthorized(); // 401 — renders app/unauthorized.tsx
  if (!hasRole(user.role, 'admin')) forbidden(); // 403 — renders app/forbidden.tsx

  return <section data-admin-shell>{children}</section>;
}
