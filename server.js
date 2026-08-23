require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);

// ==========================================
// --- SECURITY HEADERS ---
// ==========================================
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// ==========================================
// --- RATE LIMITERS ---
// ==========================================
const globalLimiter = rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false,
    message: { error: "Too many requests from this IP, please try again after 15 minutes." } });
const checkoutLimiter = rateLimit({ windowMs: 10*60*1000, max: 10, message: { error: "Too many checkout attempts. Please wait a few minutes." } });
const loginLimiter    = rateLimit({ windowMs: 15*60*1000, max: 5,  message: { error: "Too many login attempts. Please try again later." } });
const chatLimiter     = rateLimit({ windowMs: 60*60*1000, max: 20, message: { error: "Chat limit reached. Please email info@scentobsessed.in for further assistance." } });

// --- SUPABASE ---
const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL || !supaKey) { console.error("❌ ERROR: Supabase URL or Key is missing!"); process.exit(1); }
const supabase = createClient(process.env.SUPABASE_URL, supaKey);

// --- CASHFREE ---
const CF_CLIENT_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CF_URL = "https://api.cashfree.com/pg";

// --- ADMIN AUTH (from env, never hardcoded) ---
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn("⚠️  JWT_SECRET not set — using a random per-boot secret. Admin sessions reset on restart.");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH
    ? process.env.ADMIN_PASSWORD_HASH
    : bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
if (!process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD) {
    console.warn("⚠️  Admin password not set — INSECURE default in use. Set ADMIN_PASSWORD_HASH before going live.");
}

// keep raw body so we can verify Cashfree webhook signatures
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(globalLimiter);

const verifyAdmin = (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.redirect('/login.html');
    try { jwt.verify(token, JWT_SECRET); next(); }
    catch (err) { res.clearCookie('admin_token'); return res.redirect('/login.html'); }
};

// ==========================================
// --- SERVER-SIDE PRICING (source of truth) ---
// Browser-submitted amounts are NEVER trusted.
// ==========================================
const CATALOG = {
    'blue-monarch': { name: 'Blue Monarch', price: 2499 },
    'urban-ember':  { name: 'Urban Ember',  price: 2499 },
    'flora-essence':{ name: 'Flora Essence',price: 2499 },
    'savage-wind':  { name: 'Savage Wind',  price: 2499 }
};
const SPECIAL_PROMOS = {
    VIP1499: { type: 'FIXED_PRICE', pricePerItem: 1499 },
    VIP720:  { type: 'FIXED_PRICE', pricePerItem: 720  },
    HALF50:  { type: 'PERCENTAGE',  discount: 50 },
    VIP10:   { type: 'PERCENTAGE',  discount: 10 }
};
const REWARD_ML = 100;
const GIFT_THRESHOLD = 4999;                 // spend this much (after discount) to unlock…
const GIFT_ITEM = { id: 'gift-discovery', name: 'Discovery Vial 5ml (complimentary)' };

async function resolvePromoServer(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;
    try {
        const { data } = await supabase.from('promo_codes').select('*').eq('code', c).single();
        if (data) {
            if (data.is_used) return null;                       // already redeemed
            if (SPECIAL_PROMOS[c]) return { ...SPECIAL_PROMOS[c], code: c };
            return { type: 'PERCENTAGE', discount: data.discount_percentage || 0, code: c };
        }
    } catch (e) { /* not in table */ }
    if (SPECIAL_PROMOS[c]) return { ...SPECIAL_PROMOS[c], code: c };
    return null;
}

