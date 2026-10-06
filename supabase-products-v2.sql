-- =====================================================================
-- Scent Obsessed — adds Category + Concentration to products
-- Run AFTER supabase-products.sql
-- =====================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS category      text DEFAULT 'Fragrance';
ALTER TABLE products ADD COLUMN IF NOT EXISTS concentration text DEFAULT 'Extrait de Parfum';

UPDATE products SET category='Fragrance', concentration='Extrait de Parfum'
WHERE category IS NULL OR concentration IS NULL;

-- =====================================================================
-- The 20ml trial bottles + the gifting set.
-- They are created HIDDEN (is_active = false) with a placeholder price.
-- Set the real price in Admin → Products, then tick "Show on the
-- storefront". Nothing goes live until you do.
-- Images: upload each one in Admin → Products → Choose image file.
-- =====================================================================
INSERT INTO products (id,no,name,tagline,price,volume_ml,category,concentration,character,wear,intro,note_top,note_heart,note_base,head,is_active,sort_order)
VALUES
('blue-monarch-20','05','Blue Monarch 20ml','Rule Your Realm, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Fresh & Woody','Day to evening','The Blue Monarch signature in a pocket-sized 20ml bottle — made for travel, gifting, or trying before you commit to the full flacon.',
 'Grapefruit · Lemon · Bergamot · Mint · Pink Pepper · Aldehydes · Coriander',
 'Ginger · Nutmeg · Jasmine · Melon',
 'Incense · Amber · Cedar · Sandalwood · Patchouli · Labdanum · Amberwood',
 'The full signature, sized for the road.', false, 50),
('urban-ember-20','06','Urban Ember 20ml','Ignite Your Presence, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Spicy & Leathery','Evening','Urban Ember in a 20ml travel bottle — leather, port wine and tobacco, ready for an overnight bag.',
 'Bergamot · Lavender · Cinnamon · Black Pepper',
 'Leather · Mimosa · Port Wine',
 'Tobacco Leaf · Guaiac Wood · Oakmoss · Opoponax',
 'Evening character, travel format.', false, 60),
('flora-essence-20','07','Flora Essence 20ml','The Scent of Sunlight, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Floral & Bright','Daytime','Flora Essence in a 20ml bottle — peony, osmanthus and rose, small enough for a handbag.',
 'Peony · Citrus · Mandarin Orange',
 'Osmanthus · Rose',
 'Sandalwood · Patchouli',
 'Daylight florals, pocket sized.', false, 70),
('savage-wind-20','08','Savage Wind 20ml','Unleash the Storm, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Spicy & Woody','Day to evening','Savage Wind in a 20ml travel bottle — pepper, vetiver and ambroxan wherever you go.',
 'Calabrian Bergamot · Pepper',
 'Sichuan Pepper · Lavender · Pink Pepper · Vetiver · Patchouli · Geranium · Elemi',
 'Ambroxan · Cedar · Labdanum',
 'The storm, scaled down.', false, 80),
('discovery-set','09','The Discovery Set','Four Signatures, One Box',1,80,'Gifting','Eau de Parfum',
 'All four characters','Gifting','All four Scent Obsessed signatures in 20ml bottles, presented in a magnetic gift box. Net content 4 × 20ml. The simplest way to find your signature — or to give someone else theirs.',
 'Blue Monarch · Urban Ember','Flora Essence · Savage Wind','Presented in a magnetic gift box',
 'Four signatures, one box.', false, 45)
ON CONFLICT (id) DO NOTHING;
