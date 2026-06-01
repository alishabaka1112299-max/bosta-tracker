const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;
const BOSTA_API_KEY = process.env.BOSTA_API_KEY || '';

app.use(cors());
app.use(express.json());

const clients = new Set();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'bosta-dashboard.html'));
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  clients.add(res);
  console.log(`[SSE] Client connected (total: ${clients.size})`);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(data);
}

app.post('/webhook', (req, res) => {
  const payload = req.body;
  if (!payload || !payload.trackingNumber) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  console.log(`[Webhook] #${payload.trackingNumber} state=${payload.state}`);
  broadcast(payload);
  res.status(200).json({ received: true });
});

function bostaRequest(path, callback) {
  const options = {
    hostname: 'app.bosta.co',
    path: path,
    method: 'GET',
    headers: {
      'Authorization': BOSTA_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => callback(res.statusCode, data));
  });
  req.on('error', e => console.error('[Bosta] Error:', e.message));
  req.end();
}

function fetchOpenOrders() {
  if (!BOSTA_API_KEY) return;
  console.log('[Bosta] Fetching open orders...');

  // Try the correct endpoint with apiVersion
  bostaRequest('/api/v2/deliveries?apiVersion=1&limit=100&page=0', (status, data) => {
    console.log('[Bosta] Status:', status);
    console.log('[Bosta] Response (first 400):', data.substring(0, 400));

    try {
      const json = JSON.parse(data);
      const deliveries =
        json?.result?.list ||
        json?.data?.list ||
        json?.list ||
        json?.deliveries ||
        (Array.isArray(json) ? json : []);

      console.log(`[Bosta] Got ${deliveries.length} orders`);

      deliveries.forEach(order => {
        const payload = {
          _id:                order._id,
          trackingNumber:     order.trackingNumber,
          state:              order.state?.code ?? order.state,
          type:               order.type,
          cod:                order.cod?.amount ?? order.cod,
          timeStamp:          order.updatedAt ? new Date(order.updatedAt).getTime() : Date.now(),
          deliveryPromiseDate: order.scheduledDate || null,
          numberOfAttempts:   order.noOfAttempts || 0,
          businessReference:  order.businessReference || null,
        };
        broadcast(payload);
      });
    } catch (e) {
      console.error('[Bosta] Parse error:', e.message);
      console.error('[Bosta] Raw response:', data.substring(0, 200));
    }
  });
}

setTimeout(fetchOpenOrders, 3000);
setInterval(fetchOpenOrders, 2 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`✅ Bosta Tracker running on port ${PORT}`);
});
