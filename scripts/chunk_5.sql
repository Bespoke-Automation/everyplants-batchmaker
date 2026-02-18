-- ====== C - Eurodoos 60 ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'dd1d9a20-999e-44ce-a15a-69f2a6962c70', 1, '8035683c-29e3-4069-8e15-dd5ce7170b46', 0, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'dd1d9a20-999e-44ce-a15a-69f2a6962c70', 1, '38cb2fad-d7bf-4084-b8f3-4cffc77afcda', 8, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'dd1d9a20-999e-44ce-a15a-69f2a6962c70', 1, '7efa124a-77c4-4092-92f8-0491b7a5b093', 2, 'EN', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'dd1d9a20-999e-44ce-a15a-69f2a6962c70', 1, 'f3f485ed-ed91-4e8c-98eb-1af00bbeb44a', 8, 'EN', NULL, 3, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'dd1d9a20-999e-44ce-a15a-69f2a6962c70', 1, 'baf62c8e-9017-4d45-9436-bf87bbb17fd9', 2, 'EN', NULL, 4, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'dd1d9a20-999e-44ce-a15a-69f2a6962c70', 1, '2e25c709-25e0-4afe-9524-6a651a5c1114', 1, 'EN', NULL, 5, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'dd1d9a20-999e-44ce-a15a-69f2a6962c70', 1, '4e16d4c4-33db-4522-b4d0-0d4ffd95ab4c', 1, 'EN', NULL, 6, true);

-- ====== C - Eurodoos 40 ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'd314a8af-4841-4f84-889a-e6ab7d428fcd', 1, '8035683c-29e3-4069-8e15-dd5ce7170b46', 1, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'd314a8af-4841-4f84-889a-e6ab7d428fcd', 2, '38cb2fad-d7bf-4084-b8f3-4cffc77afcda', 8, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'd314a8af-4841-4f84-889a-e6ab7d428fcd', 2, '7efa124a-77c4-4092-92f8-0491b7a5b093', 2, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'd314a8af-4841-4f84-889a-e6ab7d428fcd', 2, 'f3f485ed-ed91-4e8c-98eb-1af00bbeb44a', 10, 'EN', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'd314a8af-4841-4f84-889a-e6ab7d428fcd', 2, 'baf62c8e-9017-4d45-9436-bf87bbb17fd9', 2, 'EN', NULL, 3, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'd314a8af-4841-4f84-889a-e6ab7d428fcd', 2, '2e25c709-25e0-4afe-9524-6a651a5c1114', 1, 'EN', NULL, 4, true);

-- ====== C - Surprise box ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 1, '8c8fa4ba-0aa5-46e0-a1da-b122847f2b2b', 6, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 1, 'fe0e1b2a-2fd4-4507-8293-2f1eaa812387', 6, 'ALTERNATIEF', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 1, 'f3f485ed-ed91-4e8c-98eb-1af00bbeb44a', 6, 'EN', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 2, 'e2201adb-3696-458e-a041-ab3837760fa8', 6, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 3, 'fe0e1b2a-2fd4-4507-8293-2f1eaa812387', 3, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 3, '38cb2fad-d7bf-4084-b8f3-4cffc77afcda', 2, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 3, '8c8fa4ba-0aa5-46e0-a1da-b122847f2b2b', 3, 'EN', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '8f149e7d-0503-49ea-b37a-29deb3748004', 3, 'f3f485ed-ed91-4e8c-98eb-1af00bbeb44a', 4, 'EN', NULL, 3, true);
-- WARNING: Skipping unmatched shipping unit 'BUNDEL | Verrassingsbox 6 planten' (row 13)

-- ====== C - Kokerdoos 2x P12 ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 1, '8c8fa4ba-0aa5-46e0-a1da-b122847f2b2b', 2, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 1, 'f3f485ed-ed91-4e8c-98eb-1af00bbeb44a', 2, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 2, 'fe0e1b2a-2fd4-4507-8293-2f1eaa812387', 2, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 2, 'f3f485ed-ed91-4e8c-98eb-1af00bbeb44a', 2, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 3, '8c8fa4ba-0aa5-46e0-a1da-b122847f2b2b', 1, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 3, 'fe0e1b2a-2fd4-4507-8293-2f1eaa812387', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 3, 'f3f485ed-ed91-4e8c-98eb-1af00bbeb44a', 2, 'EN', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 4, '52ca0433-4879-4bff-8007-b019012fc8d7', 4, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '00ecc6db-0035-48a6-bfb3-d6f38e6d0c06', 4, '4aded71a-1cda-47f8-b292-db39645633bc', 4, 'EN', NULL, 1, true);

-- ====== C - 2x Kokerdoos 100cm (1 verzendlabel) ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '2d6aae88-a2e8-498a-bdb8-136526c879b4', 1, '3548b11e-c081-46f5-aa2b-4a8148844dda', 2, NULL, NULL, 0, true);


-- Phase 2: Set alternative_for_id for ALTERNATIEF rules
-- For each ALTERNATIEF rule, find the closest non-ALTERNATIEF rule before it
-- in the same packaging_id + rule_group (by sort_order)
UPDATE batchmaker.compartment_rules alt
SET alternative_for_id = (
  SELECT ref.id FROM batchmaker.compartment_rules ref
  WHERE ref.packaging_id = alt.packaging_id
  AND ref.rule_group = alt.rule_group
  AND ref.sort_order < alt.sort_order
  AND (ref.operator IS NULL OR ref.operator != 'ALTERNATIEF')
  ORDER BY ref.sort_order DESC
  LIMIT 1
)
WHERE alt.operator = 'ALTERNATIEF';
