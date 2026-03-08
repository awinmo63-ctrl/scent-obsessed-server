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
        const { orderAmount, customerName, customerPhone, customerEmail, shippingAddress, rewardMl, claimedRewardMl, cartItems, appliedPromo } = req.body;
        const orderId = 'ORDER_' + Date.now();

        // SAVE THE ORDER TO SUPABASE WITH THE PROMO CODE
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
                    claimed_reward_ml: claimedRewardMl || 0,
                    cart_items: cartItems || [],
                    tracking_status: 'PREPARING',
                    applied_promo: appliedPromo || null // <--- SAVES THE CODE
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

// --- THE AUTOMATED WEBHOOK ENGINE ---
app.post('/webhook', async (req, res) => {
    try {
        const paymentStatus = req.body.data.payment.payment_status;
        const orderId = req.body.data.order.order_id;

        if (paymentStatus === 'SUCCESS') {
            const { error } = await supabase.from('orders').update({ payment_status: 'PAID' }).eq('order_id', orderId);

            if (!error) {
                console.log(`[SUCCESS] Order ${orderId} marked as PAID.`);

                const { data: orderData } = await supabase.from('orders').select('*').eq('order_id', orderId).single();

                if (orderData && orderData.customer_email) {

                    // 1. UPDATE THE BUYER'S LOYALTY ML
                    const { data: profileData } = await supabase.from('profiles').select('loyalty_ml').eq('email', orderData.customer_email).single();
                    if (profileData) {
                        const newTotal = profileData.loyalty_ml + (orderData.reward_ml || 0) - (orderData.claimed_reward_ml || 0);
                        await supabase.from('profiles').update({ loyalty_ml: newTotal }).eq('email', orderData.customer_email);
                    }

                    // 2. PROCESS THE FUNNELS (PROMOS & REFERRALS)
                    if (orderData.applied_promo) {
                        const promo = orderData.applied_promo;

                        if (promo.startsWith('SO-')) {
                            // FUNNEL 3: REFERRAL LOOP
                            const refIdPart = promo.substring(3); // Grab the unique code
                            const { data: allProfiles } = await supabase.from('profiles').select('id, email, loyalty_ml');
                            const refUser = allProfiles?.find(p => p.id.toUpperCase().startsWith(refIdPart));

                            // Give the friend 20 ML (as long as they aren't buying it for themselves)
                            if (refUser && refUser.email !== orderData.customer_email) {
                                await supabase.from('profiles').update({ loyalty_ml: refUser.loyalty_ml + 20 }).eq('id', refUser.id);
                                console.log(`[REFERRAL] 20 ML poured into ${refUser.email}'s vessel!`);
                            }
                        } else {
                            // FUNNEL 2: VIP VAULT BURN
                            await supabase.from('promo_codes').update({ is_used: true, used_by_email: orderData.customer_email }).eq('code', promo);
                            console.log(`[VIP BURN] Code ${promo} was successfully used and destroyed.`);
                        }
                    }
                }
            }
        }
        res.status(200).send('Webhook Received');
    } catch (error) {
        console.error("Webhook failed:", error.message);
        res.status(500).send('Webhook Error');
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Scent Obsessed secure backend running on port ${PORT}`);
});