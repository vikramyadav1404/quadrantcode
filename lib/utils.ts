import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class-name merge helper expected by shadcn/ui primitives. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