/** Recompute the true payable amount from the catalog. Returns {amount, rewardMl, claimedMl, items} */
async function computeOrder(cartItems, promoCode, customerEmail) {
    const items = Array.isArray(cartItems) ? cartItems : [];
    let subtotal = 0, paidUnits = 0, rewardCount = 0;
    const clean = [];

    for (const raw of items) {
        const qty = Math.max(1, Math.min(20, parseInt(raw.qty, 10) || 1));
        const isReward = !!raw.isReward;
        const baseId = String(raw.id || '').replace(/^reward-/, '');
        const cat = CATALOG[baseId];
        if (!cat) continue;                                       // unknown product id -> ignored
        if (isReward) { rewardCount += qty; clean.push({ id: raw.id, name: cat.name + ' (Reward)', price: '₹ 0', qty, isReward: true }); }
        else { subtotal += cat.price * qty; paidUnits += qty; clean.push({ id: baseId, name: cat.name, price: '₹ ' + cat.price.toLocaleString('en-IN'), qty, isReward: false }); }
    }

    // A free reward is only allowed if the customer genuinely has 100ml banked.
    let claimedMl = 0;
    if (rewardCount > 0) {
        let bank = 0;
        try {
            const { data: profile } = await supabase.from('profiles').select('loyalty_ml').eq('email', customerEmail).single();
            bank = (profile && profile.loyalty_ml) || 0;
        } catch (e) { bank = 0; }
        const allowed = Math.floor(bank / REWARD_ML);
        if (allowed < rewardCount) {
            // strip unearned reward lines and charge normally for them
            let toStrip = rewardCount - allowed;
            for (let i = clean.length - 1; i >= 0 && toStrip > 0; i--) {
                if (clean[i].isReward) { clean.splice(i, 1); toStrip--; }
            }
            claimedMl = allowed * REWARD_ML;
        } else {
            claimedMl = rewardCount * REWARD_ML;
        }
    }

    let amount = subtotal;
    const promo = await resolvePromoServer(promoCode);
    if (promo) {
        if (promo.type === 'FIXED_PRICE') amount = promo.pricePerItem * paidUnits;
        else if (promo.type === 'FIXED_TOTAL') amount = promo.fixedTotal;
        else amount = subtotal - Math.floor(subtotal * ((promo.discount || 0) / 100));
    }
    if (amount < 0) amount = 0;

    // complimentary discovery vial — decided here, never by the browser
    if (amount >= GIFT_THRESHOLD) {
        clean.push({ id: GIFT_ITEM.id, name: GIFT_ITEM.name, price: '₹ 0', qty: 1, isReward: true, isGift: true });
    }

    return { amount: Number(amount.toFixed(2)), rewardMl: paidUnits * 10, claimedMl, items: clean, promo: promo ? promo.code : '', gift: amount >= GIFT_THRESHOLD };
}

// ==========================================
// --- SHIPROCKET ---
// ==========================================
async function pushToShiprocket(orderData) {
    const authRes = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', {
        email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD
    });
    const token = authRes.data.token;

    const addr = typeof orderData.shipping_address === 'string' ? JSON.parse(orderData.shipping_address) : (orderData.shipping_address || {});
    const nameParts = (orderData.customer_name || 'Guest').trim().split(' ');
    const firstName = nameParts[0] || 'Guest';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Customer';

    let totalItemsPrice = 0;
    const shiprocketItems = (orderData.cart_items || []).map(item => {
        const itemPrice = item.isReward ? 0 : parseFloat(String(item.price).replace(/[^\d.-]/g, '')) || 0;
        totalItemsPrice += (itemPrice * item.qty);
        return { name: String(item.name).substring(0, 50), sku: item.id || 'ITEM', units: item.qty || 1, selling_price: itemPrice, discount: 0, tax: 0, hsn: 33030010 };
    });

    const orderDiscount = Math.max(0, totalItemsPrice - orderData.total_amount);
    const dateObj = new Date(orderData.created_at || Date.now());
    const formattedDate = dateObj.toISOString().replace('T', ' ').substring(0, 16);

    const orderRes = await axios.post('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', {
        order_id: orderData.order_id, order_date: formattedDate,
        pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
        billing_customer_name: firstName, billing_last_name: lastName,
        billing_address: addr.street || 'Address not provided',
        billing_city: addr.city || 'City not provided',
        billing_pincode: addr.pincode || '000000',
        billing_state: addr.state || 'Punjab', billing_country: "India",
        billing_email: orderData.customer_email || 'info@scentobsessed.in',
        billing_phone: orderData.customer_phone || '9999999999',
        shipping_is_billing: true, order_items: shiprocketItems, payment_method: "Prepaid",
        sub_total: orderData.total_amount, discount: orderDiscount,
        length: 15, breadth: 15, height: 15, weight: 0.5
    }, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });

    return orderRes.data;
}

