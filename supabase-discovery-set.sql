-- =====================================================================
-- Scent Obsessed — Discovery Set only  (v2 — fixes the NOT NULL error)
-- The four 20ml bottles are contents of the set, not separate products.
-- Run in Supabase → SQL Editor. Safe to re-run.
-- =====================================================================

-- 1. the 20ml bottles are not sold separately
DELETE FROM products WHERE id IN
  ('blue-monarch-20','urban-ember-20','flora-essence-20','savage-wind-20');

-- 2. make sure the set exists (every NOT NULL column gets a value)
INSERT INTO products (id, name, price, volume_ml, category, concentration, is_active, sort_order)
VALUES ('discovery-set', 'The Discovery Set', 1, 80, 'Gifting', 'Eau de Parfum', false, 45)
ON CONFLICT (id) DO NOTHING;

-- 3. full content for the set (price and visibility are left alone,
--    so anything you have already set in the admin is preserved)
UPDATE products SET
  "no"          = '05',
  name          = 'The Discovery Set',
  tagline       = 'Four Signatures, One Box',
  volume_ml     = 80,
  category      = 'Gifting',
  concentration = 'Eau de Parfum',
  "character"   = 'All four signatures',
  wear          = 'Gifting · Travel · Trying',
  intro         = 'All four Scent Obsessed signatures in 20ml bottles, presented in a magnetic gift box. Net content 4 × 20ml — the simplest way to find your signature, or to give someone else theirs.',
  note_top      = 'Grapefruit · Bergamot · Peony · Black Pepper',
  note_heart    = 'Leather · Rose · Ginger · Vetiver',
  note_base     = 'Amberwood · Tobacco · Sandalwood · Ambroxan',
  head          = 'Four signatures, one box — and no need to choose yet.',
  model         = NULL,
  orientation   = '0deg 0deg 0deg',
  sort_order    = 45,
  narrative     = E'Choosing a signature from a description is hard. This set removes the guesswork: all four Scent Obsessed compositions, 20ml each, in a magnetic gift box. Wear one a week and let your skin decide.\n\nNet content 4 × 20ml (80ml total).\n\n— — —\n\nBLUE MONARCH · Rule Your Realm\nFresh & woody. Day to evening.\nTop: Grapefruit, Lemon, Bergamot, Mint, Pink Pepper, Aldehydes, Coriander\nHeart: Ginger, Nutmeg, Jasmine, Melon\nBase: Incense, Amber, Cedar, Sandalwood, Patchouli, Labdanum, Amberwood\nA bright, effervescent opening that settles into quiet authority. The most versatile of the four.\n\n— — —\n\nURBAN EMBER · Ignite Your Presence\nSpicy & leathery. Evening.\nTop: Bergamot, Lavender, Cinnamon, Black Pepper\nHeart: Leather, Mimosa, Port Wine\nBase: Tobacco Leaf, Guaiac Wood, Oakmoss, Opoponax\nPort wine and rugged leather over tobacco and resin. The one people notice across a room.\n\n— — —\n\nFLORA ESSENCE · The Scent of Sunlight\nFloral & bright. Daytime.\nTop: Peony, Citrus, Mandarin Orange\nHeart: Osmanthus, Rose\nBase: Sandalwood, Patchouli\nDewy peony lifted by mandarin, resting on a velvety rose and smooth sandalwood. Opulent yet weightless.\n\n— — —\n\nSAVAGE WIND · Unleash the Storm\nSpicy & woody. Day to evening.\nTop: Calabrian Bergamot, Pepper\nHeart: Sichuan Pepper, Lavender, Pink Pepper, Vetiver, Patchouli, Geranium, Elemi\nBase: Ambroxan, Cedar, Labdanum\nCrisp bergamot sharpened by pepper, settling into a mineral, magnetic trail of ambroxan and cedar.\n\n— — —\n\nPresented in a magnetic gift box. Ships tracked and insured.'
WHERE id = 'discovery-set';

-- 4. safety net: never leave a null price behind
UPDATE products SET price = 1 WHERE price IS NULL;

-- 5. check
SELECT id, name, category, price, volume_ml, is_active FROM products ORDER BY sort_order;
