/**
 * Bosta Webhook Server
 * ---------------------
 * npm install express cors
 * node server.js
 *
 * Endpoints:
 *   POST /webhook   ← Bosta sends updates here
 *   GET  /events    ← Dashboard listens via SSE
 *   GET  /          ← Serves the dashboard HTML
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── SSE clients list ──────────────────────────────────────────────────────────
const clients = new Set();

// ── Serve dashboard ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'bosta-dashboard.html'));
});

// ── SSE endpoint (dashboard connects here) ───────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Send a ping every 25s to keep connection alive
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  clients.add(res);
  console.log(`[SSE] Client connected  (total: ${clients.size})`);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    console.log(`[SSE] Client disconnected (total: ${clients.size})`);
  });
});

// ── Webhook endpoint (Bosta posts here) ──────────────────────────────────────
app.post('/webhook', (req, res) => {
  const payload = req.body;

  // Basic validation
  if (!payload || !payload.trackingNumber) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  console.log(`[Webhook] #${payload.trackingNumber}  state=${payload.state}`);

  // Broadcast to all connected dashboard clients
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }

  res.status(200).json({ received: true });
});

// ── Test endpoint (simulate a webhook from Postman / curl) ───────────────────
app.post('/test', (req, res) => {
  const sample = {
    _id:                 'test-' + Date.now(),
    trackingNumber:      Math.floor(40000000 + Math.random() * 9999999),
    state:               [10, 24, 41, 45, 47][Math.floor(Math.random() * 5)],
    type:                'SEND',
    timeStamp:           Date.now(),
    deliveryPromiseDate: new Date(Date.now() + 86400000).toLocaleDateString('en-GB').replace(/\//g,'-'),
    numberOfAttempts:    Math.floor(Math.random() * 3),
    businessReference:   'TEST-' + Math.floor(1000 + Math.random() * 9000),
    ...(req.body || {}),
  };

  const data = `data: ${JSON.stringify(sample)}\n\n`;
  for (const client of clients) client.write(data);

  console.log(`[Test]    Sent simulated payload:`, sample);
  res.json({ sent: sample });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Bosta Webhook Server running on http://localhost:${PORT}`);
  console.log(`   Dashboard : http://localhost:${PORT}/`);
  console.log(`   Webhook   : POST http://localhost:${PORT}/webhook`);
  console.log(`   Test fire : POST http://localhost:${PORT}/test\n`);
});
