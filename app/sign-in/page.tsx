import { permanentRedirect } from 'next/navigation';

/**
 * The route was /sign-in before the F0.3 amendment renamed it to /login.
 *
 * Kept as a permanent redirect because magic links already delivered to inboxes
 * point at the old path, and a 404 there would strand a user who is holding a
 * valid credential. Removable once the longest link TTL (15 minutes) has
 * elapsed for every issued link — in practice, once deployed.
 */
export default function SignInRedirect() {
  permanentRedirect('/login');
}
