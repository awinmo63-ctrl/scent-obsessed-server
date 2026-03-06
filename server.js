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
        const { orderAmount, customerName, customerPhone, customerEmail, shippingAddress } = req.body;
        const orderId = 'ORDER_' + Date.now();

        // SAVE THE ORDER TO SUPABASE FIRST (Status: PENDING)
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
                    payment_status: 'PENDING'
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
                // Redirects back to the LIVE frontend with a success tag
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

// --- THE NEW WEBHOOK LISTENER ---
app.post('/webhook', async (req, res) => {
    try {
        // Cashfree sends the payment details inside req.body.data
        const paymentStatus = req.body.data.payment.payment_status;
        const orderId = req.body.data.order.order_id;

        // If the payment was a success, update the Supabase spreadsheet to 'PAID'
        if (paymentStatus === 'SUCCESS') {
            const { error } = await supabase
                .from('orders')
                .update({ payment_status: 'PAID' })
                .eq('order_id', orderId);

            if (error) {
                console.error("Webhook Database Error:", error);
            } else {
                console.log(`[SUCCESS] Order ${orderId} has been marked as PAID!`);
            }
        }

        // Always tell Cashfree we received the message, or they will keep sending it
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