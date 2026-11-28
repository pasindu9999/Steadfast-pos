# Restoring the database

The nightly **Backup** workflow (`.github/workflows/backup.yml`) writes one file:
`pos-<UTC time>.sql.gz.age`, a plain SQL dump, gzipped, then encrypted with
[age](https://age-encryption.org). Only the private key made during setup can read it.

| Where | Kept |
|---|---|
| R2, `daily/` | 30 days |
| R2, `monthly/` (the run on the 1st of a month, UTC) | 12 months |
| Workflow artifact, when the R2 secrets are not set | 30 days |

**Without the private key no backup can be read.** Keep it in a password manager, and a second copy
somewhere offline. Never commit it or put it in GitHub.

## What you need

- Docker, for `psql` in the same major version as the server.
- age: `winget install FiloSottile.age` on Windows, `brew install age` on macOS.
- The private key file (`pos-backup.key`).

The commands are for Git Bash, macOS or Linux. Work in an empty folder **outside the repository**.

## 1. Fetch a backup

- **R2:** Cloudflare dashboard → R2 → your bucket → `daily/` or `monthly/` → download the file.
- **Artifact:** GitHub → Actions → Backup → the run → download the artifact, then unzip it.

## 2. Decrypt

```bash
age --decrypt --identity /path/to/pos-backup.key --output backup.sql.gz pos-*.sql.gz.age
gunzip backup.sql.gz          # leaves backup.sql
```

`backup.sql` holds shop data in the clear. Delete it as soon as you are done.

## 3. Restore into an empty database

Never restore over the live database. In the Neon console:

1. **Branches → Create branch**, named for example `restore-drill`.
2. On that branch, **Databases → New database**, named `restore_check`. A new branch is a copy of its
   parent, so the restore goes into this new, empty database.
3. **Connect**, with that branch and database selected and **connection pooling off**. Copy the
   connection string.

```bash
read -rs RESTORE_URL && export RESTORE_URL    # paste, then Enter; it stays out of your history

# Use the server's major version in place of 17.
docker run --rm --interactive --env RESTORE_URL postgres:17-alpine \
  sh -c 'psql "$RESTORE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --single-transaction --quiet' \
  < backup.sql
```

It either restores everything or, at the first error, nothing.

## 4. Check it

```bash
docker run --rm --interactive --env RESTORE_URL postgres:17-alpine \
  sh -c 'psql "$RESTORE_URL" --no-psqlrc' <<'SQL'
SELECT 'products' AS table, count(*) FROM products
UNION ALL SELECT 'product_variants', count(*) FROM product_variants
UNION ALL SELECT 'sales', count(*) FROM sales
UNION ALL SELECT 'returns', count(*) FROM returns
UNION ALL SELECT 'stock_movements', count(*) FROM stock_movements
UNION ALL SELECT 'sync_inbox', count(*) FROM sync_inbox;

SELECT max(received_at) AS newest_sale FROM sales;
SELECT migration_name FROM _prisma_migrations ORDER BY migration_name;

-- Stock must still equal the sum of its ledger (ARCH §5.1). Expect no rows.
SELECT l.variant_id, l.on_hand, m.total
FROM inventory_levels l
FULL JOIN (
  SELECT store_id, variant_id, sum(delta) AS total FROM stock_movements GROUP BY 1, 2
) m USING (store_id, variant_id)
WHERE l.on_hand IS DISTINCT FROM m.total;
SQL
```

The restore is good when:

- [ ] the counts match the live database, or differ only by what happened since the backup;
- [ ] the newest sale is from shortly before the backup ran;
- [ ] every folder in `apps/api/prisma/migrations` that existed then is listed;
- [ ] the last query returns no rows.

## 5. Clean up

Delete the `restore-drill` branch in Neon, then `rm backup.sql` and `unset RESTORE_URL`.

## Monthly drill

Do steps 1 to 5 on the first working day of each month with the newest backup, and note the result:

| Date | Backup file | Counts match | Ledger query empty | By |
|---|---|---|---|---|
| | | | | |

Also check that the Backup workflow has run every night. GitHub switches off scheduled workflows in a
repository with no activity for 60 days.

## Recovering the live system

1. Restore into a new database (steps 1 to 4) on a new branch or project.
2. In Render, point `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) at it and deploy. Pending
   migrations run at start-up.
3. Point the `BACKUP_DATABASE_URL` secret at it too.
4. **Keep the terminals' data.** They hold the sales made since the backup. At a terminal's next new
   sale the server answers `409` with the number it expects, and the terminal sends everything from
   there again (ARCH §4.4). Make a sale on each terminal, or wait for one, then compare today's
   sales with the receipts.
5. What a backup can't bring back: catalogue edits, stock receipts, count adjustments and terminal
   enrolments made after it. The restored server refuses the token of a terminal enrolled since then.
   That till has to be enrolled again, which today means clearing its site data, so first copy down
   any receipts it has not uploaded.
