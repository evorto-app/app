-- Manual security audit for platform-global permissions stored in tenant roles.
--
-- The SELECT is safe to run read-only. The cleanup block remains commented out
-- intentionally: inspect every returned role and coordinate the change with the
-- environment owner before removing poisoned values. Application startup and
-- deployment must never execute this file automatically.

SELECT
  r.id,
  r."tenantId",
  r.name,
  p.permission
FROM roles AS r
CROSS JOIN LATERAL jsonb_array_elements_text(r.permissions) AS p(permission)
WHERE p.permission IN ('globalAdmin:*', 'globalAdmin:manageTenants')
ORDER BY r."tenantId", r.name, p.permission;

-- Manual cleanup after the audit result has been reviewed:
--
-- BEGIN;
--
-- UPDATE roles
-- SET permissions =
--   permissions - 'globalAdmin:*' - 'globalAdmin:manageTenants'
-- WHERE permissions ?| ARRAY[
--   'globalAdmin:*',
--   'globalAdmin:manageTenants'
-- ]
-- RETURNING id, "tenantId", name, permissions;
--
-- Re-run the read-only SELECT above and commit only when it returns no rows.
-- COMMIT;
