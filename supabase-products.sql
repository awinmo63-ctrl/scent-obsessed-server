-- =====================================================================
-- Scent Obsessed — Products table
-- Run in Supabase → SQL Editor → New query → Run
-- After this, products are managed from Admin → Products.
-- =====================================================================

CREATE TABLE IF NOT EXISTS products (
  id          text PRIMARY KEY,          -- url slug, e.g. 'travel-set'
  no          text,                      -- display number, e.g. '05'
  name        text NOT NULL,
  tagline     text,
  price       integer NOT NULL,          -- rupees, e.g. 2499
  volume_ml   integer DEFAULT 100,
  img         text,                      -- filename in /public or full URL
  model       text,                      -- optional .glb filename
  orientation text DEFAULT '0deg 0deg 0deg',
  character   text,                      -- e.g. 'Fresh & Woody'
  wear        text,                      -- e.g. 'Day to evening'
  intro       text,
  note_top    text,
  note_heart  text,
  note_base   text,
  head        text,
  narrative   text,
  is_active   boolean DEFAULT true,
  sort_order  integer DEFAULT 100,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_read_active" ON products;
CREATE POLICY "products_read_active" ON products
  FOR SELECT TO anon, authenticated USING (is_active = true);
-- only the server (service_role) may insert, update or delete

-- ---------- seed the four existing fragrances ----------
INSERT INTO products (id,no,name,tagline,price,volume_ml,img,model,orientation,character,wear,intro,note_top,note_heart,note_base,head,narrative,sort_order)
VALUES
('blue-monarch','01','Blue Monarch','Rule Your Realm',2499,100,'blue_monarch.png','blue_monarch.glb','0deg -90deg 0deg',
 'Fresh & Woody','Day to evening',
 'A fragrance for those who write their own rules — a tribute to absolute freedom, power, and timeless elegance.',
 'Grapefruit · Lemon · Bergamot · Mint · Pink Pepper · Aldehydes · Coriander',
 'Ginger · Nutmeg · Jasmine · Melon',
 'Incense · Amber · Cedar · Sandalwood · Patchouli · Labdanum · Amberwood',
 'A reign cemented in amberwood, incense and sandalwood.',
 E'Ascend to a new level of sophistication with Blue Monarch. The opening is a bright, effervescent rush — grapefruit, lemon and bergamot lifted by cool mint, pink pepper and a sparkle of aldehydes, with coriander adding an unexpected edge.\n\nAs it settles, the heart turns spicy and luminous: warm ginger and nutmeg wrapped around soft jasmine and a touch of melon, balancing sharp freshness with quiet depth.\n\nThe reign is cemented in the base — incense, amber, cedar and sandalwood over patchouli, labdanum and amberwood, leaving a trail of undeniable authority.',10),
('urban-ember','02','Urban Ember','Ignite Your Presence',2499,100,'urban_ember.png','urban_ember.glb','0deg -90deg 0deg',
 'Spicy & Leathery','Evening',
 'For the modern trailblazer who commands attention without saying a word — the electric energy of the city at twilight.',
 'Bergamot · Lavender · Cinnamon · Black Pepper',
 'Leather · Mimosa · Port Wine',
 'Tobacco Leaf · Guaiac Wood · Oakmoss · Opoponax',
 'Leather and port wine, resting on tobacco and guaiac wood.',
 E'Capture the electric energy of the city at twilight. The journey begins with a vibrant spark — fresh bergamot and lavender colliding with the fiery heat of cinnamon and black pepper.\n\nAs the scent settles, it reveals a heart of pure sophistication: the intoxicating richness of port wine blends seamlessly with rugged leather and the soft allure of mimosa.\n\nThe dry down is where it lingers longest — tobacco leaf and guaiac wood over oakmoss and warm opoponax resin, leaving a lasting, smoky impression.',20),
('flora-essence','03','Flora Essence','The Scent of Sunlight',2499,100,'flora_essence.jpeg','flora_essence.glb','0deg 0deg 0deg',
 'Floral & Bright','Daytime',
 'A fragrance that celebrates light, nature, and pure optimism — the golden glow of a blooming garden at dawn.',
 'Peony · Citrus · Mandarin Orange',
 'Osmanthus · Rose',
 'Sandalwood · Patchouli',
 'Peony and rose, grounded in sandalwood and patchouli.',
 E'Capture the golden glow of a blooming garden at dawn. The experience opens with a burst of liquid sunshine — bright citrus and mandarin orange lifting a cool, dewy peony.\n\nAs the scent warms on the skin, it unveils a soft floral heart: apricot-tinged osmanthus wrapped around a velvety rose, opulent yet weightless.\n\nGrounding this bouquet is a smooth base of sandalwood and patchouli, adding a warm, woody texture that lingers close to the skin.',30),
('savage-wind','04','Savage Wind','Unleash the Storm',2499,100,'savage_wind.png','savage_wind.glb','0deg 0deg 0deg',
 'Spicy & Woody','Day to evening',
 'A powerful force of nature, designed for the free spirit who refuses to be tamed.',
 'Calabrian Bergamot · Pepper',
 'Sichuan Pepper · Lavender · Pink Pepper · Vetiver · Patchouli · Geranium · Elemi',
 'Ambroxan · Cedar · Labdanum',
 'A storm of pepper and vetiver, settling into ambroxan and cedar.',
 E'Experience the rush of the untamed. The scent opens with a gust of crisp, electric freshness — Calabrian bergamot hits the skin like a cool breeze, sharpened by a crack of pepper.\n\nBut the wind soon shifts, carrying sichuan and pink pepper, aromatic lavender and geranium, earthy vetiver and patchouli, with resinous elemi cutting through the middle.\n\nAs the storm settles it leaves a mineral, magnetic trail — ambroxan and cedar over warm labdanum, close to the skin and impossible to ignore.',40)
ON CONFLICT (id) DO NOTHING;
