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
const { db } = require('./firebase');

// ── Razorpay config (Set these in Vercel Environment Variables) ──────────
const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID     || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
let Razorpay;
try {
  Razorpay = require('razorpay');
} catch(e) { Razorpay = null; }
const razorpay = (Razorpay && RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) 
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET }) 
  : null;

if (!razorpay) console.warn("⚠️ Razorpay: Payment gateway not configured. Transactions will be simulated.");

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

// Map of Stadium ID -> Venue Infrastructure (Gates, Concessions, Zones)
let stadiumVenues = {};

// Default template for a new stadium venue
function createVenueTemplate(stadium) {
  return {
    id: stadium.id,
    name: stadium.name,
    city: stadium.city,
    sport: stadium.sport,
    capacity: stadium.capacity || 50000,
    zones: [
      { id: 'north', name: 'Premium North', current: 0, capacity: Math.floor((stadium.capacity||50000)*0.25) },
      { id: 'south', name: 'General South', current: 0, capacity: Math.floor((stadium.capacity||50000)*0.25) },
      { id: 'east',  name: 'East Wing',     current: 0, capacity: Math.floor((stadium.capacity||50000)*0.20) },
      { id: 'west',  name: 'West Wing',     current: 0, capacity: Math.floor((stadium.capacity||50000)*0.20) },
      { id: 'vip',   name: 'Global VIP',    current: 0, capacity: Math.floor((stadium.capacity||50000)*0.10) }
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
      { id: 'f7', name: 'VIP Dining', zone: 'vip', type: 'premium', queue_time: 0, orders_pending: 0, staff: 6, status: 'open' }
    ],
    restrooms: [
      { id: 'r1', zone: 'north', occupancy: 0, capacity: 40, wait_time: 0 },
      { id: 'r2', zone: 'south', occupancy: 0, capacity: 40, wait_time: 0 },
      { id: 'r5', zone: 'vip', occupancy: 0, capacity: 20, wait_time: 0 }
    ],
    cctv: [
      { id: 'cam_01', name: 'Main Entrance', feed: 'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&q=80&w=800', status: 'online' },
      { id: 'cam_02', name: 'North Stand', feed: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&q=80&w=800', status: 'online' },
      { id: 'cam_03', name: 'Food Court', feed: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=800', status: 'online' },
      { id: 'cam_04', name: 'Gate C Queue', feed: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&q=80&w=800', status: 'online' }
    ]
  };
}

function getVenueState(sid) {
  return stadiumVenues[sid || 'hyderabad_stadium'] || stadiumVenues['hyderabad_stadium'];
}

// ============================================================
// GLOBAL KNOWLEDGE BASE: NATIONAL & INTERNATIONAL GROUNDS
// ============================================================

const STADIUMS_KNOWLEDGE_BASE = [
  // CRICKET
  { id: 'hyderabad_stadium', name: 'Rajiv Gandhi Intl Stadium', city: 'Hyderabad', sport: 'cricket', country: 'India', capacity: 55000 },
  { id: 'eden_gardens', name: 'Eden Gardens', city: 'Kolkata', sport: 'cricket', country: 'India', capacity: 66000 },
  { id: 'ahmedabad_stadium', name: 'Narendra Modi Stadium', city: 'Ahmedabad', sport: 'cricket', country: 'India', capacity: 132000 },
  { id: 'chinnaswamy', name: 'M. Chinnaswamy Stadium', city: 'Bengaluru', sport: 'cricket', country: 'India', capacity: 40000 },
  { id: 'chepauk', name: 'M. A. Chidambaram Stadium', city: 'Chennai', sport: 'cricket', country: 'India', capacity: 50000 },
  { id: 'wankhede', name: 'Wankhede Stadium', city: 'Mumbai', sport: 'cricket', country: 'India', capacity: 33000 },
  { id: 'delhi_stadium', name: 'Arun Jaitley Stadium', city: 'Delhi', sport: 'cricket', country: 'India', capacity: 41000 },
  { id: 'dharamshala_stadium', name: 'HPCA Stadium', city: 'Dharamshala', sport: 'cricket', country: 'India', capacity: 23000 },
  { id: 'ekana_stadium', name: 'Ekana Stadium', city: 'Lucknow', sport: 'cricket', country: 'India', capacity: 50000 },
  { id: 'jaipur_stadium', name: 'Sawai Mansingh Stadium', city: 'Jaipur', sport: 'cricket', country: 'India', capacity: 30000 },
  { id: 'mohali_stadium', name: 'IS Bindra Stadium', city: 'Mohali', sport: 'cricket', country: 'India', capacity: 26000 },
  { id: 'lords', name: 'Lord\'s Cricket Ground', city: 'London', sport: 'cricket', country: 'UK', capacity: 31000 },
  { id: 'mcg', name: 'Melbourne Cricket Ground', city: 'Melbourne', sport: 'cricket', country: 'Australia', capacity: 100000 },
  
  // FOOTBALL
  { id: 'salt_lake', name: 'Salt Lake Stadium', city: 'Kolkata', sport: 'football', country: 'India', capacity: 85000 },
  { id: 'wembley', name: 'Wembley Stadium', city: 'London', sport: 'football', country: 'UK', capacity: 90000 },
  { id: 'camp_nou', name: 'Camp Nou', city: 'Barcelona', sport: 'football', country: 'Spain', capacity: 99000 },
  { id: 'old_trafford', name: 'Old Trafford', city: 'Manchester', sport: 'football', country: 'UK', capacity: 74000 },
  
  // BASKETBALL & INDOOR
  { id: 'msg', name: 'Madison Square Garden', city: 'New York', sport: 'basketball', country: 'USA', capacity: 19500 },
  { id: 'staples', name: 'Crypto.com Arena', city: 'Los Angeles', sport: 'basketball', country: 'USA', capacity: 19000 },
  { id: 'ig_arena', name: 'Indira Gandhi Arena', city: 'Delhi', sport: 'basketball', country: 'India', capacity: 14000 },
  
  // VOLLEYBALL & HOCKEY
  { id: 'national_hockey', name: 'Major Dhyan Chand National Stadium', city: 'Delhi', sport: 'hockey', country: 'India', capacity: 16000 },
  { id: 'smc_complex', name: 'SMC Indoor Complex', city: 'Surat', sport: 'volleyball', country: 'India', capacity: 7000 },
  
  // TENNIS
  { id: 'wimbledon', name: 'Wimbledon Center Court', city: 'London', sport: 'tennis', country: 'UK', capacity: 15000 }
];

// Map of Stadium ID -> Current Live State & Infrastructure
let stadiumStates = {};
STADIUMS_KNOWLEDGE_BASE.forEach(s => {
  stadiumVenues[s.id] = createVenueTemplate(s);
});

// --- Daily Match Schedule (AI Control Center) ---
const DAILY_MATCH_SCHEDULE = {
  // Today's matches (AI will auto-select based on Date)
  '2026-04-14': [
    { sid: 'hyderabad_stadium', home: 'SRH (Sunrisers)', away: 'RR (Royals)', sport: 'cricket', name: 'Rajiv Gandhi Intl Stadium' },
    { sid: 'wembley', home: 'Manchester City', away: 'Arsenal', sport: 'football', name: 'Wembley Stadium' },
    { sid: 'msg', home: 'NY Knicks', away: 'MIAMI HEAT', sport: 'basketball', name: 'Madison Square Garden' },
    { sid: 'eden_gardens', home: 'KKR (Knights)', away: 'CSK (Super Kings)', sport: 'cricket', name: 'Eden Gardens' },
    { sid: 'chinnaswamy', home: 'RCB (Challengers)', away: 'MI (Indians)', sport: 'cricket', name: 'M. Chinnaswamy Stadium' },
    { sid: 'chepauk', home: 'CSK (Super Kings)', away: 'KKR (Knights)', sport: 'cricket', name: 'M. A. Chidambaram Stadium' }
  ],
  '2026-04-15': [
    { sid: 'eden_gardens', home: 'KKR (Knights)', away: 'MI (Indians)', sport: 'cricket', name: 'Eden Gardens' },
    { sid: 'camp_nou', home: 'Barcelona', away: 'PSG', sport: 'football', name: 'Camp Nou' },
    { sid: 'ahmedabad_stadium', home: 'GT (Titans)', away: 'SRH (Sunrisers)', sport: 'cricket', name: 'Narendra Modi Stadium' },
    { sid: 'wankhede', home: 'MI (Indians)', away: 'LSG (Giants)', sport: 'cricket', name: 'Wankhede Stadium' },
    { sid: 'delhi_stadium', home: 'DC (Capitals)', away: 'PBKS (Kings)', sport: 'cricket', name: 'Arun Jaitley Stadium' }
  ]
};

// Initialize all stadium states
STADIUMS_KNOWLEDGE_BASE.forEach(s => {
  stadiumStates[s.id] = {
    stadium: s.id,
    stadiumName: s.name,
    city: s.city,
    sport: s.sport,
    country: s.country,
    status: 'pre_match',
    minute: 0,
    homeTeam: s.sport === 'cricket' ? 'Home' : 'Home Team',
    awayTeam: s.sport === 'cricket' ? 'Away' : 'Away Team',
    homeScore: 0,
    homeWickets: 0,
    awayScore: 0,
    awayWickets: 0,
    target: 0,
    events: [],
    attendance: 0,
    battingTeam: 'home',
    worldSyncMode: true, // Auto-sync by default
    weather: { temp: 32, humidity: 45, condition: 'Clear' }
  };
});

function refreshDailySchedule() {
  const today = new Date().toISOString().split('T')[0];
  const schedule = DAILY_MATCH_SCHEDULE[today] || [];
  
  schedule.forEach(match => {
    if (stadiumStates[match.sid]) {
      const state = stadiumStates[match.sid];
      state.homeTeam = match.home;
      state.awayTeam = match.away;
      state.stadiumName = match.name;
      state.sport = match.sport;
      state.status = 'live'; // Start the match
      console.log(`📅 Daily Refresh: Activated ${match.home} vs ${match.away} at ${match.name}`);
    }
  });
}

function applyRealitySync() {
  Object.keys(GOOGLE_REALITY_FEED).forEach(sid => {
    if (stadiumStates[sid]) {
      const live = GOOGLE_REALITY_FEED[sid];
      const state = stadiumStates[sid];
      
      // Update core state
      state.homeTeam = live.homeTeam;
      state.awayTeam = live.awayTeam;
      state.homeScore = live.homeScore;
      state.homeWickets = live.homeWickets;
      state.awayScore = live.awayScore;
      state.awayWickets = live.awayWickets;
      state.target = live.target;
      state.status = live.status;
      state.toss = live.toss || 'Waiting for toss...';
      state.stadiumName = live.stadiumName;
      state.minute = live.minute || state.minute;

      // MANDATORY: Emit the update so frontend sees it instantly
      io.to(`stadium_${sid}`).emit('match_update', state);
      console.log(`📡 REALITY SYNC: Broadcast live data for ${sid} (${state.homeTeam} vs ${state.awayTeam})`);
    }
  });
}

// Initial calls
// REAL-WORLD SYNC DATA (Snapshot of today's live feed)
const GOOGLE_REALITY_FEED = {
  'hyderabad_stadium': {
    homeTeam: 'SRH (Sunrisers)',
    awayTeam: 'RR (Royals)',
    stadiumName: 'Rajiv Gandhi Intl Stadium',
    homeScore: 216, homeWickets: 6,
    awayScore: 159, awayWickets: 10,
    target: 217, status: 'post_match',
    result: 'SRH won by 57 runs'
  },
  'eden_gardens': {
    homeTeam: 'KKR (Knights)',
    awayTeam: 'CSK (Super Kings)',
    stadiumName: 'Eden Gardens',
    homeScore: 137, homeWickets: 9,
    awayScore: 141, awayWickets: 3,
    target: 138, status: 'post_match',
    toss: 'CSK won toss & elected to field',
    result: 'CSK won by 7 wickets'
  },
  'chinnaswamy': {
    homeTeam: 'RCB (Challengers)',
    awayTeam: 'MI (Indians)',
    stadiumName: 'M. Chinnaswamy Stadium',
    homeScore: 182, homeWickets: 6,
    awayScore: 185, awayWickets: 3,
    target: 183, status: 'second_half',
    minute: 19, // 19th over
    toss: 'MI won toss & elected to field',
    result: 'MI needing 5 runs from 6 balls'
  },
  'chepauk': {
    homeTeam: 'CSK (Super Kings)',
    awayTeam: 'KKR (Knights)',
    stadiumName: 'M. A. Chidambaram Stadium',
    homeScore: 141, homeWickets: 3,
    awayScore: 137, awayWickets: 9,
    target: 138, status: 'second_half',
    minute: 18, // 18th over
    toss: 'CSK won toss & elected to bowl',
    result: 'CSK cruising towards victory'
  }
};

// --- Firebase Persistence ---
async function saveStadiumData() {
  if (!db) return;
  try {
    const statesBatch = db.batch();
    Object.keys(stadiumStates).forEach(sid => {
      const docRef = db.collection('stadiumStates').doc(sid);
      statesBatch.set(docRef, stadiumStates[sid]);
    });

    const venuesBatch = db.batch();
    Object.keys(stadiumVenues).forEach(sid => {
      const docRef = db.collection('stadiumVenues').doc(sid);
      venuesBatch.set(docRef, stadiumVenues[sid]);
    });

    await Promise.all([statesBatch.commit(), venuesBatch.commit()]);
    console.log("💾 Persistence: Stadium states and venues saved to Firebase.");
  } catch (e) {
    console.error("❌ Persistence Save Error:", e.message);
  }
}

async function loadStadiumData() {
  if (!db) return;
  try {
    const statesSnap = await db.collection('stadiumStates').get();
    statesSnap.forEach(doc => {
      stadiumStates[doc.id] = doc.data();
    });

    const venuesSnap = await db.collection('stadiumVenues').get();
    venuesSnap.forEach(doc => {
      stadiumVenues[doc.id] = doc.data();
    });
    console.log("📖 Persistence: Loaded stadium data from Firebase.");
  } catch (e) {
    console.error("❌ Persistence Load Error:", e.message);
  }
}

// Initialize persistence
loadStadiumData();
setInterval(saveStadiumData, 60000); // Save every 60 seconds

/**
 * World Agent Logic (Multi-Stadium Support)
 */
function runWorldAgent() {
  Object.keys(stadiumStates).forEach(sid => {
    const matchState = stadiumStates[sid];
    if (!matchState.worldSyncMode) return;

    // Simulate weather variations
    matchState.weather.temp = 28 + Math.floor(Math.random() * 10);
    matchState.weather.humidity = 40 + Math.floor(Math.random() * 20);

    // IF GOOGLE SYNC IS ON for THIS stadium (or if it's the primary Hyderabad match)
    if (sid === 'hyderabad_stadium' || sid === GOOGLE_REALITY_FEED.stadium) {
      matchState.homeTeam = GOOGLE_REALITY_FEED.homeTeam;
      matchState.awayTeam = GOOGLE_REALITY_FEED.awayTeam;
      matchState.homeScore = GOOGLE_REALITY_FEED.homeScore;
      matchState.homeWickets = GOOGLE_REALITY_FEED.homeWickets;
      matchState.awayScore = GOOGLE_REALITY_FEED.awayScore;
      matchState.awayWickets = GOOGLE_REALITY_FEED.awayWickets;
      matchState.target = GOOGLE_REALITY_FEED.target;
      matchState.status = GOOGLE_REALITY_FEED.status;
      matchState.stadiumName = GOOGLE_REALITY_FEED.stadiumName;
      matchState.sport = GOOGLE_REALITY_FEED.sport;
    } else {
      // Auto-simulate if no real feed
      simulateMatch(sid);
    }

    // Broadcast to the specific Stadium Room
    io.to(`stadium_${sid}`).emit('match_update', matchState);
    
    // Also broadcast stadium name update if it changed
    io.to(`stadium_${sid}`).emit('venue_update', stadiumVenues[sid]);
  });
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
    zone: ['north','south','east','west','vip'][i % 5],
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


function simulateCrowd(stadiumId) {
  const sid = stadiumId || 'hyderabad_stadium';
  const matchState = stadiumStates[sid];
  const VENUE = stadiumVenues[sid];
  if(!matchState || !VENUE) return;

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
  // analytics is global for now, but we could make it per stadium if needed
  analytics.peakCrowd = Math.max(analytics.peakCrowd, matchState.attendance);

  // Record history
  analytics.crowdHistory.push({
    stadiumId: sid,
    time: new Date().toISOString(),
    count: matchState.attendance,
    minute: matchState.minute
  });
  if (analytics.crowdHistory.length > 500) analytics.crowdHistory.shift();
}

function autoDispatchStaff(sid) {
  const VENUE = stadiumVenues[sid];
  if (!VENUE) return;
  VENUE.zones.forEach(zone => {
    // Only check if utilization is super high
    if (zone.current / zone.capacity > 0.85) {
      // Find idle security or service staff
      const idleStaff = staff.find(s => s.status === 'available' && (s.role === 'security' || s.role === 'service'));
      if (idleStaff) {
        idleStaff.zone = zone.id;
        idleStaff.status = 'dispatched';
        idleStaff.currentTask = `Autonomous crowd control triggered by AI density threshold at ${VENUE.name}`;
        syncStaff(idleStaff);
        
        addAlert('warning', `🤖 AI SYSTEM: Autonomously dispatched ${idleStaff.name} to ${zone.name} at ${VENUE.name}`, 'system', sid);
        io.to(`stadium_${sid}`).emit('staff_update', idleStaff);
      }
    }
  });
}

function simulateMatch(sid) {
  const matchState = stadiumStates[sid];
  if (!matchState || matchState.status === 'pre_match' || matchState.status === 'post_match' || matchState.status === 'halftime' || matchState.worldSyncMode) return;

  matchState.tick = (matchState.tick || 0) + 1;
  
  if (matchState.tick >= 4) {
      matchState.tick = 0;
      matchState.minute++;
  }

  // Cricket Innings Logic
  if (matchState.sport === 'cricket') {
    if (matchState.battingTeam === 'home' && matchState.homeWickets >= 10) {
      matchState.battingTeam = 'away';
      matchState.target = matchState.homeScore + 1;
      addAlert('info', `🏏 First innings over! ${matchState.awayTeam} needs ${matchState.target} to win.`, 'match', sid);
    } else if (matchState.battingTeam === 'away' && (matchState.awayWickets >= 10 || (matchState.target > 0 && matchState.awayScore >= matchState.target))) {
      matchState.status = 'post_match';
      const winner = matchState.awayScore >= matchState.target ? matchState.awayTeam : matchState.homeTeam;
      addAlert('success', `🏁 Match Over! ${winner} won the game!`, 'match', sid);
    }
  }

  if (Math.random() < 0.01) {
      const isHome = matchState.battingTeam === 'home';
      const scoringTeam = isHome ? 'home' : 'away';
      
      if (Math.random() > 0.3) {
        // Run/Goal
        if (scoringTeam === 'home') matchState.homeScore += (matchState.sport === 'cricket' ? Math.ceil(Math.random() * 6) : 1);
        else matchState.awayScore += (matchState.sport === 'cricket' ? Math.ceil(Math.random() * 6) : 1);
      } else if (matchState.sport === 'cricket') {
        // Wicket
        if (scoringTeam === 'home') matchState.homeWickets++;
        else matchState.awayWickets++;
      }

      const teamName = isHome ? matchState.homeTeam : matchState.awayTeam;
      const icon = matchState.sport === 'cricket' ? '🏏' : matchState.sport === 'basketball' ? '🏀' : '⚽';
      
      io.to(`stadium_${sid}`).emit('match_update', matchState);
  }
}

function addAlert(type, message, source, sid) {
  const alert = {
    id: alertIdCounter++,
    type, // info, warning, danger, success
    message,
    source, // system, match, crowd, safety
    stadiumId: sid,
    timestamp: new Date().toISOString(),
    acknowledged: false
  };
  alerts.unshift(alert);
  if (alerts.length > 50) alerts.pop();
  if (sid) io.to(`stadium_${sid}`).emit('alert', alert);
  else io.emit('alert', alert);
  return alert;
}

function generateRandomAlerts(sid) {
  const VENUE = stadiumVenues[sid];
  if (!VENUE) return;
  const alertTypes = [
    { type: 'warning', msg: `High crowd density detected near Gate C in ${VENUE.name}`, source: 'crowd' },
    { type: 'info', msg: `Weather update: Temperature 28°C, Clear sky at ${VENUE.name}`, source: 'system' },
    { type: 'warning', msg: `Restroom R2 occupancy at 90% in ${VENUE.name}`, source: 'system' },
    { type: 'danger', msg: `Medical assistance requested at Section E-14 in ${VENUE.name}`, source: 'safety' }
  ];

  if (Math.random() < 0.05) {
    const a = alertTypes[Math.floor(Math.random() * alertTypes.length)];
    addAlert(a.type, a.msg, a.source, sid);
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
        io.to(`stadium_${order.stadiumId}`).emit('order_update', order);
      }
    }
  });
}

// Main simulation loop (runs every 2 seconds)
function runSimulation() {
  Object.keys(stadiumStates).forEach(sid => {
    simulateCrowd(sid);
    simulateMatch(sid);
    generateRandomAlerts(sid);
    autoDispatchStaff(sid);
  });
  processOrders();
}

// Start periods
setInterval(runSimulation, 2000);
setInterval(runWorldAgent, 3000);

// ============================================================
// REST API ROUTES
// ============================================================

// Helper to get consistent stadium stats
function getStadiumStats(sid) {
  const VENUE = stadiumVenues[sid] || stadiumVenues['hyderabad_stadium'];
  const matchState = stadiumStates[sid] || stadiumStates['hyderabad_stadium'];
  return {
    name: VENUE.name,
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

app.get('/api/stadiums', (req, res) => {
  res.json({ success: true, data: STADIUMS_KNOWLEDGE_BASE });
});

// --- Venue State ---
app.get('/api/venue', (req, res) => {
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  res.json({
    success: true,
    data: getStadiumStats(sid)
  });
});
app.get('/api/match', (req, res) => {
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  res.json({
    success: true,
    data: stadiumStates[sid] || stadiumStates['hyderabad_stadium']
  });
});
app.post('/api/match/sync', (req, res) => {
  const { enabled, stadiumId } = req.body;
  const sid = stadiumId || 'hyderabad_stadium';
  if (stadiumStates[sid]) {
    stadiumStates[sid].worldSyncMode = enabled;
    if (enabled) applyRealitySync(); // trigger immediately
    io.to(`stadium_${sid}`).emit('match_update', stadiumStates[sid]);
    res.json({ success: true, enabled: stadiumStates[sid].worldSyncMode });
  } else {
    res.status(404).json({ success: false, message: 'Stadium not found' });
  }
});

app.post('/api/stadium/:id/venue', (req, res) => {
  const sid = req.params.id;
  if (stadiumVenues[sid]) {
    stadiumVenues[sid] = { ...stadiumVenues[sid], ...req.body };
    
    // IF stadium name changed, update the match state too for consistency
    if (req.body.name && stadiumStates[sid]) {
      stadiumStates[sid].stadiumName = req.body.name;
    }

    io.to(`stadium_${sid}`).emit('venue_update', stadiumVenues[sid]);
    res.json({ success: true, data: stadiumVenues[sid] });
  } else {
    res.status(404).json({ success: false, message: 'Stadium not found' });
  }
});

app.get('/api/venue/zones', (req, res) => {
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  res.json({ success: true, data: stadiumVenues[sid]?.zones || [] });
});

app.get('/api/venue/gates', (req, res) => {
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  res.json({ success: true, data: stadiumVenues[sid]?.gates || [] });
});

app.post('/api/venue/settings', (req, res) => {
  const sid = req.body.stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid];
  const { capacity } = req.body;
  if (VENUE && capacity && capacity > 0) {
    const ratio = capacity / VENUE.capacity;
    VENUE.capacity = capacity;
    VENUE.zones.forEach(z => {
      z.capacity = Math.floor(z.capacity * ratio);
    });
    addAlert('info', `[${VENUE.name}] Capacity updated to ${capacity.toLocaleString()}`, 'system', sid);
  }
  res.json({ success: true, data: getStadiumStats(sid) });
});

// --- Stadium Listing ---
app.get('/api/stadiums', (req, res) => {
  res.json({ success: true, data: STADIUMS_KNOWLEDGE_BASE });
});

// --- Match State ---
app.get('/api/match', (req, res) => {
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  const state = stadiumStates[sid] || stadiumStates['hyderabad_stadium'];
  res.json({ success: true, data: state });
});

app.post('/api/match/sync', (req, res) => {
  const { enabled, stadiumId } = req.body;
  const sid = stadiumId || 'hyderabad_stadium';
  const matchState = stadiumStates[sid];
  
  if (!matchState) return res.status(404).json({ success:false, error:'Stadium not found' });

  matchState.worldSyncMode = !!enabled;
  
  if (enabled && sid === 'hyderabad_stadium') {
    matchState.homeTeam = GOOGLE_REALITY_FEED.homeTeam;
    matchState.awayTeam = GOOGLE_REALITY_FEED.awayTeam;
    matchState.status = GOOGLE_REALITY_FEED.status;
  }

  addAlert(enabled ? 'success' : 'warning', `🌍 [${matchState.stadiumName}] Google AI Sync ${enabled ? 'CONNECTED' : 'DISCONNECTED'}`, 'match');
  io.to(`stadium_${sid}`).emit('match_update', matchState);
  res.json({ success: true, enabled: matchState.worldSyncMode });
});

app.post('/api/match/control', (req, res) => {
  const { action, stadiumId } = req.body;
  const sid = stadiumId || 'hyderabad_stadium';
  const matchState = stadiumStates[sid];
  if (!matchState) return res.status(404).json({ success:false });

  switch (action) {
    case 'start':
      matchState.status = 'first_half';
      if(matchState.minute === 0) matchState.minute = 1;
      addAlert('info', `Match started at ${matchState.stadiumName}`, 'match');
      break;
    case 'halftime':
      matchState.status = 'halftime';
      break;
    case 'second_half':
      matchState.status = 'second_half';
      break;
    case 'end':
      matchState.status = 'post_match';
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
  const { homeScore, awayScore, sport, stadiumId } = req.body;
  const sid = stadiumId || 'hyderabad_stadium';
  const matchState = stadiumStates[sid];
  if (!matchState) return res.status(404).json({ success:false });

  if (homeScore !== undefined) matchState.homeScore = parseInt(homeScore);
  if (awayScore !== undefined) matchState.awayScore = parseInt(awayScore);
  if (sport) matchState.sport = sport;

  const icon = sport === 'cricket' ? '🏏' : sport === 'basketball' ? '🏀' : sport === 'volleyball' ? '🏐' : '⚽';
  if (homeScore !== awayScore || homeScore > 0) {
    addAlert('success', `[${matchState.stadiumName}] ${icon} Score Update — ${matchState.homeTeam} ${matchState.homeScore} : ${matchState.awayScore} ${matchState.awayTeam}`, 'match');
  }
  io.to(`stadium_${sid}`).emit('match_update', matchState);
  res.json({ success: true, data: matchState });
});

// MATCH CONFIG — update team names, sport, stadium
app.post('/api/match/config', (req, res) => {
  const { teamA, teamB, sport, stadiumId } = req.body;
  const sid = stadiumId || 'hyderabad_stadium';
  const matchState = stadiumStates[sid];
  if (!matchState) return res.status(404).json({ success:false });

  if (teamA) matchState.homeTeam = teamA;
  if (teamB) matchState.awayTeam = teamB;
  if (sport) matchState.sport = sport;
  
  io.to(`stadium_${sid}`).emit('match_update', matchState);
  addAlert('info', `🏟️ [${matchState.stadiumName}] configured: ${matchState.homeTeam} vs ${matchState.awayTeam}`, 'system');
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
  
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid] || stadiumVenues['hyderabad_stadium'];
  
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
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid];
  res.json({ success: true, data: VENUE?.concessions || [] });
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
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid];
  if (!VENUE) return res.status(404).json({ success: false });

  const { to, gate } = req.query;
  const gates = VENUE.gates;
  const bestGate = [...gates].sort((a,b) => a.queue_length - b.queue_length)[0];

  const routes = [
    { path: [`Gate ${gate || bestGate.id}`, 'Main Concourse', 'Upper Deck', to || 'Seat Section'], distance: '150m', time: '4 min', congestion: 'low' },
    { path: [`Gate ${gate || bestGate.id}`, 'Side Tunnel', 'Lower Level', to || 'Seat Section'], distance: '180m', time: '6 min', congestion: 'medium' }
  ];
  
  res.json({ success: true, data: { 
    recommended: routes[0], 
    alternatives: routes.slice(1),
    lowCongestionGates: gates.filter(g => g.queue_length < 30).map(g => g.id)
  }});
});

