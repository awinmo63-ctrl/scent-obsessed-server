-- =====================================================================
-- Scent Obsessed — Row Level Security
-- Run this in Supabase → SQL Editor → New query → Run
--
-- WHY: your storefront uses the public "anon" key, which anyone can read
-- from the page source. Without these rules a visitor can insert fake
-- PAID orders, read other customers' addresses, or raise their own
-- loyalty balance. The server keeps working because it uses the
-- service_role key, which bypasses RLS.
-- =====================================================================

-- ---------- ORDERS ----------
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_select_own" ON orders;
DROP POLICY IF EXISTS "orders_no_client_insert" ON orders;
DROP POLICY IF EXISTS "orders_no_client_update" ON orders;

-- a signed-in customer may read ONLY their own orders
CREATE POLICY "orders_select_own" ON orders
  FOR SELECT TO authenticated
  USING (customer_email = auth.jwt() ->> 'email');

-- nobody may insert or update orders from the browser (server only)
-- (absence of INSERT/UPDATE policies = denied for anon & authenticated)

-- ---------- PROFILES ----------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own_safe" ON profiles;

CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (email = auth.jwt() ->> 'email' AND coalesce(loyalty_ml, 0) = 0);

-- customers may edit their own contact details, but NOT their loyalty balance
CREATE POLICY "profiles_update_own_safe" ON profiles
  FOR UPDATE TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (
    email = auth.jwt() ->> 'email'
    AND loyalty_ml = (SELECT p.loyalty_ml FROM profiles p WHERE p.email = auth.jwt() ->> 'email')
  );

-- ---------- PROMO CODES ----------
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "promo_read" ON promo_codes;
-- read-only so the checkout can validate a code; only the server may mark it used
CREATE POLICY "promo_read" ON promo_codes
  FOR SELECT TO anon, authenticated USING (true);

-- ---------- LEAD CAPTURE ----------
ALTER TABLE wheel_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wheel_insert_only" ON wheel_leads;
CREATE POLICY "wheel_insert_only" ON wheel_leads
  FOR INSERT TO anon, authenticated WITH CHECK (true);
-- no SELECT policy: visitors can submit but can never read the lead list

ALTER TABLE exit_survey_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "exit_insert_only" ON exit_survey_responses;
CREATE POLICY "exit_insert_only" ON exit_survey_responses
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- =====================================================================
-- After running: sign in on the site, confirm you still see your orders
-- and loyalty balance. Place one test order to confirm checkout works.
-- =====================================================================
