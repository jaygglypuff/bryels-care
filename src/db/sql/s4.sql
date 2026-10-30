-- S4 / ADR-076 (editable lists, material brand and standard pack). Shipped as a Drizzle custom migration
-- (verbatim copy) that runs after the generated migration creating `lookup_values` and the new columns.
-- Idempotent.
--
-- 1. The code of a list option is the stored value and never changes (same trigger function as uoms and
--    reason_codes, src/db/sql/w2g.sql).
-- 2. Product families moved from the setting `masterdata.product_families` to the list `product_family`:
--    an organization that had customised the setting gets its values as list rows (code = label = the
--    stored family text, so existing products keep matching). Organizations without the setting keep the
--    shipped defaults until their first change.

DROP TRIGGER IF EXISTS tg_lookup_values_code_immutable ON lookup_values;
--> statement-breakpoint

CREATE TRIGGER tg_lookup_values_code_immutable BEFORE UPDATE ON lookup_values FOR EACH ROW EXECUTE FUNCTION tg_master_code_immutable();
--> statement-breakpoint

INSERT INTO lookup_values (id, organization_id, list_key, code, label, sort_order, is_active)
SELECT gen_random_uuid(), s.organization_id, 'product_family', v.fam, v.fam, (v.ord * 10)::int, true
FROM settings s
CROSS JOIN LATERAL jsonb_array_elements_text(s.value) WITH ORDINALITY AS v(fam, ord)
WHERE s.key = 'masterdata.product_families' AND s.site_id IS NULL AND jsonb_typeof(s.value) = 'array' AND length(btrim(v.fam)) BETWEEN 1 AND 40
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Families already used by products but missing from the list stay selectable for those products' history
-- (inactive rows: shown as labels, not offered for new products).
INSERT INTO lookup_values (id, organization_id, list_key, code, label, sort_order, is_active)
SELECT gen_random_uuid(), p.organization_id, 'product_family', p.family, p.family, 900, false
FROM (SELECT DISTINCT organization_id, family FROM products WHERE length(family) BETWEEN 1 AND 40) p
WHERE EXISTS (SELECT 1 FROM lookup_values l WHERE l.organization_id = p.organization_id AND l.list_key = 'product_family')
ON CONFLICT DO NOTHING;
