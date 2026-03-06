app.post('/create-order', async (req, res) => {
    try {
        const { orderAmount, customerName, customerPhone, customerEmail, shippingAddress, paymentMethod } = req.body;
        const orderId = (paymentMethod === 'COD' ? 'COD_' : 'PRE_') + Date.now();

        // Determine the initial status for the database
        const initialStatus = paymentMethod === 'COD' ? 'COD_PENDING' : 'PENDING';

        // SAVE THE ORDER TO SUPABASE FIRST
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
                    payment_status: initialStatus
                }
            ]);

        if (dbError) {
            console.error("Database Error:", dbError);
            return res.status(500).json({ error: 'Failed to save order to database' });
        }

        // IF IT IS COD, STOP HERE AND RETURN SUCCESS
        if (paymentMethod === 'COD') {
            return res.json({ success: true, method: 'COD', order_id: orderId });
        }

        // IF IT IS PREPAID, REQUEST PAYMENT SESSION FROM CASHFREE
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