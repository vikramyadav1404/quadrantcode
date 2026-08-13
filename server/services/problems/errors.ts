/**
 * Typed errors for the problem catalog.
 *
 * `ContentPolicyError` deliberately duplicates the F0.2 CHECK constraint
 * `problems_external_link_no_statement`. That duplication is the point:
 *
 *   - the CHECK is the backstop. It cannot be bypassed by a service bug, a
 *     migration script, a bulk import or a psql session, and it fails with
 *     SQLSTATE 23514 and a constraint name.
 *   - this error is the EXPLANATION. A constraint violation tells an admin
 *     that something is wrong; this tells them which field, and why the rule
 *     exists at all.
 *
 * Defence in depth, and a better error. Never remove one because the other
 * exists.
 */

export type ContentPolicyViolation = {
  field: string;
  reason: string;
};

export class ContentPolicyError extends Error {
  readonly code = 'CONTENT_POLICY' as const;
  readonly status = 422 as const;

  constructor(readonly violations: ContentPolicyViolation[]) {
    super(
      'This problem links to an external platform, so it can store metadata and a link only. ' +
        `Remove: ${violations.map((violation) => violation.field).join(', ')}. ` +
        'Copying statements, examples, editorials or test cases from another platform is not ' +
        'permitted. To write your own statement, create the problem as an original instead.',
    );
    this.name = 'ContentPolicyError';
  }
}

/** Raised when a slug already exists. Separate from a policy failure. */
export class DuplicateSlugError extends Error {
  readonly code = 'DUPLICATE_SLUG' as const;
  readonly status = 409 as const;

  constructor(readonly slug: string) {
    super(`A problem with the slug "${slug}" already exists.`);
    this.name = 'DuplicateSlugError';
  }
}

export class ProblemNotFoundError extends Error {
  readonly code = 'PROBLEM_NOT_FOUND' as const;
  readonly status = 404 as const;

  constructor(identifier: string) {
    super(`No problem found for "${identifier}".`);
    this.name = 'ProblemNotFoundError';
  }
}

/** Raised when a cursor cannot be decoded — a tampered or stale page token. */
export class InvalidCursorError extends Error {
  readonly code = 'INVALID_CURSOR' as const;
  readonly status = 400 as const;

  constructor() {
    super('That page link is no longer valid. Start from the first page.');
    this.name = 'InvalidCursorError';
  }
}
