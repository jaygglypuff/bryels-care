-- G2 / ADR-080 (production flow v2: materials list, weighing, steps, curing). Ship as a Drizzle custom
-- migration (verbatim copy) that runs after the generated migration creating `batch_material_picks`.
-- Idempotent: every statement can run twice without changing the result.
--
-- 1. The materials-list ticks are append-only (a tick is withdrawn by a new `untaken` row).
-- 2. `production.weighing.second_person_check` changes from a boolean to all | marked | none
--    (ADR-080 §4). Existing organizations keep their behaviour:
--      false → none;
--      true (stored, or the old default true when nothing was stored) → all, except an organization
--      that already unticked "needs a check" on a formula line: it gets `marked`, which is exactly what
--      the old `true` did for it (the old rule was "line flag AND setting").
--    New organizations get the registry default `marked` (no row).
-- 3. `production.output.expiry_basis` gains `mixing_date`, the new default (ADR-080 §7). Existing
--    organizations without a stored value keep `manufacture_date` (batch start) by storing it.

CREATE OR REPLACE FUNCTION g2_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only (% refused); record a new row instead', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_batch_material_picks_append_only ON batch_material_picks;
--> statement-breakpoint
CREATE TRIGGER tg_batch_material_picks_append_only BEFORE UPDATE OR DELETE ON batch_material_picks
  FOR EACH ROW EXECUTE FUNCTION g2_append_only();
--> statement-breakpoint

UPDATE settings s
SET value = to_jsonb(
  CASE
    WHEN s.value = 'false'::jsonb THEN 'none'
    WHEN EXISTS (
      SELECT 1 FROM bom_lines bl
      JOIN formula_revisions fr ON fr.id = bl.formula_revision_id
      JOIN formulas f ON f.id = fr.formula_id
      WHERE f.organization_id = s.organization_id AND bl.requires_checker = false
    ) THEN 'marked'
    ELSE 'all'
  END
), updated_at = now()
WHERE s.key = 'production.weighing.second_person_check' AND jsonb_typeof(s.value) = 'boolean';
--> statement-breakpoint

INSERT INTO settings (id, organization_id, scope, site_id, user_id, key, value, updated_at)
SELECT gen_random_uuid(), o.id, 'organization', NULL, NULL, 'production.weighing.second_person_check',
  to_jsonb(CASE WHEN EXISTS (
      SELECT 1 FROM bom_lines bl
      JOIN formula_revisions fr ON fr.id = bl.formula_revision_id
      JOIN formulas f ON f.id = fr.formula_id
      WHERE f.organization_id = o.id AND bl.requires_checker = false
    ) THEN 'marked' ELSE 'all' END),
  now()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM settings x
  WHERE x.organization_id = o.id AND x.scope = 'organization' AND x.key = 'production.weighing.second_person_check'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO settings (id, organization_id, scope, site_id, user_id, key, value, updated_at)
SELECT gen_random_uuid(), o.id, 'organization', NULL, NULL, 'production.output.expiry_basis', to_jsonb('manufacture_date'::text), now()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM settings x
  WHERE x.organization_id = o.id AND x.scope = 'organization' AND x.key = 'production.output.expiry_basis'
)
ON CONFLICT DO NOTHING;
