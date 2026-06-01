/**
 * Bosta Webhook Server + Auto-fetch open orders
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;
const BOSTA_API_KEY = process.env.BOSTA_API_KEY || '';

app.use(cors());
app.use(express.json());

// ── SSE clients ───────────────────────────────────────────────────────────────
const clients = new Set();

// ── Serve dashboard ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'bosta-dashboard.html'));
});

// ── SSE endpoint ──────────────────────────────────────────────────────────────
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
    console.log(`[SSE] Client disconnected (total: ${clients.size})`);
  });
});

// ── Broadcast to all dashboard clients ───────────────────────────────────────
function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(data);
}

// ── Webhook endpoint (Bosta posts here) ──────────────────────────────────────
app.post('/webhook', (req, res) => {
  const payload = req.body;
  if (!payload || !payload.trackingNumber) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  console.log(`[Webhook] #${payload.trackingNumber} state=${payload.state}`);
  broadcast(payload);
  res.status(200).json({ received: true });
});

// ── Fetch open orders from Bosta API ─────────────────────────────────────────
function fetchOpenOrders() {
  if (!BOSTA_API_KEY) {
    console.log('[Bosta] No API key set, skipping fetch.');
    return;
  }

  console.log('[Bosta] Fetching open orders...');

  const options = {
    hostname: 'app.bosta.co',
    path: '/api/v2/deliveries?state=active&limit=100',
    method: 'GET',
    headers: {
      'Authorization': BOSTA_API_KEY,
      'Content-Type': 'application/json',
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const deliveries = json.result?.list || json.list || json.deliveries || [];

        console.log(`[Bosta] Got ${deliveries.length} open orders`);

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
      }
    });
  });

  req.on('error', e => console.error('[Bosta] Request error:', e.message));
  req.end();
}

// ── Fetch on startup + every 2 minutes ───────────────────────────────────────
setTimeout(fetchOpenOrders, 3000);
setInterval(fetchOpenOrders, 2 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Bosta Tracker running on port ${PORT}`);
});
