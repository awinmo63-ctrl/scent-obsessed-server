require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL || !supaKey) {
    console.error("❌ ERROR: Supabase URL or Key is missing!");
    process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, supaKey);

const CF_CLIENT_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CF_URL = "https://api.cashfree.com/pg";

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
// --- SHIPROCKET AUTOMATION LOGIC ---
// ==========================================

async function pushToShiprocket(orderData) {
    try {
        const authRes = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', {
            email: process.env.SHIPROCKET_EMAIL,
            password: process.env.SHIPROCKET_PASSWORD
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
            return { name: item.name.substring(0, 50), sku: item.id || 'ITEM', units: item.qty || 1, selling_price: itemPrice, discount: 0, tax: 0, hsn: 33030010 };
        });

        const orderDiscount = Math.max(0, totalItemsPrice - orderData.total_amount);
        const dateObj = new Date(orderData.created_at || Date.now());
        const formattedDate = dateObj.toISOString().replace('T', ' ').substring(0, 16);

        const orderPayload = {
            order_id: orderData.order_id,
            order_date: formattedDate,
            pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
            billing_customer_name: firstName,
            billing_last_name: lastName,
            billing_address: addr.street || 'Address not provided',
            billing_city: addr.city || 'City not provided',
            billing_pincode: addr.pincode || '000000',
            billing_state: addr.state || 'Punjab',
            billing_country: "India",
            billing_email: orderData.customer_email || 'info@scentobsessed.in',
            billing_phone: orderData.customer_phone || '9999999999',
            shipping_is_billing: true,
            order_items: shiprocketItems,
            payment_method: "Prepaid",
            sub_total: orderData.total_amount,
            discount: orderDiscount,
            length: 15, breadth: 15, height: 15, weight: 0.5
        };

        const orderRes = await axios.post('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', orderPayload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        return orderRes.data;
    } catch (error) { throw error; }
}

// ==========================================
// --- ONE-CLICK DISPATCH API (UPGRADED ERROR HANDLING) ---
// ==========================================

