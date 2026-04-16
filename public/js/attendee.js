const socket = io();

// ── STATE ────────────────────────────────────────────────────
let currentStadiumId = null;
let fullMenu = [];
let myOrders = JSON.parse(localStorage.getItem('venue_orders') || '[]');
let myTickets = JSON.parse(localStorage.getItem('venue_tickets') || '[]');

// ── BOOT SEQUENCE ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(sessionStorage.getItem('venue_user'));
  if (user) {
    document.getElementById('userNameDisplay').textContent = user.name;
  }
});

// ── STADIUM SELECTOR ────────────────────────────────────────
async function loadStadiums() {
  const grid = document.getElementById('stadiumGrid');
  if(!grid) return;
  
  try {
    const res = await fetch('/api/stadiums');
    const data = await res.json();
    const stadiums = data.data || [];

    grid.innerHTML = stadiums.map(s => `
      <div class="stadium-card" onclick="enterStadium('${s.id}')">
        <div class="stadium-icon">🏟️</div>
        <div class="stadium-info">
          <h4>${s.name}</h4>
          <p>${s.city}, ${s.country}</p>
          <span class="stadium-tag">${s.sport.toUpperCase()}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error("STADIUM_LOAD_FAIL", err);
  }
}
window.loadStadiums = loadStadiums;

function enterStadium(sid) {
  if (!sessionStorage.getItem('venue_user')) { location.reload(); return; }
  currentStadiumId = sid;
  localStorage.setItem('venue_stadium_id', sid);
  document.body.classList.remove('show-selection');
  document.body.classList.add('show-app');
  socket.emit('join_stadium', sid);
  renderMatchSlots();
}
window.enterStadium = enterStadium;

// ── NAVIGATION ───────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = true);
  document.getElementById(`tab-${tabId}`).hidden = false;
  
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  if(tabId === 'food') renderMenu();
  if(tabId === 'orders') renderOrders();
}
window.switchTab = switchTab;

// ── VENUE & SLOTS ───────────────────────────────────────────
function renderMatchSlots() {
  const grid = document.getElementById('slotsGrid');
  if(!grid) return;

  const slots = [
    { id: 'S1', name: 'West Block - Gate 4', price: 1200, time: '19:00 ENTRY' },
    { id: 'S2', name: 'East Stand - Gate 2', price: 900, time: '19:15 ENTRY' },
    { id: 'S3', name: 'VIP Lounge - Gate 1', price: 4500, time: 'ANYTIME' }
  ];

  grid.innerHTML = slots.map(s => `
    <div class="slot-card" onclick="bookSlot('${s.id}', '${s.name}')">
      <div class="slot-time">${s.time}</div>
      <div class="slot-name">${s.name}</div>
      <div class="slot-price">₹${s.price}</div>
    </div>
  `).join('');
}

function bookSlot(id, name) {
  const ticket = {
    id: 'TKT-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
    name: name,
    type: 'ticket',
    status: 'valid',
    time: new Date().toLocaleTimeString()
  };
  
  myTickets.unshift(ticket);
  localStorage.setItem('venue_tickets', JSON.stringify(myTickets));
  
  // Show QR Instantly
  showQR(ticket.id, name);
}
window.bookSlot = bookSlot;

function showQR(id, desc) {
  const modal = document.getElementById('qrModal');
  const img = document.getElementById('qrImg');
  const details = document.getElementById('qrDetails');
  
  // Generate a mock QR (Real URL in production)
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${id}`;
  details.textContent = `${desc} (${id})`;
  modal.style.display = 'flex';
}
window.showQR = showQR;

// ── FOOD COURT ───────────────────────────────────────────────
async function renderMenu(category = 'all') {
  const grid = document.getElementById('menuGrid');
  if(!grid) return;

  if (fullMenu.length === 0) {
    const res = await fetch('/api/food/menu');
    const data = await res.json();
    fullMenu = data.data || [];
  }

  const filtered = category === 'all' ? fullMenu : fullMenu.filter(i => i.type === category);

  grid.innerHTML = filtered.map(item => `
    <div class="menu-card">
      <div class="menu-thumb">${item.type === 'beverage' ? '🥤' : '🍔'}</div>
      <div class="menu-details">
        <h5>${item.name}</h5>
        <span class="price">₹${item.price}</span>
      </div>
      <button class="add-btn" onclick="addToCart('${item.id}')">+</button>
    </div>
  `).join('') || '<div class="empty">No items found in this section.</div>';
}

window.filterMenu = (cat, el) => {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderMenu(cat);
};

function addToCart(id) {
  const item = fullMenu.find(i => i.id === id);
  if(!item) return;

  const order = { ...item, id: 'ORD-' + Date.now(), status: 'preparing', timestamp: new Date().toLocaleTimeString() };
  myOrders.unshift(order);
  localStorage.setItem('venue_orders', JSON.stringify(myOrders));
  alert(`✅ Order Placed for ${item.name}! Check 'Orders' tab.`);
}
window.addToCart = addToCart;

// ── ORDERS ───────────────────────────────────────────────────
function renderOrders() {
  const ticketList = document.getElementById('ticketList');
  const foodList = document.getElementById('orderList');
  
  // 🎟️ Render Tickets
  if(ticketList) {
    ticketList.innerHTML = myTickets.map(t => `
      <div class="order-card" onclick="showQR('${t.id}', '${t.name}')">
        <div class="order-icon">🎟️</div>
        <div class="order-info">
          <h5>${t.name}</h5>
          <span>${t.id} · ${t.time}</span>
        </div>
        <div class="qr-trigger">QR</div>
      </div>
    `).join('') || '<div class="empty">No tickets booked.</div>';
  }

  // 🍔 Render Food
  if(foodList) {
    foodList.innerHTML = myOrders.map(o => `
      <div class="order-card">
        <div class="order-icon">${o.type === 'beverage' ? '🥤' : '🍔'}</div>
        <div class="order-info">
          <h5>${o.name}</h5>
          <span>${o.status.toUpperCase()} · ${o.timestamp}</span>
        </div>
      </div>
    `).join('') || '<div class="empty">No food orders.</div>';
  }
}

// ── SOCKET HANDLERS ──────────────────────────────────────────
socket.on('match_update', data => {
  if (data) {
    const hn = document.getElementById('homeName');
    if(hn) hn.textContent = data.homeTeam;
    const an = document.getElementById('awayName');
    if(an) an.textContent = data.awayTeam;
    const hs = document.getElementById('homeScore');
    if(hs) hs.textContent = data.homeScore;
    const as = document.getElementById('awayScore');
    if(as) as.textContent = data.awayScore;
  }
});