// ==========================================
// --- FULFILMENT (idempotent, shared) ---
// ==========================================
async function fulfilOrder(orderId) {
    const { data: order } = await supabase.from('orders').select('*').eq('order_id', orderId).single();
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.payment_status === 'SUCCESS' || order.payment_status === 'PAID') return { ok: true, already: true };

    await supabase.from('orders').update({ payment_status: 'SUCCESS' }).eq('order_id', orderId);

    if (order.applied_promo) {
        try { await supabase.from('promo_codes').update({ is_used: true }).eq('code', order.applied_promo); } catch (e) {}
    }
    try {
        const { data: profile } = await supabase.from('profiles').select('loyalty_ml').eq('email', order.customer_email).single();
        if (profile) {
            const newMl = Math.max(0, (profile.loyalty_ml || 0) - (order.claimed_reward_ml || 0)) + (order.reward_ml || 0);
            await supabase.from('profiles').update({ loyalty_ml: newMl }).eq('email', order.customer_email);
        }
    } catch (e) {}
    try { await pushToShiprocket({ ...order, payment_status: 'SUCCESS' }); }
    catch (e) { console.error("Shiprocket push failed for " + orderId + ":", e.response?.data || e.message); }

    return { ok: true };
}

// ==========================================
// --- CHECKOUT ---
// ==========================================
app.post('/create-order', checkoutLimiter, async (req, res) => {
    try {
        const { customerName, customerPhone, customerEmail, shippingAddress, cartItems, appliedPromo } = req.body;

        if (!customerEmail || !String(customerEmail).includes('@')) return res.status(400).json({ error: "A valid email is required" });
        if (!Array.isArray(cartItems) || cartItems.length === 0) return res.status(400).json({ error: "Your cart is empty" });

        const cleanPhone = customerPhone ? String(customerPhone).replace(/\D/g, '').slice(-10) : "9999999999";
        if (cleanPhone.length < 10) return res.status(400).json({ error: "A valid 10-digit phone number is required" });

        // 🔒 price is computed here, never taken from the browser
        const computed = await computeOrder(cartItems, appliedPromo, customerEmail);
        if (computed.amount <= 0) return res.status(400).json({ error: "Order total is invalid" });

        const orderId = 'ORDER_' + Date.now();

        await supabase.from('orders').insert([{
            order_id: orderId, customer_name: customerName, customer_phone: cleanPhone, customer_email: customerEmail,
            shipping_address: shippingAddress, total_amount: computed.amount, payment_status: 'PENDING',
            reward_ml: computed.rewardMl, claimed_reward_ml: computed.claimedMl, cart_items: computed.items,
            tracking_status: 'PREPARING', applied_promo: computed.promo
        }]);

        const response = await axios.post(`${CF_URL}/orders`, {
            order_amount: computed.amount, order_currency: "INR", order_id: orderId,
            customer_details: {
                customer_id: String(customerEmail).replace(/[^a-zA-Z0-9_-]/g, '') || "GUEST",
                customer_name: customerName || "Guest", customer_email: customerEmail, customer_phone: cleanPhone
            },
            order_meta: {
                return_url: `https://${req.get('host')}/?order_id=${orderId}`,
                notify_url: `https://${req.get('host')}/api/cashfree-webhook`
            }
        }, { headers: { 'x-client-id': CF_CLIENT_ID, 'x-client-secret': CF_SECRET_KEY, 'x-api-version': '2023-08-01', 'Content-Type': 'application/json' } });

        if (response.data.payment_session_id) {
            return res.json({ payment_session_id: response.data.payment_session_id, order_id: orderId, order_amount: computed.amount });
        }
        res.status(400).json(response.data);
    } catch (error) {
        console.error("create-order failed:", error.response?.data || error.message);
        res.status(500).json({ error: "Checkout failed. Please try again." });
    }
});

