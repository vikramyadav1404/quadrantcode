# Database backup

Neon's free plan keeps six hours of history and offers no downloadable backup.
`.github/workflows/db-backup.yml` fills that gap: every day at 02:13 IST it
dumps production, restores the dump into a throwaway Postgres on the runner,
checks that every table came back with the same row count, encrypts the dump
with AES-256 and keeps it as a workflow artifact for 35 days.

Only reads production. Nothing in this workflow writes to Neon.

## Secrets

| Secret                | What                                                      |
| --------------------- | --------------------------------------------------------- |
| `DIRECT_DATABASE_URL` | Already used by migrations; the direct, non-pooled URL    |
| `BACKUP_PASSPHRASE`   | At least 16 characters. Keep a copy in a password manager |

**Lose the passphrase and every backup is unreadable.** Changing it later only
affects new backups; older ones still need the old passphrase.

The repository is public and anyone signed in to GitHub can download its
artifacts. That is why only the encrypted file is uploaded and why the log
prints only table and row totals.

## What a run proves

- Row counts are taken just before and just after the dump; each restored table
  must match, or fall between the two if it was written to meanwhile
- Same list of tables in production and in the restore
- The encrypted file is decrypted again and compared byte for byte
- A `.sha256` file travels with it

A failed run emails whoever last changed the workflow file.

## Restore

1. GitHub → Actions → **Database backup** → pick a green run → download the
   artifact and unzip it.
2. Check the file:
   ```sh
   sha256sum -c quadrantcode-db-*.dump.gpg.sha256
   ```
3. Decrypt (asks for the passphrase):
   ```sh
   gpg --output backup.dump --decrypt quadrantcode-db-*.dump.gpg
   ```
4. Restore into an **empty database**, never straight over production. Create
   one in the Neon console (Databases → New database, e.g. `restore_check`),
   then, with its direct URL:
   ```sh
   pg_restore --no-owner --no-acl --dbname "<restore_check direct URL>" backup.dump
   ```
   Use a `pg_restore` with the same major version as the server.
5. Check the app against the branch. Only then point production at it or copy
   the rows you need back.

## Run one now

Actions → **Database backup** → **Run workflow**. Do this before any risky
migration as well, in addition to the six-hour Neon history.