// --- Alerts ---
app.get('/api/alerts', (req, res) => {
  const sid = req.query.stadiumId;
  const filtered = sid ? alerts.filter(a => a.stadiumId === sid || !a.stadiumId) : alerts;
  res.json({ success: true, data: filtered });
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
  const sid = req.query.stadiumId;
  const filtered = sid ? staff.filter(s => s.stadiumId === sid || !s.stadiumId) : staff;
  res.json({ success: true, data: filtered });
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
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid];
  const matchState = stadiumStates[sid];
  if (!VENUE || !matchState) return res.status(404).json({ success: false });

  const avgQueueTime = VENUE.concessions.reduce((s, c) => s + c.queue_time, 0) / VENUE.concessions.length;
  res.json({
    success: true,
    data: {
      ...analytics,
      currentAttendance: matchState.attendance,
      utilization: ((matchState.attendance / VENUE.capacity) * 100).toFixed(1),
      avgQueueTime: avgQueueTime.toFixed(1),
      activeAlerts: alerts.filter(a => (a.stadiumId === sid || !a.stadiumId) && !a.acknowledged).length,
      staffDeployed: staff.filter(s => s.status === 'dispatched' && (s.stadiumId === sid || !s.stadiumId)).length,
      staffAvailable: staff.filter(s => s.status === 'available' && (s.stadiumId === sid || !s.stadiumId)).length
    }
  });
});

