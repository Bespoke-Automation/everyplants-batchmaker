-- ==========================================================================
-- Compartment Rules INSERT statements (simplified - no DO $$ block)
-- Generated from: Kopie van Verpakkingsmodule basis.xlsx
-- Sheet: Compartimenten
-- ==========================================================================

-- Phase 1: Clear existing and insert all rules with alternative_for_id = NULL
DELETE FROM batchmaker.compartment_rules;

-- Compartment Rules INSERT statements

-- ====== C - Oppotten P22 - P40 ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 1, '3cb78abe-0c5b-460e-96d9-d40d01408c66', 1, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 1, 'baf62c8e-9017-4d45-9436-bf87bbb17fd9', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 1, '2e25c709-25e0-4afe-9524-6a651a5c1114', 1, 'ALTERNATIEF', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 2, 'b32311ad-dd64-4c1f-8da1-431293b645e9', 1, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 2, 'baf62c8e-9017-4d45-9436-bf87bbb17fd9', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 3, '2ed5cfce-c14c-4423-a85f-a67d8485cb4b', 1, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 3, '2e25c709-25e0-4afe-9524-6a651a5c1114', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 4, 'db5569e8-b76e-492b-aaf0-0e4bf82ad130', 1, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 4, '7efa124a-77c4-4092-92f8-0491b7a5b093', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 4, 'baf62c8e-9017-4d45-9436-bf87bbb17fd9', 1, 'ALTERNATIEF', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 4, '2e25c709-25e0-4afe-9524-6a651a5c1114', 1, 'ALTERNATIEF', NULL, 3, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 5, 'c1c8d564-dabf-4738-8bbd-c27d1e1b9b3d', 1, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 5, '7efa124a-77c4-4092-92f8-0491b7a5b093', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 5, 'baf62c8e-9017-4d45-9436-bf87bbb17fd9', 1, 'ALTERNATIEF', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 5, '2e25c709-25e0-4afe-9524-6a651a5c1114', 1, 'ALTERNATIEF', NULL, 3, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'cf854272-3e12-4aa5-b911-6740eff617c0', 5, '4e16d4c4-33db-4522-b4d0-0d4ffd95ab4c', 1, 'ALTERNATIEF', NULL, 4, true);

-- ====== C - Oppotten P41 - P65 ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'f7b52ae0-85d6-45a1-a7c5-1ab1fa62bcc7', 1, '5049cbe5-2121-4869-b66c-9dc33339342f', 1, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'f7b52ae0-85d6-45a1-a7c5-1ab1fa62bcc7', 1, '2a0ad4ec-b6ec-43e0-8f4b-55887f2d5809', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'f7b52ae0-85d6-45a1-a7c5-1ab1fa62bcc7', 1, '9f188583-6260-4220-aa7d-00b58a579bf7', 1, 'ALTERNATIEF', NULL, 2, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'f7b52ae0-85d6-45a1-a7c5-1ab1fa62bcc7', 2, 'e35ce3b7-7d39-44f3-8324-a50c2dea07fe', 1, 'OF', NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'f7b52ae0-85d6-45a1-a7c5-1ab1fa62bcc7', 2, '2a0ad4ec-b6ec-43e0-8f4b-55887f2d5809', 1, 'EN', NULL, 1, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), 'f7b52ae0-85d6-45a1-a7c5-1ab1fa62bcc7', 2, '9f188583-6260-4220-aa7d-00b58a579bf7', 1, 'ALTERNATIEF', NULL, 2, true);

-- ====== C - Oppotten P66 - P80 ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '6d13a3c5-c2f8-47e9-8aa1-74047ba9b221', 1, '7f452d22-fac7-49fd-ae5d-253368e46fed', 1, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '6d13a3c5-c2f8-47e9-8aa1-74047ba9b221', 1, 'fb0a7503-1742-45a1-b43f-f474c2d51b09', 1, 'EN', NULL, 1, true);

-- ====== C - Oppotten P81 - P100 ======
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '4efdd01e-8752-431b-ab6e-13480bd1142d', 1, '2797f20a-63e3-44fe-a8b5-b1b96641ea11', 1, NULL, NULL, 0, true);
INSERT INTO batchmaker.compartment_rules (id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order, is_active) VALUES (gen_random_uuid(), '4efdd01e-8752-431b-ab6e-13480bd1142d', 1, 'fb0a7503-1742-45a1-b43f-f474c2d51b09', 1, 'EN', NULL, 1, true);

