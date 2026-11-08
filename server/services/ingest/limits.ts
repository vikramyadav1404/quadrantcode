/**
 * Import caps, in one place.
 *
 * Every one of these is enforced BEFORE the work it bounds, not after. A cap
 * checked once the file is already parsed has not protected anything — the
 * memory was allocated, the CPU was spent, and the only thing the check adds is
 * a nicer error message on the way out.
 */

export const IMPORT_LIMITS = {
  /**
   * Upload size, checked against the raw byte length before a single byte is
   * handed to the parser.
   *
   * 2 MiB is roughly 20,000 rows of realistic CSV, comfortably above the row
   * cap below — so in practice the row cap is what a legitimate user meets, and
   * this one exists to stop something that is not a problem list at all.
   */
  maxBytes: 2 * 1024 * 1024,

  /**
   * Row cap, enforced DURING the parse by aborting the stream.
   *
   * It cannot be checked up front — the row count is not knowable without
   * parsing — so the parser stops at the first row past the cap rather than
   * completing and then counting. A 2 MiB file of one-character rows is ~1
   * million rows; that must not be materialised in order to reject it.
   */
  maxRows: 5_000,

  /**
   * Above this, the import runs as a background job rather than inline.
   * From the ticket: "files over 100 rows run as a background job".
   */
  jobThresholdRows: 100,

  /**
   * Rows per chunk in the runner. Also the resume granularity: the watermark
   * advances per chunk, so a resumed job re-processes at most this many rows —
   * safe, because row processing is idempotent.
   */
  chunkRows: 100,
} as const;

/** The two caps `parseImportCsv` enforces. */
export type ImportFileLimits = { readonly maxBytes: number; readonly maxRows: number };

/**
 * The admin catalog import (`/admin/problems/import`): bigger files, worked in
 * chunks the browser drives one request at a time.
 *
 * 3 MiB stays under Vercel's ~4.5 MB request-body limit with room for the
 * multipart envelope; 10,000 rows of realistic CSV is about 1 MiB, so the row
 * cap is the one an admin meets. A 500-row chunk is a handful of bulk
 * statements, well inside the 60 s function limit.
 */
export const CATALOG_IMPORT_LIMITS = {
  maxBytes: 3 * 1024 * 1024,
  maxRows: 10_000,
  chunkRows: 500,
} as const;

/** Every column the importer understands. `title` and `url` are required. */
export const IMPORT_COLUMNS = ['title', 'platform', 'url', 'difficulty', 'topic'] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