app.get('/api/analytics/crowd-history', (req, res) => {
  res.json({ success: true, data: analytics.crowdHistory });
});

// --- Dynamic Signage ---
app.get('/api/signage', (req, res) => {
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid];
  if (!VENUE) return res.status(404).json({ success: false });

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
  const sid = req.query.stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid];
  const concession = VENUE?.concessions.find(c => c.zone === pending.zone && c.status === 'open')
                  || VENUE?.concessions.find(c => c.status === 'open');
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
  const { qrCode, stadiumId } = req.body;
  const sid = stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid];
  
  if (!qrCode) return res.status(400).json({ success: false, error: 'qrCode required' });
  const order = orders.find(o => o.qrCode === qrCode || o.id === qrCode);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found — invalid QR' });
  if (order.status === 'delivered') return res.json({ success: true, data: order, message: 'Already delivered' });
  if (order.status === 'preparing') return res.status(400).json({ success: false, error: 'Order still being prepared', data: order });

  order.status = 'delivered';
  syncOrder(order);
  if (VENUE) {
    const concession = VENUE.concessions.find(c => c.id === order.concessionId);
    if (concession) concession.orders_pending = Math.max(0, concession.orders_pending - 1);
  }
  io.to(`stadium_${sid}`).emit('order_update', order);
  res.json({ success: true, data: order, message: 'Order confirmed and delivered!' });
});

