-- =====================================================================
-- Scent Obsessed — multiple images per product
-- Run in Supabase → SQL Editor. Safe to re-run.
-- =====================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

-- seed the gallery from the existing single image where one exists
UPDATE products
SET images = to_jsonb(ARRAY[img])
WHERE img IS NOT NULL AND img <> '' AND (images IS NULL OR images = '[]'::jsonb);

SELECT id, name, img, images FROM products ORDER BY sort_order;
