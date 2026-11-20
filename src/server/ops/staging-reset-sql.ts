// The managed database owns public. The ops role owns the application objects
// in it and can rebuild them without removing the schema or its extensions.
export const stagingResetSql = `
  DO $reset$
  DECLARE
    objects record;
  BEGIN
    FOR objects IN
      WITH RECURSIVE application_relations AS (
        SELECT relation.oid, kinds.drop_order, kinds.object_kind, relation.relname AS name
        FROM pg_catalog.pg_class AS relation
        JOIN (VALUES
          ('v', 'VIEW', 1),
          ('m', 'MATERIALIZED VIEW', 1),
          ('r', 'TABLE', 2),
          ('p', 'TABLE', 2),
          ('S', 'SEQUENCE', 3)
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
      ),
      view_dependencies AS (
        SELECT DISTINCT dependent.oid AS dependent_id, referenced.oid AS referenced_id
        FROM application_relations AS dependent
        JOIN pg_catalog.pg_rewrite AS rewrite ON rewrite.ev_class = dependent.oid
        JOIN pg_catalog.pg_depend AS dependency ON dependency.objid = rewrite.oid
          AND dependency.classid = 'pg_catalog.pg_rewrite'::regclass
          AND dependency.refclassid = 'pg_catalog.pg_class'::regclass
        JOIN application_relations AS referenced ON referenced.oid = dependency.refobjid
        WHERE dependent.drop_order = 1 AND referenced.drop_order = 1
          AND dependent.oid <> referenced.oid
      ),
      view_paths (relation_id, depth) AS (
        SELECT oid, 0 FROM application_relations WHERE drop_order = 1
        UNION ALL
        SELECT dependency.referenced_id, path.depth + 1
        FROM view_paths AS path
        JOIN view_dependencies AS dependency ON dependency.dependent_id = path.relation_id
      ) CYCLE relation_id SET cyclic USING dependency_path,
      view_depths AS (
        -- A referenced view must come after every app view that depends on it.
        SELECT relation_id, max(depth) AS depth
        FROM view_paths
        WHERE NOT cyclic
        GROUP BY relation_id
      ),
      application_objects AS (
        SELECT relation.drop_order, coalesce(view_depths.depth, 0) AS depth,
          relation.object_kind, relation.name
        FROM application_relations AS relation
        LEFT JOIN view_depths ON view_depths.relation_id = relation.oid
        UNION ALL
        SELECT 4, 0, 'TYPE', enum.typname
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
      GROUP BY drop_order, depth, object_kind
      ORDER BY drop_order, depth
    LOOP
      -- Drop tables together for their mutual foreign keys. RESTRICT prevents
      -- a dependent object outside the reset set from being removed.
      EXECUTE format('DROP %s IF EXISTS %s RESTRICT', objects.object_kind, objects.names);
    END LOOP;
  END
  $reset$;
`;
