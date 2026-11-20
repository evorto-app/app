// The managed database owns public. The ops role owns the application objects
// in it and can rebuild them without removing the schema or its extensions.
export const stagingResetSql = `
  DO $reset$
  DECLARE
    objects record;
  BEGIN
    FOR objects IN
      WITH application_objects AS (
        SELECT kinds.drop_order, kinds.object_kind, relation.relname AS name
        FROM pg_catalog.pg_class AS relation
        JOIN (VALUES
          ('v', 'VIEW', 1),
          ('m', 'MATERIALIZED VIEW', 2),
          ('r', 'TABLE', 3),
          ('p', 'TABLE', 3),
          ('S', 'SEQUENCE', 4)
        ) AS kinds(relation_kind, object_kind, drop_order)
          ON relation.relkind::text = kinds.relation_kind
        WHERE relation.relnamespace = 'public'::regnamespace
          AND pg_catalog.pg_get_userbyid(relation.relowner) = CURRENT_USER
          AND NOT EXISTS (
            SELECT FROM pg_catalog.pg_depend AS dependency
            WHERE dependency.classid = 'pg_catalog.pg_class'::regclass
              AND dependency.objid = relation.oid
              AND dependency.deptype = 'e'
          )
        UNION ALL
        SELECT 5, 'TYPE', enum.typname
        FROM pg_catalog.pg_type AS enum
        WHERE enum.typnamespace = 'public'::regnamespace
          AND enum.typtype = 'e'
          AND pg_catalog.pg_get_userbyid(enum.typowner) = CURRENT_USER
          AND NOT EXISTS (
            SELECT FROM pg_catalog.pg_depend AS dependency
            WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
              AND dependency.objid = enum.oid
              AND dependency.deptype = 'e'
          )
      )
      SELECT object_kind, string_agg(format('%I.%I', 'public', name), ', ' ORDER BY name) AS names
      FROM application_objects
      GROUP BY drop_order, object_kind
      ORDER BY drop_order
    LOOP
      -- Drop tables together for their mutual foreign keys. RESTRICT prevents
      -- a dependent object outside the reset set from being removed.
      EXECUTE format('DROP %s IF EXISTS %s RESTRICT', objects.object_kind, objects.names);
    END LOOP;
  END
  $reset$;
`;
