const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Destructure router from auth.js export object
const { router: authRoutes } = require('./auth');
const depositRoutes = require('./deposit');
const ticketRoutes = require('./tickets');
const walletRoutes = require('./wallet');
const bannerRoutes = require('./banners');
const profileRoutes = require('./profile');

const app = express();

app.use(cors({
  origin: [
    'https://bsc-ticket-frontend.vercel.app/',
    'http://localhost:5173',
    'http://localhost:3000'
    ],
  credentials: true
}));

app.use(express.json());

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api', profileRoutes);

app.get('/', (req, res) => {
  res.send('BSC Ticket Platform Backend is running!');
});

const DEFAULT_PORT = process.env.PORT || 5002;

const server = app.listen(DEFAULT_PORT, '0.0.0.0', () => {
  console.log(`\n=============================================`);
  console.log(`🚀 Server running on http://localhost:${server.address().port}`);
  console.log(`=============================================\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${DEFAULT_PORT} occupied. Trying fallback port 5002...`);
    app.listen(5002, '0.0.0.0', () => {
      console.log(`\n=============================================`);
      console.log(`🚀 Server running on http://localhost:5002`);
      console.log(`=============================================\n`);
    });
  } else {
    console.error('Server error:', err);
  }
});
