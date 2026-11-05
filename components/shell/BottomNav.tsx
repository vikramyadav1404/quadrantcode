'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BOTTOM_NAV_ITEMS } from './nav-items';
import { LinkPending } from '@/components/ui/LinkPending';

/** Shown under 768px only; the sidebar covers wider viewports. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      data-nav="bottom"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] md:hidden"
    >
      <ul className="flex justify-around">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                }`}
              >
                <span aria-hidden="true" className="text-base">
                  {item.icon}
                </span>
                {item.short}
                <LinkPending placement="absolute top-1.5 right-[calc(50%-1.25rem)]" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
