require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// HOST YOUR BEAUTIFUL FRONTEND WEBSITE
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Supabase Connection
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.post('/create-order', async (req, res) => {
    try {
        const { orderAmount, customerName, customerPhone, customerEmail, shippingAddress, rewardMl, claimedRewardMl } = req.body;
        const orderId = 'ORDER_' + Date.now();

        // SAVE THE ORDER TO SUPABASE WITH THE EXACT MATH
        const { error: dbError } = await supabase
            .from('orders')
            .insert([
                {
                    order_id: orderId,
                    customer_name: customerName,
                    customer_phone: customerPhone,
                    customer_email: customerEmail,
                    shipping_address: shippingAddress,
                    total_amount: orderAmount,
                    payment_status: 'PENDING',
                    reward_ml: rewardMl || 0,
                    claimed_reward_ml: claimedRewardMl || 0
                }
            ]);

        if (dbError) {
            console.error("Database Error:", dbError);
            return res.status(500).json({ error: 'Failed to save order to database' });
        }

        // REQUEST PAYMENT SESSION FROM CASHFREE
        const requestBody = {
            order_amount: orderAmount,
            order_currency: "INR",
            order_id: orderId,
            customer_details: {
                customer_id: 'CUST_' + Date.now(),
                customer_phone: customerPhone,
                customer_name: customerName,
                customer_email: customerEmail
            },
            order_meta: {
                return_url: "https://scent-obsessed-server.onrender.com/?success=true&order_id={order_id}"
            }
        };

        const response = await fetch('https://sandbox.cashfree.com/pg/orders', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'x-client-id': process.env.CASHFREE_APP_ID,
                'x-client-secret': process.env.CASHFREE_SECRET_KEY,
                'x-api-version': '2023-08-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Cashfree API Error:", data);
            return res.status(500).json({ error: 'Cashfree API Error' });
        }

        res.json(data);

    } catch (error) {
        console.error('Server Error:', error.message);
        res.status(500).json({ error: 'Failed to initialize checkout' });
    }
});

// --- THE UPGRADED WEBHOOK ---
app.post('/webhook', async (req, res) => {
    try {
        const paymentStatus = req.body.data.payment.payment_status;
        const orderId = req.body.data.order.order_id;

        if (paymentStatus === 'SUCCESS') {
            const { error } = await supabase
                .from('orders')
                .update({ payment_status: 'PAID' })
                .eq('order_id', orderId);

            if (!error) {
                console.log(`[SUCCESS] Order ${orderId} has been marked as PAID!`);

                const { data: orderData } = await supabase.from('orders').select('customer_email, reward_ml, claimed_reward_ml').eq('order_id', orderId).single();

                if (orderData && orderData.customer_email) {
                    const { data: profileData } = await supabase.from('profiles').select('loyalty_ml').eq('email', orderData.customer_email).single();

                    if (profileData) {
                        // The Flawless Math: Add what they earned (20 * qty), subtract what they spent (100 if they claimed a bottle)
                        const earned = orderData.reward_ml || 0;
                        const spent = orderData.claimed_reward_ml || 0;
                        const newTotal = profileData.loyalty_ml + earned - spent;

                        await supabase.from('profiles').update({ loyalty_ml: newTotal }).eq('email', orderData.customer_email);
                        console.log(`[LOYALTY] Updated ${orderData.customer_email}. Earned: ${earned}ML. Spent: ${spent}ML.`);
                    }
                }
            }
        }
        res.status(200).send('Webhook Received');
    } catch (error) {
        console.error("Webhook processing failed:", error.message);
        res.status(500).send('Webhook Error');
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Scent Obsessed secure backend running on port ${PORT}`);
});