// --- browser-side confirmation (fallback) ---
app.get('/api/verify-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const response = await axios.get(`${CF_URL}/orders/${orderId}/payments`, {
            headers: { 'x-client-id': CF_CLIENT_ID, 'x-client-secret': CF_SECRET_KEY, 'x-api-version': '2023-08-01' }
        });
        const payments = response.data || [];
        const isPaid = Array.isArray(payments) && payments.some(p => p.payment_status === 'SUCCESS');
        if (isPaid) { await fulfilOrder(orderId); return res.json({ status: 'SUCCESS' }); }
        res.json({ status: 'FAILED' });
    } catch (err) { res.status(500).json({ error: "Verify failed" }); }
});

// --- Cashfree webhook (authoritative; works even if the customer closes the tab) ---
app.post('/api/cashfree-webhook', async (req, res) => {
    try {
        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        if (signature && timestamp && CF_SECRET_KEY && req.rawBody) {
            const expected = crypto.createHmac('sha256', CF_SECRET_KEY)
                .update(timestamp + req.rawBody.toString('utf8')).digest('base64');
            if (expected !== signature) { console.warn("⚠️  Webhook signature mismatch — ignored."); return res.status(401).json({ ok: false }); }
        }
        const type = req.body && req.body.type;
        const orderId = req.body?.data?.order?.order_id;
        if (orderId && (!type || String(type).includes('SUCCESS'))) await fulfilOrder(orderId);
        res.json({ ok: true });
    } catch (e) { console.error("Webhook error:", e.message); res.json({ ok: true }); }
});

