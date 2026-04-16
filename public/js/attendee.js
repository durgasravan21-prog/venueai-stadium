const socket = io();

// ── STATE ────────────────────────────────────────────────────
let currentStadiumId = localStorage.getItem('venue_stadium_id') || 'hyderabad_stadium';
let fullMenu = [];
let stadiumConcessions = [];
let myOrders = JSON.parse(localStorage.getItem('venue_orders') || '[]');
let myTickets = JSON.parse(localStorage.getItem('venue_tickets') || '[]');

// ── BOOT SEQUENCE ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(sessionStorage.getItem('venue_user'));
  if (user) {
    document.getElementById('userNameDisplay').textContent = user.name;
    // Auto-sync if stadium already selected (visible via class)
    if(document.body.classList.contains('show-app')) {
      syncWithStadium(currentStadiumId);
    }
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
        <div class="stadium-info"><h4>${s.name}</h4><p>${s.city}, ${s.country}</p><span class="stadium-tag">${s.sport.toUpperCase()}</span></div>
      </div>
    `).join('');
  } catch (err) { console.error("STADIUM_LOAD_FAIL", err); }
}
window.loadStadiums = loadStadiums;

function enterStadium(sid) {
  if (!sessionStorage.getItem('venue_user')) { location.reload(); return; }
  syncWithStadium(sid);
}
window.enterStadium = enterStadium;

async function syncWithStadium(sid) {
  currentStadiumId = sid;
  localStorage.setItem('venue_stadium_id', sid);
  document.body.classList.remove('show-selection');
  document.body.classList.add('show-app');
  document.getElementById('currentStadiumName').textContent = sid.replace('_', ' ').toUpperCase();
  
  socket.emit('join_stadium', sid);
  renderMatchSlots();
  loadInitialMatchState(sid);
  loadConcessions(sid);
}

async function loadConcessions(sid) {
  try {
    const res = await fetch(`/api/stadiums/${sid}`);
    const data = await res.json();
    if(data.success) stadiumConcessions = data.data.concessions || [];
  } catch (e) { console.warn("CONCESSION_LOAD_ERR", e); }
}

async function loadInitialMatchState(sid) {
  try {
    const res = await fetch(`/api/match?stadiumId=${sid}`);
    const data = await res.json();
    if(data.success && data.data) updateMatchUI(data.data);
  } catch (e) { console.warn("INIT_MATCH_ERR", e); }
}

// ── NAVIGATION (REAL WORLD PROPERTIES) ───────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = true; p.classList.remove('active'); });
  const target = document.getElementById(`tab-${tabId}`);
  if(target) { target.hidden = false; target.classList.add('active'); }
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
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
      <div class="slot-time">${s.time}</div><div class="slot-name">${s.name}</div><div class="slot-price">₹${s.price}</div>
    </div>
  `).join('');
}

function bookSlot(id, name) {
  const today = new Date().toLocaleDateString();
  const hasTicketToday = myTickets.some(t => t.date === today);
  if (hasTicketToday) { alert("⛔ DAILY LIMIT REACHED: You have already booked a ticket for today."); return; }
  const ticket = { id: 'TKT-' + Math.random().toString(36).substr(2, 6).toUpperCase(), name, type: 'ticket', status: 'valid', date: today, time: new Date().toLocaleTimeString() };
  myTickets.unshift(ticket);
  localStorage.setItem('venue_tickets', JSON.stringify(myTickets));
  showQR(ticket.id, name);
}
window.bookSlot = bookSlot;

function showQR(id, desc) {
  const modal = document.getElementById('qrModal');
  const img = document.getElementById('qrImg');
  const details = document.getElementById('qrDetails');
  // High Reliability QR Provider
  img.src = `https://quickchart.io/qr?text=${encodeURIComponent(id)}&size=300&light=ffffff&dark=000000`;
  details.textContent = `${desc} (${id})`;
  modal.style.display = 'flex';
}
window.showQR = showQR;

