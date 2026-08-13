/** Auth.js route handlers. Everything else goes through server/services/auth. */
import { handlers } from '@/server/services/auth/config';

export const { GET, POST } = handlers;
