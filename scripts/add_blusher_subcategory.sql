-- Add Blusher as a Face subcategory (run on existing DBs that were seeded before Blusher was added)
-- Safe to run multiple times: only inserts if 'Blusher' under FACE does not exist.

INSERT INTO categories (name, slug, parent_id)
SELECT 'Blusher', 'blusher', c.id
FROM categories c
WHERE c.name = 'FACE' AND c.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories sub
    WHERE sub.name = 'Blusher' AND sub.parent_id = c.id
  );