// ── FOOD COURT ───────────────────────────────────────────────
async function renderMenu(category = 'all') {
  const grid = document.getElementById('menuGrid');
  if(!grid) return;
  if (!fullMenu.length) {
    const res = await fetch('/api/food/menu');
    const data = await res.json();
    fullMenu = data.data || [];
  }
  const filtered = category === 'all' ? fullMenu : fullMenu.filter(i => i.type === category);
  grid.innerHTML = filtered.map(item => `
    <div class="menu-card">
      <div class="menu-thumb">${item.type === 'beverage' ? '🥤' : '🍔'}</div>
      <div class="menu-details"><h5>${item.name}</h5><span class="price">₹${item.price}</span><p class="prep-time">${item.prepTime} min prep</p></div>
      <button class="add-btn" onclick="addToOrder('${item.id}')">+</button>
    </div>
  `).join('');
}

window.filterMenu = (cat, el) => {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderMenu(cat);
};

async function addToOrder(itemId) {
  const item = fullMenu.find(i => i.id === itemId);
  if(!item) return;

  // Real-world sync: Link to the current stadium's active concession
  const activeConcession = stadiumConcessions.find(c => c.status === 'open') || stadiumConcessions[0];

  try {
    const payload = {
      stadiumId: currentStadiumId,
      items: [{ id: itemId, qty: 1 }],
      concessionId: activeConcession ? activeConcession.id : null,
      zone: activeConcession ? activeConcession.zone : 'General',
      seat: 'G-12'
    };
    const res = await fetch('/api/food/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.success) {
      const order = { ...item, ...data.data, timestamp: new Date().toLocaleTimeString() };
      myOrders.unshift(order);
      localStorage.setItem('venue_orders', JSON.stringify(myOrders));
      alert(`✅ Order Synthesized! Staff are preparing ${item.name}.`);
    } else { alert(`❌ Order Error: ${data.error}`); }
  } catch (err) { alert("❌ System offline. Ordering failed."); }
}
window.addToOrder = addToOrder;

// ── ORDERS ───────────────────────────────────────────────────
function renderOrders() {
  const ticketList = document.getElementById('ticketList');
  const foodList = document.getElementById('orderList');
  if(ticketList) ticketList.innerHTML = myTickets.map(t => `
    <div class="order-card" onclick="showQR('${t.id}', '${t.name}')">
      <div class="order-icon">🎟️</div><div class="order-info"><h5>${t.name}</h5><span>${t.id} · ${t.time}</span></div><div class="qr-trigger">QR</div>
    </div>
  `).join('') || '<div class="empty">No tickets.</div>';
  if(foodList) foodList.innerHTML = myOrders.map(o => `
    <div class="order-card">
      <div class="order-icon">${o.type === 'beverage' ? '🥤' : '🍔'}</div>
      <div class="order-info"><h5>${o.name}</h5><span>${(o.status || 'preparing').toUpperCase()} · ₹${o.totalPrice || o.price}</span></div>
      <div class="status-dot ${(o.status || 'preparing')}"></div>
    </div>
  `).join('') || '<div class="empty">No food orders.</div>';
}

// ── SOCKET HANDLERS ──────────────────────────────────────────
socket.on('match_update', data => updateMatchUI(data));
socket.on('order_update', order => {
  const idx = myOrders.findIndex(o => o.id === order.id);
  if (idx !== -1) {
    myOrders[idx].status = order.status;
    localStorage.setItem('venue_orders', JSON.stringify(myOrders));
    if(!document.getElementById('tab-orders').hidden) renderOrders();
  }
});

function updateMatchUI(data) {
  if(!data) return;
  const hN = document.getElementById('homeName'); if(hN) hN.textContent = data.homeTeam;
  const aN = document.getElementById('awayName'); if(aN) aN.textContent = data.awayTeam;
  const hS = document.getElementById('homeScore'); if(hS) hS.textContent = data.homeScore;
  const aS = document.getElementById('awayScore'); if(aS) aS.textContent = data.awayScore;
}
