/**
 * VenueAI - Smart Stadium Backend Server
 * Real-time venue management with crowd simulation, food ordering, and entry control
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { initDB, syncStaff, syncOrder } = require('./db');
const path = require('path');
const crypto = require('crypto');

// ── Razorpay config (swap with real keys before production) ──────────
const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID     || 'rzp_test_DEMO_KEY_ID';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_DEMO_SECRET';
let Razorpay;
try {
  Razorpay = require('razorpay');
} catch(e) { Razorpay = null; }
const razorpay = Razorpay ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET }) : null;

// Pending payments (waiting for gateway success)
const pendingPayments = {};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Limit each IP to 10000 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ============================================================
// DATA MODELS & SIMULATION ENGINE
// ============================================================

// Venue Configuration
const VENUE = {
  name: "MetaStadium Arena",
  capacity: 60000,
  zones: [
    { id: 'north', name: 'North Stand', capacity: 15000, current: 0, gates: ['A', 'B'] },
    { id: 'south', name: 'South Stand', capacity: 15000, current: 0, gates: ['C', 'D'] },
    { id: 'east', name: 'East Wing', capacity: 12000, current: 0, gates: ['E', 'F'] },
    { id: 'west', name: 'West Wing', capacity: 12000, current: 0, gates: ['G', 'H'] },
    { id: 'vip', name: 'VIP Lounge', capacity: 6000, current: 0, gates: ['V1'] }
  ],
  gates: [
    { id: 'A', name: 'Gate A', zone: 'north', throughput: 800, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'B', name: 'Gate B', zone: 'north', throughput: 800, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'C', name: 'Gate C', zone: 'south', throughput: 800, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'D', name: 'Gate D', zone: 'south', throughput: 800, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'E', name: 'Gate E', zone: 'east', throughput: 600, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'F', name: 'Gate F', zone: 'east', throughput: 600, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'G', name: 'Gate G', zone: 'west', throughput: 600, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'H', name: 'Gate H', zone: 'west', throughput: 600, current_flow: 0, status: 'open', queue_length: 0 },
    { id: 'V1', name: 'VIP Gate', zone: 'vip', throughput: 300, current_flow: 0, status: 'open', queue_length: 0 }
  ],
  concessions: [
    { id: 'f1', name: 'Stadium Bites', zone: 'north', type: 'food', queue_time: 0, orders_pending: 0, staff: 4, status: 'open' },
    { id: 'f2', name: 'Quick Drinks', zone: 'north', type: 'beverage', queue_time: 0, orders_pending: 0, staff: 3, status: 'open' },
    { id: 'f3', name: 'South Grill', zone: 'south', type: 'food', queue_time: 0, orders_pending: 0, staff: 4, status: 'open' },
    { id: 'f4', name: 'Refreshment Hub', zone: 'south', type: 'beverage', queue_time: 0, orders_pending: 0, staff: 3, status: 'open' },
    { id: 'f5', name: 'East Eats', zone: 'east', type: 'food', queue_time: 0, orders_pending: 0, staff: 3, status: 'open' },
    { id: 'f6', name: 'West Feast', zone: 'west', type: 'food', queue_time: 0, orders_pending: 0, staff: 3, status: 'open' },
    { id: 'f7', name: 'VIP Dining', zone: 'vip', type: 'premium', queue_time: 0, orders_pending: 0, staff: 6, status: 'open' }
  ],
  restrooms: [
    { id: 'r1', zone: 'north', occupancy: 0, capacity: 40, wait_time: 0 },
    { id: 'r2', zone: 'south', occupancy: 0, capacity: 40, wait_time: 0 },
    { id: 'r3', zone: 'east', occupancy: 0, capacity: 30, wait_time: 0 },
    { id: 'r4', zone: 'west', occupancy: 0, capacity: 30, wait_time: 0 },
    { id: 'r5', zone: 'vip', occupancy: 0, capacity: 20, wait_time: 0 }
  ]
};

// Real-World Sports News Knowledge Base
const WORLD_NEWS_FEED = [
  { msg: '🏏 IPL: SRH vs RR Match Completed! SRH won by 4 runs.', type: 'success' },
  { msg: '📱 Google AI: Trending - #IPL2024 SRH vs RR analysis live.', type: 'info' },
  { msg: '🏆 Tournament: Playoff standings updated after today\'s result.', type: 'info' }
];

// Real-World Ground Truth (The AI Agent's Master Data)
const GOOGLE_REALITY_FEED = {
  homeTeam: 'SRH (Sunrisers)',
  awayTeam: 'RR (Royals)',
  stadium: 'hyderabad_stadium',
  stadiumName: 'Rajiv Gandhi Intl Stadium',
  sport: 'cricket'
};

// Match/Event State (Enhanced for Cricket Reality)
let matchState = {
  stadium: 'hyderabad_stadium',
  stadiumName: 'Rajiv Gandhi Intl Stadium',
  status: 'pre_match', 
  minute: 0,
  homeTeam: 'SRH (Sunrisers)',
  awayTeam: 'RR (Royals)',
  homeScore: 0,
  homeWickets: 0,
  awayScore: 0,
  awayWickets: 0,
  target: 0, // Set after 1st innings
  events: [],
  attendance: 0,
  sport: 'cricket',
  battingTeam: 'home', 
  worldSyncMode: false 
};

// Simulated Real-World AI Agent Connector
function runWorldAgent() {
  if (!matchState.worldSyncMode) return;

  // ENSURE AGENT IS MASTER
  if (matchState.homeTeam !== GOOGLE_REALITY_FEED.homeTeam) matchState.homeTeam = GOOGLE_REALITY_FEED.homeTeam;
  if (matchState.awayTeam !== GOOGLE_REALITY_FEED.awayTeam) matchState.awayTeam = GOOGLE_REALITY_FEED.awayTeam;
  if (matchState.stadium !== GOOGLE_REALITY_FEED.stadium) {
    matchState.stadium = GOOGLE_REALITY_FEED.stadium;
    matchState.stadiumName = GOOGLE_REALITY_FEED.stadiumName;
  }

  // Periodically push real-world tournament news
  if (Math.random() < 0.005) {
      const news = WORLD_NEWS_FEED[Math.floor(Math.random() * WORLD_NEWS_FEED.length)];
      addAlert(news.type, news.msg, 'match');
  }

  // Simulate no-delay Google updates for current match
  if (matchState.status === 'pre_match' && Math.random() < 0.1) {
    matchState.status = 'first_half';
    matchState.minute = 1;
    addAlert('info', `🌍 GOOGLE SYNC: ${matchState.homeTeam} vs ${matchState.awayTeam} LIVE!`, 'match');
  }

  // Handle innings transitions automatically
  if (matchState.status === 'first_half' && matchState.minute >= 45) {
     matchState.status = 'halftime';
     matchState.target = matchState.homeScore + 1; // SET TARGET
     addAlert('info', `🌍 GOOGLE SYNC: Innings Break. Target for ${matchState.awayTeam}: ${matchState.target}`, 'match');
  }

  if (matchState.status === 'halftime' && Math.random() < 0.05) {
     matchState.status = 'second_half';
     matchState.battingTeam = 'away'; 
     addAlert('warning', `🌍 GOOGLE SYNC: 2nd Innings Started! ${matchState.awayTeam} chasing ${matchState.target}`, 'match');
  }

  // Realistic Cricket Scoring (Runs & Wickets)
  if (['first_half', 'second_half'].includes(matchState.status) && Math.random() < 0.05) {
      const runs = [0, 1, 2, 4, 6][Math.floor(Math.random() * 5)];
      const wicket = Math.random() < 0.08; // 8% chance of a wicket

      if (matchState.status === 'first_half') {
        matchState.homeScore += runs;
        if (wicket && matchState.homeWickets < 10) matchState.homeWickets++;
      } else {
        matchState.awayScore += runs;
        if (wicket && matchState.awayWickets < 10) matchState.awayWickets++;
      }
      io.emit('match_update', matchState);
  }
}

// Entry Slots System
let entrySlots = [];
const SLOT_DURATION = 15; // minutes
for (let i = 0; i < 8; i++) {
  const startMin = i * SLOT_DURATION;
  entrySlots.push({
    id: `slot_${i}`,
    startTime: `${Math.floor(startMin / 60) + 17}:${String(startMin % 60).padStart(2, '0')}`,
    endTime: `${Math.floor((startMin + SLOT_DURATION) / 60) + 17}:${String((startMin + SLOT_DURATION) % 60).padStart(2, '0')}`,
    capacity: 7500,
    booked: 0,
    checkedIn: 0,
    status: 'available'
  });
}

// Food Menu
let MENU = [
  { id: 'm1',  name: 'Classic Burger',  price: 350, category: 'food',     prepTime: 5, image: '🍔', available: true },
  { id: 'm2',  name: 'Hot Dog',         price: 200, category: 'food',     prepTime: 3, image: '🌭', available: true },
  { id: 'm3',  name: 'Loaded Nachos',   price: 300, category: 'food',     prepTime: 4, image: '🧀', available: true },
  { id: 'm4',  name: 'Pizza Slice',     price: 250, category: 'food',     prepTime: 4, image: '🍕', available: true },
  { id: 'm5',  name: 'Chicken Wings',   price: 400, category: 'food',     prepTime: 6, image: '🍗', available: true },
  { id: 'm6',  name: 'French Fries',    price: 150, category: 'food',     prepTime: 3, image: '🍟', available: true },
  { id: 'm7',  name: 'Cola',            price: 100, category: 'beverage', prepTime: 1, image: '🥤', available: true },
  { id: 'm8',  name: 'Beer',            price: 300, category: 'beverage', prepTime: 1, image: '🍺', available: true },
  { id: 'm9',  name: 'Water Bottle',    price:  50, category: 'beverage', prepTime: 1, image: '💧', available: true },
  { id: 'm10', name: 'Coffee',          price: 150, category: 'beverage', prepTime: 2, image: '☕', available: true },
  { id: 'm11', name: 'Ice Cream',       price: 200, category: 'dessert',  prepTime: 2, image: '🍦', available: true },
  { id: 'm12', name: 'Cookie Pack',     price: 120, category: 'dessert',  prepTime: 1, image: '🍪', available: true }
];

// Orders tracking
let orders = [];
let orderIdCounter = 1000;

// Alerts system
let alerts = [];
let alertIdCounter = 1;

// Staff dispatch
let staff = [];
for (let i = 1; i <= 30; i++) {
  staff.push({
    id: `staff_${i}`,
    name: `Staff ${i}`,
    role: i <= 10 ? 'security' : i <= 20 ? 'service' : 'medical',
    zone: VENUE.zones[i % 5].id,
    status: 'available',
    currentTask: null
  });
}

// Initialize Database persistence
initDB(staff, orders);

// Analytics accumulator
let analytics = {
  totalEntries: 0,
  totalOrders: 0,
  totalRevenue: 0,
  peakCrowd: 0,
  avgWaitTime: 0,
  incidentsResolved: 0,
  crowdHistory: [],
  revenueHistory: [],
  waitTimeHistory: [],
  zoneHeatmap: {}
};

// ============================================================
// SIMULATION ENGINE
// ============================================================

function simulateCrowd() {
  const isMatch = ['first_half', 'second_half', 'extra_time'].includes(matchState.status);
  const isHalftime = matchState.status === 'halftime';
  const isPreMatch = matchState.status === 'pre_match';

  VENUE.zones.forEach(zone => {
    if (isPreMatch) {
      // Gradual filling
      const fillRate = Math.random() * 200 + 50;
      zone.current = Math.min(zone.capacity, zone.current + Math.floor(fillRate));
    } else if (isMatch) {
      // Small fluctuations during match
      const delta = Math.floor((Math.random() - 0.5) * 50);
      zone.current = Math.max(0, Math.min(zone.capacity, zone.current + delta));
    } else if (isHalftime) {
      // Movement during halftime (10-20% leave seats)
      const movement = Math.floor(zone.current * (0.1 + Math.random() * 0.1));
      zone.current = Math.max(0, zone.current - Math.floor(movement * 0.3));
    }
  });

  // Update gate flows
  VENUE.gates.forEach(gate => {
    if (isPreMatch) {
      gate.current_flow = Math.floor(Math.random() * gate.throughput * 0.8);
      gate.queue_length = Math.max(0, gate.current_flow - gate.throughput * 0.6);
    } else if (matchState.status === 'post_match') {
      gate.current_flow = Math.floor(Math.random() * gate.throughput);
      gate.queue_length = Math.floor(Math.random() * 200);
    } else {
      gate.current_flow = Math.floor(Math.random() * 50);
      gate.queue_length = 0;
    }
  });

  // Update concession queues
  VENUE.concessions.forEach(c => {
    if (isHalftime) {
      c.queue_time = Math.floor(Math.random() * 15 + 5);
      c.orders_pending = Math.floor(Math.random() * 25 + 10);
    } else if (isMatch) {
      c.queue_time = Math.floor(Math.random() * 5);
      c.orders_pending = Math.floor(Math.random() * 8);
    } else {
      c.queue_time = Math.floor(Math.random() * 3);
      c.orders_pending = Math.floor(Math.random() * 5);
    }
  });

  // Update restrooms
  VENUE.restrooms.forEach(r => {
    const zone = VENUE.zones.find(z => z.id === r.zone);
    const occupancyRate = isHalftime ? 0.7 : 0.3;
    r.occupancy = Math.floor(r.capacity * occupancyRate * Math.random());
    r.wait_time = r.occupancy > r.capacity * 0.8 ? Math.floor(Math.random() * 8 + 3) : 0;
  });

  // Update attendance
  matchState.attendance = VENUE.zones.reduce((sum, z) => sum + z.current, 0);
  analytics.peakCrowd = Math.max(analytics.peakCrowd, matchState.attendance);

  // Record history
  analytics.crowdHistory.push({
    time: new Date().toISOString(),
    count: matchState.attendance,
    minute: matchState.minute
  });
  if (analytics.crowdHistory.length > 100) analytics.crowdHistory.shift();
}

function autoDispatchStaff() {
  VENUE.zones.forEach(zone => {
    // Only check if utilization is super high
    if (zone.current / zone.capacity > 0.85) {
      // Find idle security or service staff
      const idleStaff = staff.find(s => s.status === 'available' && (s.role === 'security' || s.role === 'service'));
      if (idleStaff) {
        idleStaff.zone = zone.id;
        idleStaff.status = 'dispatched';
        idleStaff.currentTask = 'Autonomous crowd control triggered by AI density threshold';
        syncStaff(idleStaff);
        
        addAlert('warning', `🤖 AI SYSTEM: Autonomously dispatched ${idleStaff.name} to ${zone.name} to manage critical density.`, 'system');
        io.emit('staff_update', idleStaff);
      }
    }
  });
}

let matchTickCount = 0;
function simulateMatch() {
  if (matchState.status === 'pre_match' || matchState.status === 'post_match' || matchState.status === 'halftime') return;

  matchTickCount++;
  
  if (matchTickCount >= 4) {
      matchTickCount = 0;
      matchState.minute++;
  }

  if (Math.random() < 0.005) {
      const isHome = Math.random() > 0.45;
      if (isHome) matchState.homeScore++;
      else matchState.awayScore++;
      const team = isHome ? matchState.homeTeam : matchState.awayTeam;
      matchState.events.push({ minute: matchState.minute, type: 'goal', team });
      const icon = matchState.sport === 'cricket' ? '🏏' : matchState.sport === 'basketball' ? '🏀' : '⚽';
      addAlert('success', `${icon} EVENT! ${team} scores at ${matchState.minute}'!`, 'match');
      io.emit('match_update', matchState);
  }
}

function addAlert(type, message, source) {
  const alert = {
    id: alertIdCounter++,
    type, // info, warning, danger, success
    message,
    source, // system, match, crowd, safety
    timestamp: new Date().toISOString(),
    acknowledged: false
  };
  alerts.unshift(alert);
  if (alerts.length > 50) alerts.pop();
  io.emit('alert', alert);
  return alert;
}

// Generate random alerts
function generateRandomAlerts() {
  const alertTypes = [
    { type: 'warning', msg: 'High crowd density detected near Gate C', source: 'crowd' },
    { type: 'info', msg: 'Weather update: Temperature 28°C, Clear sky', source: 'system' },
    { type: 'warning', msg: 'Restroom R2 occupancy at 90%', source: 'system' },
    { type: 'info', msg: 'Parking lot P3 is now full. Redirecting to P4.', source: 'system' },
    { type: 'danger', msg: 'Medical assistance requested at Section E-14', source: 'safety' },
    { type: 'info', msg: 'South Grill running low on burger patties', source: 'system' },
    { type: 'warning', msg: 'Exit pathway 3 congestion above threshold', source: 'crowd' }
  ];

  if (Math.random() < 0.15) {
    const a = alertTypes[Math.floor(Math.random() * alertTypes.length)];
    addAlert(a.type, a.msg, a.source);
  }
}

// Process pending orders
function processOrders() {
  orders.forEach(order => {
    if (order.status === 'preparing') {
      order.remainingTime = Math.max(0, order.remainingTime - 1);
      if (order.remainingTime <= 0) {
        order.status = 'ready';
        syncOrder(order);
        io.emit('order_update', order);
      }
    }
  });
}

// Main simulation loop (runs every 2 seconds)
let simInterval = null;
function startSimulation() {
  if (simInterval) return;
  simInterval = setInterval(() => {
    simulateCrowd();
    simulateMatch();
    runWorldAgent(); // Call the AI Agent Sync
    generateRandomAlerts();
    processOrders();
    autoDispatchStaff();

    // Broadcast state
    io.emit('venue_update', getVenueState());
    io.emit('match_update', matchState);
  }, 500);
}

function getVenueState() {
  return {
    zones: VENUE.zones,
    gates: VENUE.gates,
    concessions: VENUE.concessions,
    restrooms: VENUE.restrooms,
    totalAttendance: matchState.attendance,
    capacity: VENUE.capacity,
    utilization: ((matchState.attendance / VENUE.capacity) * 100).toFixed(1)
  };
}

// ============================================================
// REST API ROUTES
// ============================================================

// --- Venue State ---
app.get('/api/venue', (req, res) => {
  res.json({
    success: true,
    data: {
      name: VENUE.name,
      ...getVenueState()
    }
  });
});

app.get('/api/venue/zones', (req, res) => {
  res.json({ success: true, data: VENUE.zones });
});

app.get('/api/venue/gates', (req, res) => {
  res.json({ success: true, data: VENUE.gates });
});

app.post('/api/venue/settings', (req, res) => {
  const { capacity } = req.body;
  if (capacity && capacity > 0) {
    const ratio = capacity / VENUE.capacity;
    VENUE.capacity = capacity;
    VENUE.zones.forEach(z => {
      z.capacity = Math.floor(z.capacity * ratio);
    });
    addAlert('info', `Stadium capacity dynamically updated to ${capacity.toLocaleString()}`, 'system');
  }
  res.json({ success: true, data: getVenueState() });
});

// --- Match State ---
app.get('/api/match', (req, res) => {
  res.json({ success: true, data: matchState });
});

app.post('/api/match/sync', (req, res) => {
  const { enabled } = req.body;
  matchState.worldSyncMode = !!enabled;
  
  // FORCE OVERWRITE: If enabled, immediately jump to Real-World context
  if (enabled) {
    matchState.homeTeam = GOOGLE_REALITY_FEED.homeTeam;
    matchState.awayTeam = GOOGLE_REALITY_FEED.awayTeam;
    matchState.stadium = GOOGLE_REALITY_FEED.stadium;
    matchState.stadiumName = GOOGLE_REALITY_FEED.stadiumName;
    matchState.sport = GOOGLE_REALITY_FEED.sport;
    matchState.status = 'first_half'; 
    matchState.minute = 10; // Jump into the action
  }

  addAlert(enabled ? 'success' : 'warning', `🌍 Google AI Sync ${enabled ? 'CONNECTED' : 'DISCONNECTED'}`, 'match');
  io.emit('match_update', matchState);
  res.json({ success: true, enabled: matchState.worldSyncMode });
});

app.post('/api/match/control', (req, res) => {
  const { action } = req.body;
  switch (action) {
    case 'start':
      matchState.status = 'first_half';
      if(matchState.minute === 0) matchState.minute = 1;
      addAlert('info', 'Match has started! First half underway.', 'match');
      break;
    case 'halftime':
      matchState.status = 'halftime';
      addAlert('info', 'Halftime break initiated.', 'match');
      break;
    case 'second_half':
      matchState.status = 'second_half';
      if(matchState.minute < 45) matchState.minute = 45;
      addAlert('info', 'Second half begins!', 'match');
      break;
    case 'end':
      matchState.status = 'post_match';
      if(matchState.minute < 90) matchState.minute = 90;
      addAlert('info', 'Match concluded.', 'match');
      break;
    case 'reset':
      matchState = {
        stadium: matchState.stadium || 'metastadium',
        status: 'pre_match', minute: 0,
        homeTeam: matchState.homeTeam || 'Metro United', awayTeam: matchState.awayTeam || 'City Strikers',
        homeScore: 0, awayScore: 0, events: [], attendance: 0,
        sport: matchState.sport || 'football'
      };
      VENUE.zones.forEach(z => z.current = 0);
      VENUE.gates.forEach(g => { g.current_flow = 0; g.queue_length = 0; });
      addAlert('info', 'Match state reset.', 'system');
      break;
  }
  io.emit('match_update', matchState);
  res.json({ success: true, data: matchState });
});

// MANUAL SCORE PUSH — admin sets exact score, broadcasts to all attendees
app.post('/api/match/score', (req, res) => {
  const { homeScore, awayScore, sport } = req.body;
  if (homeScore !== undefined) matchState.homeScore = parseInt(homeScore);
  if (awayScore !== undefined) matchState.awayScore = parseInt(awayScore);
  if (sport) matchState.sport = sport;
  const icon = sport === 'cricket' ? '🏏' : sport === 'basketball' ? '🏀' : sport === 'volleyball' ? '🏐' : '⚽';
  if (homeScore !== awayScore || homeScore > 0) {
    addAlert('success', `${icon} Score Update — ${matchState.homeTeam} ${matchState.homeScore} : ${matchState.awayScore} ${matchState.awayTeam}`, 'match');
  }
  io.emit('match_update', matchState);
  res.json({ success: true, data: matchState });
});

// MATCH CONFIG — update team names, sport, stadium
app.post('/api/match/config', (req, res) => {
  const { teamA, teamB, sport, stadium } = req.body;
  if (teamA) matchState.homeTeam = teamA;
  if (teamB) matchState.awayTeam = teamB;
  if (sport) matchState.sport = sport;
  if (stadium) matchState.stadium = stadium;
  io.emit('match_update', matchState);
  addAlert('info', `🏟️ Match configured: ${matchState.homeTeam} vs ${matchState.awayTeam} (${(sport||'football').toUpperCase()})`, 'system');
  res.json({ success: true, data: matchState });
});

// --- Entry Slots ---
app.get('/api/entry/slots', (req, res) => {
  res.json({ success: true, data: entrySlots });
});

const bookedTicketIPs = new Set();
app.post('/api/entry/book', (req, res) => {
  const userIp = req.ip || req.connection?.remoteAddress || 'unknown';
  if (bookedTicketIPs.has(userIp)) {
    return res.status(400).json({ success: false, error: 'You have already booked a ticket. Only one ticket allowed per person.' });
  }

  const { slotId, count = 1 } = req.body;
  if (count > 1) {
    return res.status(400).json({ success: false, error: 'Only 1 ticket allowed per booking.' });
  }

  const slot = entrySlots.find(s => s.id === slotId);
  if (!slot) return res.status(404).json({ success: false, error: 'Slot not found' });
  if (slot.booked + count > slot.capacity) {
    return res.status(400).json({ success: false, error: 'Slot is full' });
  }
  
  slot.booked += count;
  if (slot.booked >= slot.capacity) slot.status = 'full';
  
  const ticket = {
    id: uuidv4(),
    slotId: slot.id,
    timeWindow: `${slot.startTime} - ${slot.endTime}`,
    count: 1,
    gate: VENUE.gates[Math.floor(Math.random() * VENUE.gates.length)].id,
    qrCode: `QR-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`
  };
  
  analytics.totalEntries += count;
  bookedTicketIPs.add(userIp); // Restrict future bookings
  
  res.json({ success: true, data: ticket });
});

app.post('/api/entry/checkin', (req, res) => {
  const { slotId } = req.body;
  const slot = entrySlots.find(s => s.id === slotId);
  if (!slot) return res.status(404).json({ success: false, error: 'Slot not found' });
  slot.checkedIn++;
  res.json({ success: true, data: slot });
});

// --- Food Ordering ---
app.get('/api/food/menu', (req, res) => {
  res.json({ success: true, data: MENU });
});

app.get('/api/food/concessions', (req, res) => {
  res.json({ success: true, data: VENUE.concessions });
});

app.post('/api/food/order', (req, res) => {
  const { items, zone, seat, concessionId } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ success: false, error: 'No items specified' });
  }

  const concession = concessionId
    ? VENUE.concessions.find(c => c.id === concessionId)
    : VENUE.concessions.find(c => c.zone === zone && c.status === 'open');

  if (!concession) {
    return res.status(400).json({ success: false, error: 'No available concession stand' });
  }

  let total = 0;
  let maxPrepTime = 0;
  const orderItems = items.map(item => {
    const menuItem = MENU.find(m => m.id === item.id);
    if (!menuItem) return null;
    total += menuItem.price * (item.qty || 1);
    maxPrepTime = Math.max(maxPrepTime, menuItem.prepTime);
    return { ...menuItem, qty: item.qty || 1 };
  }).filter(Boolean);

  const order = {
    id: `ORD-${++orderIdCounter}`,
    items: orderItems,
    total,
    zone: zone || concession.zone,
    seat: seat || 'Pickup',
    concession: concession.name,
    concessionId: concession.id,
    status: 'preparing',
    estimatedTime: maxPrepTime + Math.floor(concession.queue_time * 0.5),
    remainingTime: maxPrepTime + Math.floor(concession.queue_time * 0.5),
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  syncOrder(order);
  concession.orders_pending++;
  analytics.totalOrders++;
  analytics.totalRevenue += total;

  io.emit('new_order', order);
  res.json({ success: true, data: order });
});

app.get('/api/food/orders', (req, res) => {
  res.json({ success: true, data: orders.slice(-50).reverse() });
});

app.get('/api/food/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  res.json({ success: true, data: order });
});

app.post('/api/food/orders/:id/complete', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  order.status = 'delivered';
  syncOrder(order);
  const concession = VENUE.concessions.find(c => c.id === order.concessionId);
  if (concession) concession.orders_pending = Math.max(0, concession.orders_pending - 1);
  io.emit('order_update', order);
  res.json({ success: true, data: order });
});

// --- Routing ---
app.get('/api/routing/optimal', (req, res) => {
  const { from, to } = req.query;
  // Simple routing simulation
  const routes = [
    { path: ['Main Concourse', 'North Corridor', 'Section A'], distance: '120m', time: '3 min', congestion: 'low' },
    { path: ['East Passage', 'Upper Deck', 'Section A'], distance: '180m', time: '5 min', congestion: 'medium' },
    { path: ['South Link', 'Ground Level', 'Section A'], distance: '200m', time: '6 min', congestion: 'high' }
  ];
  const recommended = routes[0];
  res.json({ success: true, data: { recommended, alternatives: routes.slice(1) } });
});

// --- Alerts ---
app.get('/api/alerts', (req, res) => {
  res.json({ success: true, data: alerts });
});

app.post('/api/alerts/:id/acknowledge', (req, res) => {
  const alert = alerts.find(a => a.id === parseInt(req.params.id));
  if (!alert) return res.status(404).json({ success: false, error: 'Alert not found' });
  alert.acknowledged = true;
  res.json({ success: true, data: alert });
});

app.post('/api/alerts/create', (req, res) => {
  const { type, message, source } = req.body;
  const alert = addAlert(type || 'info', message, source || 'manual');
  res.json({ success: true, data: alert });
});

// --- Staff ---
app.get('/api/staff', (req, res) => {
  res.json({ success: true, data: staff });
});

app.post('/api/staff/add', (req, res) => {
  const { name, role, zone } = req.body;
  if (!name || !role) return res.status(400).json({ success: false, error: 'Name and role required' });
  
  const newStaff = {
    id: 'S' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'),
    name, role, zone: zone || 'unassigned', status: 'available', currentTask: null,
    manualDispatch: false
  };
  staff.push(newStaff);
  syncStaff(newStaff);
  
  io.emit('staff_update', newStaff); // Update all clients
  res.json({ success: true, data: newStaff });
});

app.delete('/api/staff/:id', (req, res) => {
  const idx = staff.findIndex(st => st.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Staff not found' });
  
  const removedStaff = staff.splice(idx, 1)[0];
  if(removedStaff) syncStaff(removedStaff, true);
  io.emit('staff_removed', req.params.id);
  res.json({ success: true });
});

app.post('/api/staff/:id/dispatch', (req, res) => {
  const s = staff.find(st => st.id === req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Staff not found' });
  const { zone, task } = req.body;
  s.zone = zone || s.zone;
  s.status = 'dispatched';
  s.currentTask = task || 'General assistance';
  syncStaff(s);
  addAlert('info', `${s.name} dispatched to ${zone} for: ${s.currentTask}`, 'system');
  io.emit('staff_update', s);
  res.json({ success: true, data: s });
});

app.post('/api/staff/:id/release', (req, res) => {
  const s = staff.find(st => st.id === req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Staff not found' });
  s.status = 'available';
  s.manualDispatch = false;
  s.currentTask = null;
  syncStaff(s);
  io.emit('staff_update', s);
  res.json({ success: true, data: s });
});

// --- Analytics ---
app.get('/api/analytics', (req, res) => {
  const avgQueueTime = VENUE.concessions.reduce((s, c) => s + c.queue_time, 0) / VENUE.concessions.length;
  res.json({
    success: true,
    data: {
      ...analytics,
      currentAttendance: matchState.attendance,
      utilization: ((matchState.attendance / VENUE.capacity) * 100).toFixed(1),
      avgQueueTime: avgQueueTime.toFixed(1),
      activeAlerts: alerts.filter(a => !a.acknowledged).length,
      staffDeployed: staff.filter(s => s.status === 'dispatched').length,
      staffAvailable: staff.filter(s => s.status === 'available').length
    }
  });
});

app.get('/api/analytics/crowd-history', (req, res) => {
  res.json({ success: true, data: analytics.crowdHistory });
});

// --- Dynamic Signage ---
app.get('/api/signage', (req, res) => {
  const signs = VENUE.gates.map(gate => {
    const zone = VENUE.zones.find(z => z.id === gate.zone);
    const congestion = gate.queue_length > 100 ? 'high' : gate.queue_length > 30 ? 'medium' : 'low';
    const recommended = congestion !== 'high';
    return {
      gateId: gate.id,
      gateName: gate.name,
      zoneName: zone.name,
      congestion,
      recommended,
      message: recommended
        ? `✅ ${gate.name} — Short queue (~${Math.floor(gate.queue_length / 10)} min wait)`
        : `⚠️ ${gate.name} — Busy (try ${VENUE.gates.find(g => g.zone === gate.zone && g.id !== gate.id)?.name || 'another gate'})`
    };
  });
  res.json({ success: true, data: signs });
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    simulation: simInterval ? 'running' : 'stopped'
  });
});


// ─── RAZORPAY PAYMENT ────────────────────────────────────────────────
// Step 1: Attendee submits cart → backend creates Razorpay order
app.post('/api/payment/create-order', async (req, res) => {
  const { items, zone, seat } = req.body;
  if (!items || !items.length || !seat) {
    return res.status(400).json({ success: false, error: 'Missing items or seat' });
  }

  let total = 0;
  let maxPrepTime = 0;
  const orderItems = items.map(item => {
    const menuItem = MENU.find(m => m.id === item.id);
    if (!menuItem || !menuItem.available) return null;
    total += menuItem.price * (item.qty || 1);
    maxPrepTime = Math.max(maxPrepTime, menuItem.prepTime);
    return { ...menuItem, qty: item.qty || 1 };
  }).filter(Boolean);

  if (!orderItems.length) {
    return res.status(400).json({ success: false, error: 'All selected items are unavailable' });
  }

  // Generate internal pending order ref
  const pendingRef = `PEND-${uuidv4().split('-')[0].toUpperCase()}`;
  pendingPayments[pendingRef] = { items: orderItems, total, zone, seat, maxPrepTime };

  // If Razorpay is configured with real keys, create gateway order
  if (razorpay && RAZORPAY_KEY_ID !== 'rzp_test_DEMO_KEY_ID') {
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: total * 100, // paise
        currency: 'INR',
        receipt: pendingRef,
        notes: { seat, zone }
      });
      pendingPayments[pendingRef].rzpOrderId = rzpOrder.id;
      return res.json({
        success: true,
        data: {
          pendingRef,
          rzpOrderId: rzpOrder.id,
          rzpKeyId: RAZORPAY_KEY_ID,
          total,
          items: orderItems
        }
      });
    } catch (err) {
      console.error('Razorpay order creation error:', err.message);
    }
  }

  // Demo / test mode — skip gateway, return simulate-pass token
  res.json({
    success: true,
    data: {
      pendingRef,
      rzpOrderId: `order_DEMO_${Date.now()}`,
      rzpKeyId: RAZORPAY_KEY_ID,
      total,
      items: orderItems,
      demoMode: true
    }
  });
});

// Step 2: After Razorpay success callback → verify signature & create real order
app.post('/api/payment/verify', (req, res) => {
  const { pendingRef, razorpay_order_id, razorpay_payment_id, razorpay_signature, demoSuccess } = req.body;

  const pending = pendingPayments[pendingRef];
  if (!pending) return res.status(404).json({ success: false, error: 'Unknown payment reference' });

  // In demo mode, just trust the client-side confirm
  if (!demoSuccess) {
    // Verify HMAC signature from Razorpay
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(body).digest('hex');
    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
    }
  }

  // Payment confirmed — create the real order
  const concession = VENUE.concessions.find(c => c.zone === pending.zone && c.status === 'open')
                  || VENUE.concessions.find(c => c.status === 'open');
  if (!concession) return res.status(400).json({ success: false, error: 'No concession available' });

  const order = {
    id: `ORD-${++orderIdCounter}`,
    items: pending.items,
    total: pending.total,
    zone: pending.zone,
    seat: pending.seat,
    concession: concession.name,
    concessionId: concession.id,
    status: 'preparing',
    estimatedTime: pending.maxPrepTime + Math.floor(concession.queue_time * 0.5),
    remainingTime: pending.maxPrepTime + Math.floor(concession.queue_time * 0.5),
    paymentId: razorpay_payment_id || `demo_${Date.now()}`,
    qrCode: null, // Assigned below
    createdAt: new Date().toISOString()
  };
  // Fix self-ref for qrCode
  order.qrCode = `PICKUP-${order.id}-${uuidv4().split('-')[0].toUpperCase()}`;

  orders.push(order);
  syncOrder(order);
  concession.orders_pending++;
  analytics.totalOrders++;
  analytics.totalRevenue += order.total;

  delete pendingPayments[pendingRef];
  io.emit('new_order', order);
  res.json({ success: true, data: order });
});

// ─── MENU MANAGEMENT (Staff Dashboard) ───────────────────────────────
// Toggle item availability
app.post('/api/food/menu/:id/toggle', (req, res) => {
  const item = MENU.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
  item.available = !item.available;
  io.emit('menu_update', MENU);
  res.json({ success: true, data: item });
});

// Add a new menu item
app.post('/api/food/menu/add', (req, res) => {
  const { name, price, category, prepTime, image } = req.body;
  if (!name || !price || !category) {
    return res.status(400).json({ success: false, error: 'name, price, category required' });
  }
  const item = {
    id: `m${Date.now()}`,
    name, price: parseInt(price), category,
    prepTime: parseInt(prepTime) || 5,
    image: image || '🍽️',
    available: true
  };
  MENU.push(item);
  io.emit('menu_update', MENU);
  res.json({ success: true, data: item });
});

// Delete a menu item
app.delete('/api/food/menu/:id', (req, res) => {
  const idx = MENU.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Item not found' });
  const [removed] = MENU.splice(idx, 1);
  io.emit('menu_update', MENU);
  res.json({ success: true, data: removed });
});

// ─── QR ORDER SCANNER VERIFICATION ───────────────────────────────────
// Staff scans the attendee's pickup QR; marks it as delivered
app.post('/api/orders/scan-pickup', (req, res) => {
  const { qrCode } = req.body;
  if (!qrCode) return res.status(400).json({ success: false, error: 'qrCode required' });
  const order = orders.find(o => o.qrCode === qrCode || o.id === qrCode);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found — invalid QR' });
  if (order.status === 'delivered') return res.json({ success: true, data: order, message: 'Already delivered' });
  if (order.status === 'preparing') return res.status(400).json({ success: false, error: 'Order still being prepared', data: order });

  order.status = 'delivered';
  syncOrder(order);
  const concession = VENUE.concessions.find(c => c.id === order.concessionId);
  if (concession) concession.orders_pending = Math.max(0, concession.orders_pending - 1);
  io.emit('order_update', order);
  res.json({ success: true, data: order, message: 'Order confirmed and delivered!' });
});

// ─── IMPROVED ROUTING ────────────────────────────────────────────────
app.get('/api/routing/optimal', (req, res) => {
  const { from, to, gate } = req.query;

  // Compute congestion-aware routes from the gate
  const gateObj = VENUE.gates.find(g => g.id === gate) || VENUE.gates[0];
  const lowGates = VENUE.gates.filter(g => g.queue_length <= 30).map(g => g.name);
  const busyGates = VENUE.gates.filter(g => g.queue_length > 30);

  const destinations = {
    seat:     { name: 'Your Seat',      icon: '🪑' },
    food:     { name: 'Food Stand',     icon: '🍔' },
    restroom: { name: 'Nearest Restroom', icon: '🚻' },
    exit:     { name: 'Nearest Exit',   icon: '🚪' },
    medical:  { name: 'Medical Station', icon: '🏥' },
    merch:    { name: 'Merchandise',    icon: '🛍️' }
  };
  const dest = destinations[to] || { name: to, icon: '📍' };
  const cong = busyGates.length > 4 ? 'high' : busyGates.length > 2 ? 'medium' : 'low';

  const pathOptions = [
    { 
      label: 'Recommended',
      steps: [`Enter via ${gateObj.name}`, 'Take Main Concourse (Level 1)', `Head to ${dest.icon} ${dest.name}`],
      distance: '120m', time: cong === 'low' ? '3 min' : cong === 'medium' ? '5 min' : '8 min',
      congestion: cong,
      recommended: true
    },
    { 
      label: 'Alternative A',
      steps: [`Enter via ${gateObj.name}`, 'Take Upper Deck walkway', `Find ${dest.icon} ${dest.name} on Level 2`],
      distance: '180m', time: cong === 'low' ? '5 min' : '7 min',
      congestion: 'low',
      recommended: false
    },
    { 
      label: 'Alternative B',
      steps: ['South Concourse bypass', 'Ground level pathway', `Arrive at ${dest.icon} ${dest.name}`],
      distance: '220m', time: '9 min',
      congestion: 'medium',
      recommended: false
    }
  ];

  res.json({ success: true, data: { recommended: pathOptions[0], alternatives: pathOptions.slice(1), lowCongestionGates: lowGates } });
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));


// ============================================================
// WEBSOCKET
// ============================================================

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send initial state
  socket.emit('venue_update', getVenueState());
  socket.emit('match_update', matchState);
  socket.emit('alerts_init', alerts);

  socket.on('admin_score_update', (data) => {
    if (data.homeScore !== undefined) matchState.homeScore = parseInt(data.homeScore);
    if (data.awayScore !== undefined) matchState.awayScore = parseInt(data.awayScore);
    io.emit('match_update', matchState);
    console.log(`Score updated via socket: ${matchState.homeScore} - ${matchState.awayScore}`);
  });

  socket.on('request_route', (data) => {
    const routes = [
      { path: 'North Corridor → Section ' + (data.section || 'A'), time: '3 min', congestion: 'low' },
      { path: 'East Bypass → Section ' + (data.section || 'A'), time: '5 min', congestion: 'medium' }
    ];
    socket.emit('route_response', { routes, recommended: routes[0] });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🏟️  VenueAI Server running at http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`📱 Attendee App: http://localhost:${PORT}`);
  console.log(`🔌 API Base: http://localhost:${PORT}/api\n`);
  startSimulation();
});
