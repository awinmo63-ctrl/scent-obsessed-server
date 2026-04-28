require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 5000;

// --- SUPABASE ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// --- CASHFREE LIVE CONFIG (PRODUCTION) ---
const CF_CLIENT_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CF_URL = "https://api.cashfree.com/pg";

console.log("💳 Cashfree configured in LIVE PRODUCTION mode");

// --- AUTH & CONFIG ---
const JWT_SECRET = 'super_secret_scent_obsessed_key_123';
const ADMIN_USERNAME = 'admin';
const adminPasswordHash = bcrypt.hashSync('admin123', 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const verifyAdmin = (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.redirect('/login.html');
    try { jwt.verify(token, JWT_SECRET); next(); }
    catch (err) { res.clearCookie('admin_token'); return res.redirect('/login.html'); }
};

// ==========================================
// --- CASHFREE PAYMENT LOGIC (RAW LIVE API) ---
// ==========================================

app.post('/create-order', async (req, res) => {
    try {
        const { orderAmount, customerName, customerPhone, customerEmail, shippingAddress, rewardMl, claimedRewardMl, cartItems, appliedPromo } = req.body;
        const orderId = 'ORDER_' + Date.now();
        const cleanPhone = customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : "9999999999";

        await supabase.from('orders').insert([{
            order_id: orderId, customer_name: customerName, customer_phone: cleanPhone,
            customer_email: customerEmail, shipping_address: shippingAddress,
            total_amount: orderAmount, payment_status: 'PENDING', reward_ml: rewardMl,
            claimed_reward_ml: claimedRewardMl, cart_items: cartItems, tracking_status: 'PREPARING', applied_promo: appliedPromo
        }]);

        const response = await fetch(`${CF_URL}/orders`, {
            method: 'POST',
            headers: {
                'x-client-id': CF_CLIENT_ID,
                'x-client-secret': CF_SECRET_KEY,
                'x-api-version': '2023-08-01',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_amount: parseFloat(orderAmount).toFixed(2),
                order_currency: "INR",
                order_id: orderId,
                customer_details: {
                    customer_id: customerEmail.replace(/[^a-zA-Z0-9_-]/g, '') || "GUEST",
                    customer_name: customerName || "Guest",
                    customer_email: customerEmail,
                    customer_phone: cleanPhone
                },
                order_meta: { return_url: `${req.protocol}://${req.get('host')}/?order_id=${orderId}` }
            })
        });

        const data = await response.json();

        if (data.payment_session_id) {
            console.log(`✅ LIVE Session Created: ${orderId}`);
            res.json({ payment_session_id: data.payment_session_id, order_id: orderId });
        } else {
            console.error("❌ Cashfree LIVE API Error:", data);
            res.status(400).json(data);
        }
    } catch (error) {
        console.error("❌ Server Error:", error.message);
        res.status(500).json({ error: "Checkout failed" });
    }
});

app.get('/api/verify-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const response = await fetch(`${CF_URL}/orders/${orderId}/payments`, {
            headers: { 'x-client-id': CF_CLIENT_ID, 'x-client-secret': CF_SECRET_KEY, 'x-api-version': '2023-08-01' }
        });
        const payments = await response.json();
        const isPaid = Array.isArray(payments) && payments.some(p => p.payment_status === 'SUCCESS');

        if (isPaid) {
            await supabase.from('orders').update({ payment_status: 'SUCCESS' }).eq('order_id', orderId);
            const { data: orderData } = await supabase.from('orders').select('*').eq('order_id', orderId).single();

            if (orderData) {
                // Burn the single-use promo code
                if (orderData.applied_promo) {
                    await supabase.from('promo_codes').update({ is_used: true }).eq('code', orderData.applied_promo);
                }

                // Update Loyalty ML
                const { data: profile } = await supabase.from('profiles').select('loyalty_ml').eq('email', orderData.customer_email).single();
                if (profile) {
                    const newMl = Math.max(0, (profile.loyalty_ml || 0) - (orderData.claimed_reward_ml || 0)) + (orderData.reward_ml || 0);
                    await supabase.from('profiles').update({ loyalty_ml: newMl }).eq('email', orderData.customer_email);
                }
            }
            return res.json({ status: 'SUCCESS' });
        }
        res.json({ status: 'FAILED' });
    } catch (err) { res.status(500).json({ error: "Verify failed" }); }
});

// --- ADMIN ROUTES ---
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && bcrypt.compareSync(password, adminPasswordHash)) {
        const token = jwt.sign({ username: ADMIN_USERNAME }, JWT_SECRET, { expiresIn: '8h' });
        res.cookie('admin_token', token, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 });
        return res.json({ success: true, redirectUrl: '/admin' });
    }
    res.status(401).json({ error: "Invalid login" });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('admin_token'); res.json({ success: true }); });
app.get('/api/admin/overview-stats', verifyAdmin, async (req, res) => {
    const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    const { data: rev } = await supabase.from('orders').select('total_amount');
    const total = rev ? rev.reduce((s, o) => s + (Number(o.total_amount) || 0), 0) : 0;
    res.json({ success: true, totalOrders: count || 0, totalRevenue: total });
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
    await supabase.from('promo_codes').insert([{ code: code.toUpperCase(), discount_percentage: parseInt(discount), is_used: false }]);
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
app.get('/admin', verifyAdmin, (req, res) => { res.sendFile(path.join(__dirname, 'private-views', 'admin.html')); });
app.listen(PORT, () => { console.log(`✅ Scent Obsessed Fortress online at http://localhost:${PORT}`); });