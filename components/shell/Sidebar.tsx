'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from './nav-items';
import { DIAG_PREFETCH } from '@/lib/diag-prefetch';

/** Primary navigation, hidden below 768px where BottomNav takes over. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      data-nav="sidebar"
      className="hidden w-56 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-3 md:block"
    >
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={DIAG_PREFETCH}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm ${
                  active
                    ? 'bg-[var(--surface-raised)] font-medium text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