// ─── IMPROVED ROUTING ────────────────────────────────────────────────
app.get('/api/routing/optimal', (req, res) => {
  const { from, to, gate, stadiumId } = req.query;
  const sid = stadiumId || 'hyderabad_stadium';
  const VENUE = stadiumVenues[sid] || stadiumVenues['hyderabad_stadium'];

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
  socket.on('join_stadium', (sid) => {
    socket.join(`stadium_${sid}`);
    console.log(`Client ${socket.id} joined room: stadium_${sid}`);
    
    // Send current state for this specific stadium
    socket.emit('venue_update', stadiumVenues[sid] || stadiumVenues['hyderabad_stadium']);
    socket.emit('match_update', stadiumStates[sid] || stadiumStates['hyderabad_stadium']);
    socket.emit('alerts_init', alerts.filter(a => a.stadiumId === sid || !a.stadiumId));
  });

  socket.on('admin_score_update', (data) => {
    const sid = data.stadiumId || 'hyderabad_stadium';
    const matchState = stadiumStates[sid];
    if (!matchState) return;
    
    if (data.homeScore !== undefined) matchState.homeScore = parseInt(data.homeScore);
    if (data.awayScore !== undefined) matchState.awayScore = parseInt(data.awayScore);
    
    io.to(`stadium_${sid}`).emit('match_update', matchState);
    console.log(`[${sid}] Score updated via socket: ${matchState.homeScore} - ${matchState.awayScore}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    console.log(`\n🏟️  VenueAI Multi-Stadium Server running at http://localhost:${PORT}`);
  });
}

// ─── INITIALIZE AGENTS ──────────────────────────────────────────────
refreshDailySchedule(); // Select today's matches
applyRealitySync();     // Initial sync
setInterval(refreshDailySchedule, 3600000); // Check once an hour for date change
setInterval(applyRealitySync, 30000);      // Fetch Google Reality data every 30s
setInterval(() => {
  // Minor simulation updates for all stadiums
  Object.keys(stadiumStates).forEach(sid => {
    const s = stadiumStates[sid];
    if (s.status === 'first_half' || s.status === 'second_half') {
      // s.minute += Math.random() > 0.8 ? 1 : 0; // Handled by Reality Sync mostly
    }
    // Update crowd slightly
    s.attendance = Math.floor(Math.random() * 5000 + 45000);
    // Push updates
    io.to(`stadium_${sid}`).emit('match_update', s);
  });
}, 5000);

// Export for Vercel
module.exports = app;
