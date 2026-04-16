/**
 * VenueAI — Official Smart Stadium Logic
 * Version 2.3 - Production Stable
 */

let socket;
let currentTab = 'venue';
let activeStadiums = [];
let currentStadiumId = null;
let fullMenu = [];
let myOrders = JSON.parse(localStorage.getItem('venue_orders') || '[]');

try {
  socket = io();
} catch(e) {
  console.warn("Reality engine in polling fallback mode.");
  socket = { on: () => {}, emit: () => {}, io: { engine: { transport: { name: 'fallback' } } } };
}

// ── BOOT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  console.log("🚀 Reality Engine Cold Booted. Awaiting Auth Shield...");
  
  // Clean initialization - visibility is handled by index.html auth guard
  const user = sessionStorage.getItem('venue_user');
  if (user) {
    const data = JSON.parse(user);
    const display = document.getElementById('userNameDisplay');
    if (display) display.textContent = data.name.split(' ')[0];
  }
});

// ── NAVIGATION (Fixed Recursion) ─────────────────────────────
function switchTab(id) {
  if (id === currentTab) return;
  console.log(`🚀 Switching to: ${id}`);

  // 1. Hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.remove('active');
    p.setAttribute('hidden', '');
  });

  // 2. Deactivate all buttons
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.remove('active');
  });

  // 3. Activate Target
  const targetPanel = document.getElementById(`tab-${id}`);
  const targetBtn = document.querySelector(`[data-tab="${id}"]`);

  if (targetPanel) {
    targetPanel.classList.add('active');
    targetPanel.removeAttribute('hidden');
  } else {
    console.error(`Missing Panel: tab-${id}`);
  }

  if (targetBtn) {
    targetBtn.classList.add('active');
  }

  currentTab = id;

  // Contextual Loads
  if (id === 'food') renderMenu();
  if (id === 'orders') renderOrders();
}
window.switchTab = switchTab; // Ensure global availability

// ── AUTH & SELECTION ─────────────────────────────────────────
async function loadStadiums() {
  const grid = document.getElementById('stadiumGrid');
  if (!grid) return;
  
  try {
    const res = await fetch('/api/stadiums');
    const result = await res.json();
    if (result.success) {
      activeStadiums = result.data;
      grid.innerHTML = activeStadiums.map(s => `
        <div class="stadium-card" onclick="enterStadium('${s.id}')">
          <div class="stadium-card-image">🏟️</div>
          <div class="stadium-card-info">
            <h4>${s.name}</h4>
            <p>${s.city}, ${s.country}</p>
            <span class="sport-tag">${s.sport.toUpperCase()}</span>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    grid.innerHTML = '<div class="error">Connectivity Error. Refreshing...</div>';
  }
}
window.loadStadiums = loadStadiums;

function enterStadium(sid) {
  // 🛡️ AUTH SHIELD
  if (!sessionStorage.getItem('venue_user')) {
    console.warn("⛔ ACCESS DENIED: Unauthenticated entry attempt blocked.");
    location.reload(); 
    return;
  }

  console.log(`🏟️ Syncing with Stadium: ${sid}`);
  currentStadiumId = sid;
  localStorage.setItem('venue_stadium_id', sid);
  
  // 🔓 STRICT REVEAL
  document.body.classList.remove('show-selection');
  document.body.classList.add('show-app');

  // Join Socket Room
  socket.emit('join_stadium', sid);
  
  // Initial Loads
  fetch(`/api/stadium/${sid}`).then(r => r.json()).then(res => {
     if(res.success) {
       document.getElementById('currentStadiumName').textContent = res.data.stadiumName;
       updateMatchUI(res.data);
     }
  });
  
  renderSlots();
}
window.enterStadium = enterStadium;

// ── VENUE: ENTRY SLOTS (Req: Book Ticket) ───────────────────
function renderSlots() {
  const grid = document.getElementById('slotsGrid');
  if(!grid) return;

  const times = ["18:00", "18:30", "19:00", "19:30", "20:00"];
  grid.innerHTML = times.map(t => `
    <div class="slot-card" onclick="bookSlot('${t}')">
      <div class="time">${t}</div>
      <div class="label">Entry A</div>
    </div>
  `).join('');
}

function bookSlot(time) {
  alert(`🎟️ Booking Confirmed: ${time} Gate A\nYour digital pass is now in Orders tab.`);
  const ticket = { id: 'TKT-' + Math.random().toString(36).substr(2,5), name: 'Match Entry', price: 0, status: 'Active', type: 'ticket', time };
  myOrders.unshift(ticket);
  localStorage.setItem('venue_orders', JSON.stringify(myOrders));
}
window.bookSlot = bookSlot;

// ── FOOD COURT ───────────────────────────────────────────────
async function renderMenu() {
  const grid = document.getElementById('menuGrid');
  if(!grid) return;

  if (fullMenu.length === 0) {
    const res = await fetch('/api/menu');
    const data = await res.json();
    fullMenu = data.data || [];
  }

  grid.innerHTML = fullMenu.map(item => `
    <div class="menu-card">
      <div class="menu-thumb">${item.type === 'beverage' ? '🥤' : '🍔'}</div>
      <div class="menu-details">
        <h5>${item.name}</h5>
        <span class="price">₹${item.price}</span>
      </div>
      <button class="add-btn" onclick="addToCart('${item.id}')">+</button>
    </div>
  `).join('');
}

function addToCart(id) {
  const item = fullMenu.find(i => i.id === id);
  if(!item) return;

  const order = { ...item, id: 'ORD-' + Date.now(), status: 'preparing', timestamp: new Date().toLocaleTimeString() };
  myOrders.unshift(order);
  localStorage.setItem('venue_orders', JSON.stringify(myOrders));
  alert(`✅ Added ${item.name} to Orders!`);
}
window.addToCart = addToCart;

// ── ORDERS ───────────────────────────────────────────────────
function renderOrders() {
  const list = document.getElementById('orderList');
  if(!list) return;

  if (myOrders.length === 0) {
    list.innerHTML = '<div class="empty">No active orders yet.</div>';
    return;
  }

  list.innerHTML = myOrders.map(o => `
    <div class="order-card">
      <div class="order-icon">${o.type === 'ticket' ? '🎟️' : '🍕'}</div>
      <div class="order-info">
        <h5>${o.name}</h5>
        <span>${o.status.toUpperCase()} · ${o.time || o.timestamp}</span>
      </div>
    </div>
  `).join('');
}

// ── SOCKET HANDLERS ──────────────────────────────────────────
socket.on('match_update', data => updateMatchUI(data));

function updateMatchUI(data) {
  document.getElementById('homeName').textContent = data.homeTeam;
  document.getElementById('awayName').textContent = data.awayTeam;
  document.getElementById('homeScore').textContent = data.homeScore;
  document.getElementById('awayScore').textContent = data.awayScore;
  document.getElementById('matchStatus').textContent = data.status.replace('_', ' ').toUpperCase();
  document.getElementById('matchClock').textContent = data.minute + "'";
}
