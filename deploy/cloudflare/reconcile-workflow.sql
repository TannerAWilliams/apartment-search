-- Operator-only recovery. Read the checklist in README.md before any production use.
-- ?1: exact ETag from the registry inspection
-- ?2: exact base64 part body from the SAME inspection, already decoded and verified
DELETE FROM apartment_objects
WHERE key = 'rentals/complete-refresh-workflow.json'
  AND etag = ?1
  AND part_count = 1
  AND EXISTS (
    SELECT 1
    FROM apartment_object_parts
    WHERE key = 'rentals/complete-refresh-workflow.json'
      AND etag = ?1
      AND part = 0
      AND body = ?2
  );
