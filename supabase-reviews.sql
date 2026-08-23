-- =====================================================================
-- Scent Obsessed — Reviews + Newsletter
-- Run in Supabase → SQL Editor → New query → Run
-- =====================================================================

-- ---------- REVIEWS ----------
CREATE TABLE IF NOT EXISTS reviews (
  id            bigserial PRIMARY KEY,
  product_id    text,
  customer_name text NOT NULL,
  customer_city text,
  rating        int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          text NOT NULL,
  order_id      text,
  verified      boolean DEFAULT false,
  is_approved   boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_approved_idx ON reviews (is_approved, created_at DESC);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_read_approved" ON reviews;
DROP POLICY IF EXISTS "reviews_submit" ON reviews;

-- anyone may read ONLY approved reviews
CREATE POLICY "reviews_read_approved" ON reviews
  FOR SELECT TO anon, authenticated USING (is_approved = true);

-- anyone may submit, but never pre-approved and never self-verified
CREATE POLICY "reviews_submit" ON reviews
  FOR INSERT TO anon, authenticated
  WITH CHECK (is_approved = false AND verified = false);

-- no UPDATE/DELETE policy: only the server (service_role) can approve or remove


-- ---------- NEWSLETTER ----------
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id         bigserial PRIMARY KEY,
  email      text UNIQUE NOT NULL,
  source     text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "newsletter_subscribe" ON newsletter_subscribers;

-- visitors may subscribe but can never read the list
CREATE POLICY "newsletter_subscribe" ON newsletter_subscribers
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- =====================================================================
-- Reviews appear on the site only after you approve them in
-- Admin → Reviews. Nothing is published automatically.
-- =====================================================================
