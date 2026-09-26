/**
 * F4.7 · what a public profile may contain, in the client-safe layer.
 *
 * This type IS the privacy contract: a field that is not here cannot reach the
 * public page or its share cards. No email, no bio (the disclosure the user
 * agreed to does not name it), no code, notes, mistakes or reflections. Each
 * section is null when the owner has switched it off — and when it is off, the
 * service never queries it.
 */

export type PublicProfileView = {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  /** Initials and colour, derived from the display name only — never the email. */
  appearance: { initials: string; backgroundColor: string; color: string };
  currentStreak: number | null;
  longestStreak: number | null;
  totalSolved: number | null;
  /** Solved problems per topic, largest first. */
  topics: { topic: string; solved: number }[] | null;
};

export type MonthlyCardView = {
  handle: string;
  displayName: string;
  /** `YYYY-MM`, in the owner's timezone. */
  month: string;
  /** Under the "total solved" section. */
  solvedThisMonth: number | null;
  /** Days in the month with at least one solve; under the "streak" section. */
  activeDays: number | null;
  currentStreak: number | null;
  /** Under the "topics" section. */
  topTopic: string | null;
};

/** The three share-card sizes the ticket names. */
export const CARD_FORMATS = {
  linkedin: { width: 1200, height: 627 },
  x: { width: 1600, height: 900 },
  whatsapp: { width: 1080, height: 1080 },
} as const;

export type CardFormat = keyof typeof CARD_FORMATS;
