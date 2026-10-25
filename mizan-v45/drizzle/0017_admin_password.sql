-- Owner-changeable admin password (2026-10-25). Additive only: two nullable-by-default columns on the existing single-row
-- admin_access table. Empty password_hash means "use the ADMIN_PASSWORD_HASH Worker secret" (behaviour unchanged until the
-- owner changes the password from the admin panel). Rollback: leaving the columns empty restores the secret-only login.
ALTER TABLE admin_access ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_access ADD COLUMN password_changed_at TEXT NOT NULL DEFAULT '';