// ==========================================
// --- AI CONCIERGE ---
// ==========================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const systemInstruction = `You are the digital concierge for Scent Obsessed, a luxury extrait de parfum house in Ludhiana, India.
Tone: warm, precise, boutique. Never pushy.
Products: 'Flora Essence' (floral, bright, daytime), 'Blue Monarch' (fresh & woody, versatile), 'Savage Wind' (sweet, smoky vanilla, evening), 'Urban Ember' (spicy, leathery, evening). All are 50ml extrait de parfum at 30% concentration, ₹2,499 each.
Logistics: dispatch in 24-48 hours, delivery 3-5 business days, free tracked Shiprocket shipping across India. Payments secured by Cashfree. Sealed unopened returns within 7 days.
Rules: keep answers under 3 sentences. Never invent shipping times, stock levels, or discount codes. Prices are fixed. For refunds or complex issues, direct them to info@scentobsessed.in.`;
let aiModel;
if (process.env.GEMINI_API_KEY) aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction });

app.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        if (!aiModel) return res.status(500).json({ error: "Our concierge is offline right now." });
        const userMessage = String(req.body.message || '').slice(0, 500);
        if (!userMessage) return res.status(400).json({ error: "Message is required." });
        const result = await aiModel.generateContent(userMessage);
        res.json({ reply: result.response.text() });
    } catch (error) {
        console.error("Gemini error:", error.message);
        res.status(500).json({ error: "Our concierge is stepping away. Please try again in a moment." });
    }
});

// ==========================================
// --- ADMIN ---
// ==========================================
app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && bcrypt.compareSync(String(password || ''), adminPasswordHash)) {
        const token = jwt.sign({ username: ADMIN_USERNAME }, JWT_SECRET, { expiresIn: '8h' });
        res.cookie('admin_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 8*60*60*1000 });
        return res.json({ success: true, redirectUrl: '/admin' });
    }
    res.status(401).json({ error: "Invalid login" });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('admin_token'); res.json({ success: true }); });

app.get('/api/admin/overview-stats', verifyAdmin, async (req, res) => {
    try {
        const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
        const { data: paidOrders } = await supabase.from('orders').select('total_amount').in('payment_status', ['SUCCESS','PAID']);
        const totalRealRevenue = paidOrders ? paidOrders.reduce((s,o)=>s+(Number(o.total_amount)||0),0) : 0;
        res.json({ success: true, totalOrders: count || 0, totalRevenue: totalRealRevenue });
    } catch (err) { res.status(500).json({ success: false }); }
});
app.get('/api/admin/orders', verifyAdmin, async (req, res) => {
    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    res.json({ success: true, orders: data });
});
app.get('/api/admin/customers', verifyAdmin, async (req, res) => {
    const { data } = await supabase.from('profiles').select('*');
    res.json({ success: true, customers: data });
});
app.get('/api/admin/marketing', verifyAdmin, async (req, res) => {
    const { data: promos } = await supabase.from('promo_codes').select('*').order('id', { ascending: false });
    const { data: leads } = await supabase.from('wheel_leads').select('*').order('created_at', { ascending: false });
    res.json({ success: true, promos, leads });
});
app.post('/api/admin/promo-codes', verifyAdmin, async (req, res) => {
    const { code, discount } = req.body;
    await supabase.from('promo_codes').insert([{ code: String(code).toUpperCase(), discount_percentage: parseInt(discount), is_used: false }]);
    res.json({ success: true });
});
app.delete('/api/admin/promo-codes/:id', verifyAdmin, async (req, res) => {
    const { error } = await supabase.from('promo_codes').delete().eq('id', req.params.id);
    res.json({ success: !error });
});
app.put('/api/admin/customers/:id', verifyAdmin, async (req, res) => {
    await supabase.from('profiles').update(req.body).eq('id', req.params.id);
    res.json({ success: true });
});
app.put('/api/admin/orders/:id/address', verifyAdmin, async (req, res) => {
    await supabase.from('orders').update({ shipping_address: req.body.shipping_address }).eq('id', req.params.id);
    res.json({ success: true });
});
app.put('/api/admin/orders/:id/phone', verifyAdmin, async (req, res) => {
    try { await supabase.from('orders').update({ customer_phone: req.body.customer_phone }).eq('id', req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ success: false }); }
});
app.put('/api/admin/orders/:orderId/awb', verifyAdmin, async (req, res) => {
    try { await supabase.from('orders').update({ tracking_status: 'SHIPPED', awb_code: req.body.awb_code }).eq('order_id', req.params.orderId); res.json({ success: true }); }
    catch (err) { res.status(500).json({ success: false }); }
});

// --- one-click dispatch ---
app.post('/api/admin/ship-order/:orderId', verifyAdmin, async (req, res) => {
    try {
        const { data: order } = await supabase.from('orders').select('*').eq('order_id', req.params.orderId).single();
        if (!order) return res.status(404).json({ error: "Order not found in database" });

        const authRes = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', { email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD });
        const headers = { 'Authorization': `Bearer ${authRes.data.token}`, 'Content-Type': 'application/json' };

        let shipmentId = order.shiprocket_shipment_id;
        let deliveryPincode = "000000";
        try { const a = typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address; if (a && a.pincode) deliveryPincode = a.pincode; } catch (e) {}

        if (!shipmentId) {
            const searchRes = await axios.get(`https://apiv2.shiprocket.in/v1/external/orders?search=${req.params.orderId}`, { headers });
            if (searchRes.data?.data?.length > 0) shipmentId = searchRes.data.data[0].shipments[0]?.id || searchRes.data.data[0].shipment_id;
            else return res.status(400).json({ error: "Order not found in Shiprocket.", details: "Make sure the order was pushed successfully first." });
        }

        let awbCode = order.awb_code;
        if (!awbCode) {
            try {
                const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE || '141002';
                const serviceRes = await axios.get(`https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=0.5&cod=0`, { headers });
                const list = serviceRes.data?.data?.available_courier_companies || [];
                const payload = { shipment_id: shipmentId };
                if (list.length > 0) payload.courier_id = list[0].courier_company_id;
                const awbRes = await axios.post('https://apiv2.shiprocket.in/v1/external/courier/assign/awb', payload, { headers });
                if (awbRes.data.awb_assign_status === 1) awbCode = awbRes.data.response.data.awb_code;
                else return res.status(400).json({ error: "AWB Assignment Failed", details: awbRes.data });
            } catch (awbErr) {
                return res.status(400).json({ error: "Courier Assignment Rejected", details: awbErr.response?.data?.message || awbErr.response?.data || awbErr.message });
            }
        }

        try {
            const labelRes = await axios.post('https://apiv2.shiprocket.in/v1/external/courier/generate/label', { shipment_id: [shipmentId] }, { headers });
            const labelUrl = labelRes.data.label_created === 1 ? labelRes.data.label_url : null;
            if (!labelUrl) return res.status(400).json({ error: "AWB generated, but the label is still rendering.", details: "Try again in 60 seconds." });
            await supabase.from('orders').update({ tracking_status: 'SHIPPED', awb_code: awbCode, label_url: labelUrl, shiprocket_shipment_id: shipmentId }).eq('order_id', req.params.orderId);
            res.json({ success: true, label_url: labelUrl, awb_code: awbCode });
        } catch (labelErr) {
            return res.status(400).json({ error: "Label PDF Error", details: labelErr.response?.data?.message || labelErr.message });
        }
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Server/Authentication Error", details: error.response?.data || error.message });
    }
});