app.post('/api/admin/ship-order/:orderId', verifyAdmin, async (req, res) => {
    try {
        const { data: order } = await supabase.from('orders').select('*').eq('order_id', req.params.orderId).single();
        if (!order) return res.status(404).json({ error: "Order not found in database" });

        // 1. Authenticate Shiprocket
        const authRes = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', { email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD });
        const token = authRes.data.token;
        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

        let shipmentId = order.shiprocket_shipment_id;

        // Fallback: If shipment ID isn't saved, grab it dynamically
        if (!shipmentId) {
            const searchRes = await axios.get(`https://apiv2.shiprocket.in/v1/external/orders?search=${req.params.orderId}`, { headers });
            if (searchRes.data && searchRes.data.data && searchRes.data.data.length > 0) {
                shipmentId = searchRes.data.data[0].shipments[0]?.id || searchRes.data.data[0].shipment_id;
            } else {
                return res.status(400).json({ error: "Order not found in Shiprocket.", details: "Make sure the order was pushed successfully first." });
            }
        }

        let awbCode = order.awb_code;

        // 2. Auto-Assign Courier
        if (!awbCode) {
            try {
                const awbRes = await axios.post('https://apiv2.shiprocket.in/v1/external/courier/assign/awb', { shipment_id: shipmentId }, { headers });
                if (awbRes.data.awb_assign_status === 1) {
                    awbCode = awbRes.data.response.data.awb_code;
                } else {
                    return res.status(400).json({ error: "AWB Auto-Assign Failed", details: awbRes.data });
                }
            } catch (awbErr) {
                return res.status(400).json({ error: "Courier Assignment Rejected", details: awbErr.response?.data?.message || awbErr.response?.data || awbErr.message });
            }
        }

        // 3. Generate Label PDF
        try {
            const labelRes = await axios.post('https://apiv2.shiprocket.in/v1/external/courier/generate/label', { shipment_id: [shipmentId] }, { headers });
            const labelUrl = labelRes.data.label_created === 1 ? labelRes.data.label_url : null;

            if (!labelUrl) return res.status(400).json({ error: "AWB Generated, but label is still rendering.", details: "Try clicking the button again in 60 seconds." });

            // 4. Update Database
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
// --- CHECKOUT LOGIC ---
// ==========================================

app.post('/create-order', async (req, res) => {
    try {
        const { orderAmount, customerName, customerPhone, customerEmail, shippingAddress, rewardMl, claimedRewardMl, cartItems, appliedPromo } = req.body;
        const orderId = 'ORDER_' + Date.now();
        const cleanPhone = customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : "9999999999";

        await supabase.from('orders').insert([{
            order_id: orderId, customer_name: customerName, customer_phone: cleanPhone, customer_email: customerEmail, shipping_address: shippingAddress,
            total_amount: orderAmount, payment_status: 'PENDING', reward_ml: rewardMl, claimed_reward_ml: claimedRewardMl, cart_items: cartItems, tracking_status: 'PREPARING', applied_promo: appliedPromo
        }]);

        const response = await axios.post(`${CF_URL}/orders`, {
            order_amount: Number(parseFloat(orderAmount).toFixed(2)), order_currency: "INR", order_id: orderId,
            customer_details: { customer_id: customerEmail.replace(/[^a-zA-Z0-9_-]/g, '') || "GUEST", customer_name: customerName || "Guest", customer_email: customerEmail, customer_phone: cleanPhone },
            order_meta: { return_url: `https://${req.get('host')}/?order_id=${orderId}` }
        }, { headers: { 'x-client-id': CF_CLIENT_ID, 'x-client-secret': CF_SECRET_KEY, 'x-api-version': '2023-08-01', 'Content-Type': 'application/json' } });

        if (response.data.payment_session_id) res.json({ payment_session_id: response.data.payment_session_id, order_id: orderId });
        else res.status(400).json(response.data);
    } catch (error) { res.status(500).json({ error: "Checkout failed", message: error.response?.data || error.message }); }
});

app.get('/api/verify-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const response = await axios.get(`${CF_URL}/orders/${orderId}/payments`, { headers: { 'x-client-id': CF_CLIENT_ID, 'x-client-secret': CF_SECRET_KEY, 'x-api-version': '2023-08-01' } });

        const payments = response.data || [];
        const isPaid = Array.isArray(payments) && payments.some(p => p.payment_status === 'SUCCESS');

        if (isPaid) {
            await supabase.from('orders').update({ payment_status: 'SUCCESS' }).eq('order_id', orderId);
            const { data: orderData } = await supabase.from('orders').select('*').eq('order_id', orderId).single();

            if (orderData) {
                if (orderData.applied_promo) await supabase.from('promo_codes').update({ is_used: true }).eq('code', orderData.applied_promo);

                const { data: profile } = await supabase.from('profiles').select('loyalty_ml').eq('email', orderData.customer_email).single();
                if (profile) {
                    const newMl = Math.max(0, (profile.loyalty_ml || 0) - (orderData.claimed_reward_ml || 0)) + (orderData.reward_ml || 0);
                    await supabase.from('profiles').update({ loyalty_ml: newMl }).eq('email', orderData.customer_email);
                }

                try {
                    const srData = await pushToShiprocket(orderData);
                    await supabase.from('orders').update({ tracking_status: 'PACKED', shiprocket_shipment_id: srData.shipment_id }).eq('order_id', orderId);
                } catch (srError) { console.log("Shiprocket push failed silently."); }
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
    try {
        const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
        const { data: paidOrders } = await supabase.from('orders').select('total_amount').in('payment_status', ['SUCCESS', 'PAID']);
        const totalRealRevenue = paidOrders ? paidOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0) : 0;
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

app.get('/api/admin/force-shiprocket/:orderId', verifyAdmin, async (req, res) => {
    try {
        const { data: orderData } = await supabase.from('orders').select('*').eq('order_id', req.params.orderId).single();
        if (!orderData) return res.status(404).json({ error: "Order not found in Supabase" });
        const srData = await pushToShiprocket(orderData);
        await supabase.from('orders').update({ tracking_status: 'PACKED', shiprocket_shipment_id: srData.shipment_id }).eq('order_id', req.params.orderId);
        res.json({ success: true, message: "Order pushed to Shiprocket!" });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.listen(PORT, () => { console.log(`✅ Scent Obsessed Fortress online at port ${PORT}`); });