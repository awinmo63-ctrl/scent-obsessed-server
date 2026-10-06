-- =====================================================================
-- Scent Obsessed — Products  (SINGLE SCRIPT — run this one only)
-- Replaces supabase-products.sql and supabase-products-v2.sql.
-- Safe to run more than once.
--
-- NOTE: "character" is quoted everywhere because it is a reserved
-- type keyword in PostgreSQL. That was what broke the earlier script.
-- =====================================================================

-- 1. table ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY
);

-- 2. columns (added one by one so this works whatever state you're in)
ALTER TABLE products ADD COLUMN IF NOT EXISTS "no"          text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS name          text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tagline       text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price         integer DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_ml     integer DEFAULT 100;
ALTER TABLE products ADD COLUMN IF NOT EXISTS img           text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model         text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS orientation   text DEFAULT '0deg 0deg 0deg';
ALTER TABLE products ADD COLUMN IF NOT EXISTS "character"   text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS wear          text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS intro         text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS note_top      text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS note_heart    text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS note_base     text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS head          text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS narrative     text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category      text DEFAULT 'Fragrance';
ALTER TABLE products ADD COLUMN IF NOT EXISTS concentration text DEFAULT 'Extrait de Parfum';
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active     boolean DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order    integer DEFAULT 100;
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();

-- 3. security ---------------------------------------------------------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_read_active" ON products;
CREATE POLICY "products_read_active" ON products
  FOR SELECT TO anon, authenticated USING (is_active = true);
-- only the server (service_role key) may insert, update or delete

-- 4. the four 100ml fragrances (live) ---------------------------------
INSERT INTO products (id,"no",name,tagline,price,volume_ml,category,concentration,img,model,orientation,"character",wear,intro,note_top,note_heart,note_base,head,narrative,is_active,sort_order) VALUES
('blue-monarch','01','Blue Monarch','Rule Your Realm',2499,100,'Fragrance','Extrait de Parfum','blue_monarch.png','blue_monarch.glb','0deg -90deg 0deg',
 'Fresh & Woody','Day to evening',
 'A fragrance for those who write their own rules — a tribute to absolute freedom, power, and timeless elegance.',
 'Grapefruit · Lemon · Bergamot · Mint · Pink Pepper · Aldehydes · Coriander',
 'Ginger · Nutmeg · Jasmine · Melon',
 'Incense · Amber · Cedar · Sandalwood · Patchouli · Labdanum · Amberwood',
 'A reign cemented in amberwood, incense and sandalwood.',
 E'Ascend to a new level of sophistication with Blue Monarch. The opening is a bright, effervescent rush — grapefruit, lemon and bergamot lifted by cool mint, pink pepper and a sparkle of aldehydes, with coriander adding an unexpected edge.\n\nAs it settles, the heart turns spicy and luminous: warm ginger and nutmeg wrapped around soft jasmine and a touch of melon.\n\nThe reign is cemented in the base — incense, amber, cedar and sandalwood over patchouli, labdanum and amberwood.',
 true,10),
('urban-ember','02','Urban Ember','Ignite Your Presence',2499,100,'Fragrance','Extrait de Parfum','urban_ember.png','urban_ember.glb','0deg -90deg 0deg',
 'Spicy & Leathery','Evening',
 'For the modern trailblazer who commands attention without saying a word — the electric energy of the city at twilight.',
 'Bergamot · Lavender · Cinnamon · Black Pepper',
 'Leather · Mimosa · Port Wine',
 'Tobacco Leaf · Guaiac Wood · Oakmoss · Opoponax',
 'Leather and port wine, resting on tobacco and guaiac wood.',
 E'Capture the electric energy of the city at twilight. The journey begins with a vibrant spark — fresh bergamot and lavender colliding with the fiery heat of cinnamon and black pepper.\n\nAs the scent settles, port wine blends with rugged leather and the soft allure of mimosa.\n\nThe dry down lingers longest — tobacco leaf and guaiac wood over oakmoss and warm opoponax resin.',
 true,20),
('flora-essence','03','Flora Essence','The Scent of Sunlight',2499,100,'Fragrance','Extrait de Parfum','flora_essence.jpeg','flora_essence.glb','0deg 0deg 0deg',
 'Floral & Bright','Daytime',
 'A fragrance that celebrates light, nature, and pure optimism — the golden glow of a blooming garden at dawn.',
 'Peony · Citrus · Mandarin Orange',
 'Osmanthus · Rose',
 'Sandalwood · Patchouli',
 'Peony and rose, grounded in sandalwood and patchouli.',
 E'Capture the golden glow of a blooming garden at dawn. The experience opens with a burst of liquid sunshine — bright citrus and mandarin orange lifting a cool, dewy peony.\n\nThe heart is soft and floral: apricot-tinged osmanthus wrapped around a velvety rose.\n\nGrounding it is a smooth base of sandalwood and patchouli.',
 true,30),
('savage-wind','04','Savage Wind','Unleash the Storm',2499,100,'Fragrance','Extrait de Parfum','savage_wind.png','savage_wind.glb','0deg 0deg 0deg',
 'Spicy & Woody','Day to evening',
 'A powerful force of nature, designed for the free spirit who refuses to be tamed.',
 'Calabrian Bergamot · Pepper',
 'Sichuan Pepper · Lavender · Pink Pepper · Vetiver · Patchouli · Geranium · Elemi',
 'Ambroxan · Cedar · Labdanum',
 'A storm of pepper and vetiver, settling into ambroxan and cedar.',
 E'Experience the rush of the untamed. The scent opens with a gust of crisp freshness — Calabrian bergamot sharpened by a crack of pepper.\n\nThe wind shifts, carrying sichuan and pink pepper, lavender and geranium, earthy vetiver and patchouli, with resinous elemi through the middle.\n\nAs the storm settles it leaves a mineral trail — ambroxan and cedar over warm labdanum.',
 true,40)
ON CONFLICT (id) DO NOTHING;

-- 5. the 20ml gifting range (HIDDEN until you set a price) -------------
INSERT INTO products (id,"no",name,tagline,price,volume_ml,category,concentration,"character",wear,intro,note_top,note_heart,note_base,head,is_active,sort_order) VALUES
('discovery-set','05','The Discovery Set','Four Signatures, One Box',1,80,'Gifting','Eau de Parfum',
 'All four characters','Gifting',
 'All four Scent Obsessed signatures in 20ml bottles, presented in a magnetic gift box. Net content 4 × 20ml.',
 'Blue Monarch · Urban Ember','Flora Essence · Savage Wind','Presented in a magnetic gift box',
 'Four signatures, one box.', false, 45),
('blue-monarch-20','06','Blue Monarch 20ml','Rule Your Realm, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Fresh & Woody','Day to evening',
 'The Blue Monarch signature in a pocket-sized 20ml bottle — made for travel, gifting, or trying before the full flacon.',
 'Grapefruit · Lemon · Bergamot · Mint · Pink Pepper · Aldehydes · Coriander',
 'Ginger · Nutmeg · Jasmine · Melon',
 'Incense · Amber · Cedar · Sandalwood · Patchouli · Labdanum · Amberwood',
 'The full signature, sized for the road.', false, 50),
('urban-ember-20','07','Urban Ember 20ml','Ignite Your Presence, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Spicy & Leathery','Evening',
 'Urban Ember in a 20ml travel bottle — leather, port wine and tobacco, ready for an overnight bag.',
 'Bergamot · Lavender · Cinnamon · Black Pepper',
 'Leather · Mimosa · Port Wine',
 'Tobacco Leaf · Guaiac Wood · Oakmoss · Opoponax',
 'Evening character, travel format.', false, 60),
('flora-essence-20','08','Flora Essence 20ml','The Scent of Sunlight, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Floral & Bright','Daytime',
 'Flora Essence in a 20ml bottle — peony, osmanthus and rose, small enough for a handbag.',
 'Peony · Citrus · Mandarin Orange',
 'Osmanthus · Rose',
 'Sandalwood · Patchouli',
 'Daylight florals, pocket sized.', false, 70),
('savage-wind-20','09','Savage Wind 20ml','Unleash the Storm, Travel Sized',1,20,'Gifting','Eau de Parfum',
 'Spicy & Woody','Day to evening',
 'Savage Wind in a 20ml travel bottle — pepper, vetiver and ambroxan wherever you go.',
 'Calabrian Bergamot · Pepper',
 'Sichuan Pepper · Lavender · Pink Pepper · Vetiver · Patchouli · Geranium · Elemi',
 'Ambroxan · Cedar · Labdanum',
 'The storm, scaled down.', false, 80)
ON CONFLICT (id) DO NOTHING;

-- 6. check ------------------------------------------------------------
SELECT id, name, category, price, volume_ml, is_active FROM products ORDER BY sort_order;