// ==========================================
// --- ORDER STATUS WORKFLOW (Godsin parity) ---
// ==========================================
const ALLOWED_STATUS = ['PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

app.patch('/api/admin/orders/:orderId/status', verifyAdmin, async (req, res) => {
    try {
        const status = String(req.body.status || '').toUpperCase();
        if (!ALLOWED_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const patch = { tracking_status: status };
        if (status === 'CANCELLED') patch.payment_status = 'CANCELLED';
        const { error } = await supabase.from('orders').update(patch).eq('order_id', req.params.orderId);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true, status });
    } catch (e) { res.status(500).json({ error: 'Status update failed' }); }
});

app.patch('/api/admin/orders/:orderId/mark-paid', verifyAdmin, async (req, res) => {
    try {
        const r = await fulfilOrder(req.params.orderId);
        if (!r.ok) return res.status(404).json({ error: 'Order not found' });
        res.json({ success: true, already: !!r.already });
    } catch (e) { res.status(500).json({ error: 'Could not mark paid' }); }
});

app.patch('/api/admin/orders/bulk-status', verifyAdmin, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.orderIds) ? req.body.orderIds.slice(0, 200) : [];
        const status = String(req.body.status || '').toUpperCase();
        if (!ids.length) return res.status(400).json({ error: 'No orders selected' });
        if (!ALLOWED_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const patch = { tracking_status: status };
        if (status === 'CANCELLED') patch.payment_status = 'CANCELLED';
        const { error } = await supabase.from('orders').update(patch).in('order_id', ids);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true, updated: ids.length, status });
    } catch (e) { res.status(500).json({ error: 'Bulk update failed' }); }
});

// abandoned checkouts = payment never completed
app.get('/api/admin/abandoned', verifyAdmin, async (req, res) => {
    try {
        const { data } = await supabase.from('orders').select('*')
            .eq('payment_status', 'PENDING').order('created_at', { ascending: false }).limit(300);
        res.json({ success: true, abandoned: data || [] });
    } catch (e) { res.status(500).json({ success: false }); }
});

// exit-intent survey answers
app.get('/api/admin/surveys', verifyAdmin, async (req, res) => {
    try {
        const { data } = await supabase.from('exit_survey_responses').select('*')
            .order('created_at', { ascending: false }).limit(500);
        res.json({ success: true, surveys: data || [] });
    } catch (e) { res.json({ success: true, surveys: [] }); }
});

// courier connectivity check (does not book anything)
app.get('/api/admin/shiprocket/diagnose', verifyAdmin, async (req, res) => {
    try {
        if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD)
            return res.json({ ok: false, reason: 'Shiprocket credentials not set in environment' });
        const auth = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', {
            email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD
        });
        if (!auth.data.token) return res.json({ ok: false, reason: 'Login returned no token' });
        const pin = process.env.SHIPROCKET_PICKUP_PINCODE || '141002';
        const q = await axios.get(`https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=${pin}&delivery_postcode=110001&weight=0.5&cod=0`,
            { headers: { Authorization: `Bearer ${auth.data.token}` } });
        const n = q.data?.data?.available_courier_companies?.length || 0;
        res.json({ ok: true, couriers: n, pickup: pin });
    } catch (e) { res.json({ ok: false, reason: e.response?.data?.message || e.message }); }
});


// ==========================================
// --- REVIEWS (public submit, admin approves) ---
// ==========================================
const reviewLimiter = rateLimit({ windowMs: 60*60*1000, max: 5, message: { error: "Too many reviews submitted. Please try again later." } });

