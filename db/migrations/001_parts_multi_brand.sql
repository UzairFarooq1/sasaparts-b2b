-- ============================================================
-- 001_parts_multi_brand.sql
-- Prepares `parts` for the Techno Automotives inventory import.
--
-- WHY: the inventory carries the same OEM/part number from several
-- suppliers at different prices, e.g. 48815-20290 appears as TOYOTA (500),
-- PERFECT (150), RBI (0) and THAILAND (0). The current
-- UNIQUE KEY uniq_part_number (part_number) rejects all but the first.
-- A stock line is identified by part number + brand + vehicle, so the
-- uniqueness moves to that triple.
-- ============================================================
USE sasaparts_b2b;

-- Brand is part of the identity now, so it must not be NULL.
ALTER TABLE parts
  MODIFY make  VARCHAR(100) NOT NULL DEFAULT '',
  MODIFY model VARCHAR(100) NOT NULL DEFAULT '';

ALTER TABLE parts
  DROP INDEX uniq_part_number,
  ADD UNIQUE KEY uniq_part_line (part_number, make, model);

-- idx_part_number already exists and still serves part-number lookups.