// public: only approved reviews are ever returned
app.get('/api/reviews', async (req, res) => {
    try {
        const { data } = await supabase.from('reviews')
            .select('product_id,customer_name,customer_city,rating,body,verified,created_at')
            .eq('is_approved', true).order('created_at', { ascending: false }).limit(60);
        res.json({ success: true, reviews: data || [] });
    } catch (e) { res.json({ success: true, reviews: [] }); }
});

app.post('/api/reviews', reviewLimiter, async (req, res) => {
    try {
        const name = String(req.body.customer_name || '').trim().slice(0, 60);
        const city = String(req.body.customer_city || '').trim().slice(0, 60);
        const body = String(req.body.body || '').trim().slice(0, 600);
        const productId = String(req.body.product_id || '').trim().slice(0, 40);
        const email = String(req.body.email || '').trim().toLowerCase();
        const rating = parseInt(req.body.rating, 10);

        if (!name || !body) return res.status(400).json({ error: 'Please add your name and a few words.' });
        if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Please choose a rating.' });
        if (body.length < 10) return res.status(400).json({ error: 'Please write a little more.' });

        // mark as a verified buyer if this email has a paid order
        let verified = false, orderId = null;
        if (email) {
            const { data: ord } = await supabase.from('orders').select('order_id')
                .eq('customer_email', email).in('payment_status', ['SUCCESS','PAID']).limit(1);
            if (ord && ord.length) { verified = true; orderId = ord[0].order_id; }
        }

        await supabase.from('reviews').insert([{
            product_id: productId || null, customer_name: name, customer_city: city || null,
            rating, body, order_id: orderId, verified, is_approved: false
        }]);
        res.json({ success: true, verified });
    } catch (e) { res.status(500).json({ error: 'Could not submit your review right now.' }); }
});

app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
    try {
        const { data } = await supabase.from('reviews').select('*').order('created_at', { ascending: false }).limit(400);
        res.json({ success: true, reviews: data || [] });
    } catch (e) { res.json({ success: true, reviews: [] }); }
});
app.patch('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
    try {
        const approve = req.body.is_approved === true;
        const { error } = await supabase.from('reviews').update({ is_approved: approve }).eq('id', req.params.id);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true, is_approved: approve });
    } catch (e) { res.status(500).json({ error: 'Update failed' }); }
});
app.delete('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
    const { error } = await supabase.from('reviews').delete().eq('id', req.params.id);
    res.json({ success: !error });
});

// ==========================================
// --- NEWSLETTER ---
// ==========================================
const newsLimiter = rateLimit({ windowMs: 60*60*1000, max: 10 });
app.post('/api/newsletter', newsLimiter, async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!email || !email.includes('@') || email.length > 120) return res.status(400).json({ error: 'Please enter a valid email address.' });
        await supabase.from('newsletter_subscribers').insert([{ email, source: String(req.body.source || 'footer').slice(0, 30) }]);
        res.json({ success: true });
    } catch (e) { res.json({ success: true }); }   // duplicate email -> still a success for the visitor
});
app.get('/api/admin/newsletter', verifyAdmin, async (req, res) => {
    try {
        const { data } = await supabase.from('newsletter_subscribers').select('*').order('created_at', { ascending: false }).limit(2000);
        res.json({ success: true, subscribers: data || [] });
    } catch (e) { res.json({ success: true, subscribers: [] }); }
});

// ==========================================
// --- STATIC + PAGES ---
// ==========================================
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/admin', verifyAdmin, (req, res) => res.sendFile(path.join(__dirname, 'private-views', 'admin.html')));

// public policy URLs (payment gateways expect these to be reachable)
app.get('/terms',            (req, res) => res.redirect(301, '/policies.html#terms'));
app.get('/privacy',          (req, res) => res.redirect(301, '/policies.html#privacy'));
app.get('/refund-policy',    (req, res) => res.redirect(301, '/policies.html#refunds'));
app.get('/shipping-policy',  (req, res) => res.redirect(301, '/policies.html#shipping'));
app.get('/contact',          (req, res) => res.redirect(301, '/policies.html#contact'));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', etag: true }));

// anything else -> storefront
app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ Scent Obsessed online at port ${PORT}`));
