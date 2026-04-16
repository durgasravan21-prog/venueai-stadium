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
  updateAllMaps(sid);
}

async function loadConcessions(sid) {
  try {
    const res = await fetch(`/api/venue?stadiumId=${sid}`);
    const data = await res.json();
    if(data.success) stadiumConcessions = data.data.concessions || [];
  } catch (e) { console.warn("CONCESSION_LOAD_ERR", e); }
}

function updateAllMaps(sid) {
  const mainMap = document.getElementById('tab-nav');
  const miniMap = document.getElementById('venueMiniMap');
  
  // REAL WORLD 360° PHOTOSPHERE VIEWS
  const MAP_EMBEDS = {
    'hyderabad_stadium': 'https://www.google.com/maps/embed?pb=!4v1713271200000!6m8!1m7!1sCAoSLEFGMVFpcE5qUnVfbGZkX19fX19fX19fX19fX19fX19fX19fX19fX19fX19fX18!2m2!1d17.4062!2d78.5484!3f0!4f0!5f0.7820865974627469',
    'eden_gardens': 'https://www.google.com/maps/embed?pb=!4v1713271200000!6m8!1m7!1sCAoSLEFGMVFpcE5yX09xLWxVNV9fX19fX19fX19fX19fX19fX19fX19fX19fX19fX18!2m2!1d22.5646!2d88.3433!3f0!4f0!5f0.7820865974627469',
    'ahmedabad_stadium': 'https://www.google.com/maps/embed?pb=!4v1713271200000!6m8!1m7!1sCAoSLEFGMVFpcFBCeG5mZnZfX19fX19fX19fX19fX19fX19fX19fX19fX19fX1_!2m2!1d23.0911!2d72.5922!3f0!4f0!5f0.7820865974627469'
  };

  const url = MAP_EMBEDS[sid] || MAP_EMBEDS['hyderabad_stadium'];

  if (mainMap) {
    mainMap.innerHTML = `
      <div class="interactive-map" style="height: 60vh;">
         <iframe src="${url}" width="100%" height="100%" style="border:0;" allowfullscreen="" loading="lazy"></iframe>
         <div class="map-overlay">
            <div class="map-chip">REAL-WORLD 360° VIEW</div>
            <div class="map-chip">LIVE ARENA</div>
         </div>
      </div>
      <div class="nav-controls">
         <button class="action-btn" onclick="alert('Navigating to Nearest Restroom...')">🚻 Nearest Restroom</button>
         <button class="action-btn" onclick="alert('Navigating to Food Court...')">🍔 Food Court</button>
      </div>
    `;
  }

  if (miniMap) {
    miniMap.innerHTML = `<iframe src="${url}" width="100%" height="100%" style="border:0; opacity:0.8; pointer-events: none;" allowfullscreen="" loading="lazy"></iframe>`;
  }
}

// ── PAYMENT SYSTEM ──────────────────────────────────────────
async function processPayment(items, zone = 'General', seat = 'G-12') {
  try {
    const res = await fetch('/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, zone, seat })
    });
    const { data } = await res.json();
    
    return new Promise((resolve) => {
      const handler = async (response) => {
        const verifyRes = await fetch(`/api/payment/verify?stadiumId=${currentStadiumId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pendingRef: data.pendingRef,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            demoSuccess: data.demoMode
          })
        });
        const verifyData = await verifyRes.json();
        resolve(verifyData);
      };

      if (data.demoMode) {
        if (confirm(`💳 DEMO PAYMENT GATEWAY\n\nOrder Total: ₹${data.total}\nItems: ${data.items.map(i=>i.name).join(', ')}\n\nClick OK to simulate successful payment.`)) {
           handler({ razorpay_order_id: data.rzpOrderId, razorpay_payment_id: 'pay_DEMO_'+Date.now(), razorpay_signature: 'demo' });
        } else {
           resolve({ success: false, error: 'Payment Cancelled' });
        }
      } else {
        const options = {
          key: data.rzpKeyId,
          amount: data.total * 100, currency: "INR",
          name: "VenueAI Stadium", description: data.items.map(i => i.name).join(', '),
          order_id: data.rzpOrderId, handler: handler,
          modal: { ondismiss: () => resolve({ success: false, error: 'Payment Cancelled' }) },
          theme: { color: "#f5e6c8" }
        };
        const rzp = new Razorpay(options);
        rzp.open();
      }
    });
  } catch (err) { return { success: false, error: 'Payment Initialization Failed' }; }
}

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

async function bookSlot(id, name) {
  const today = new Date().toLocaleDateString();
  const hasTicketToday = myTickets.some(t => t.date === today);
  if (hasTicketToday) { alert("⛔ DAILY LIMIT REACHED: You only book once per day."); return; }

  const result = await processPayment([{ id, qty: 1 }]);
  if (result.success) {
    const ticket = { id: 'TKT-' + Math.random().toString(36).substr(2, 6).toUpperCase(), name, type: 'ticket', status: 'valid', date: today, time: new Date().toLocaleTimeString() };
    myTickets.unshift(ticket);
    localStorage.setItem('venue_tickets', JSON.stringify(myTickets));
    showQR(ticket.id, name);
  } else { alert(`❌ ${result.error}`); }
}
window.bookSlot = bookSlot;

function showQR(id, desc) {
  const modal = document.getElementById('qrModal');
  const img = document.getElementById('qrImg');
  const details = document.getElementById('qrDetails');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(id)}`;
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

async function addToOrder(itemId) {
  const item = fullMenu.find(i => i.id === itemId);
  if(!item) return;
  const activeConcession = stadiumConcessions.find(c => c.status === 'open') || stadiumConcessions[0];
  const result = await processPayment([{ id: itemId, qty: 1 }], activeConcession?.zone, 'G-12');
  if (result.success) {
    const order = { ...item, ...result.data, timestamp: new Date().toLocaleTimeString() };
    myOrders.unshift(order);
    localStorage.setItem('venue_orders', JSON.stringify(myOrders));
    alert(`✅ Order Created! Staff are preparing ${item.name}.`);
  } else { alert(`❌ ${result.error}`); }
}
window.addToOrder = addToOrder;

// ── SHARED ──────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = true; p.classList.remove('active'); });
  const target = document.getElementById(`tab-${tabId}`);
  if(target) { target.hidden = false; target.classList.add('active'); }
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  if(tabId === 'food') renderMenu();
  if(tabId === 'orders') renderOrders();
  window.scrollTo(0,0);
}
window.switchTab = switchTab;

function renderOrders() {
  const tL = document.getElementById('ticketList');
  const fL = document.getElementById('orderList');
  if(tL) tL.innerHTML = myTickets.map(t => `<div class="order-card" onclick="showQR('${t.id}', '${t.name}')"><div class="order-icon">🎟️</div><div class="order-info"><h5>${t.name}</h5><span>${t.id} · ${t.time}</span></div><div class="qr-trigger">QR</div></div>`).join('') || '<div class="empty">No tickets.</div>';
  if(fL) fL.innerHTML = myOrders.map(o => `<div class="order-card"><div class="order-icon">${o.category === 'beverage' ? '🥤' : '🍔'}</div><div class="order-info"><h5>${o.name}</h5><span>${(o.status || 'preparing').toUpperCase()} · ₹${o.totalPrice || o.price}</span></div><div class="status-dot ${(o.status || 'preparing')}"></div></div>`).join('') || '<div class="empty">No food orders.</div>';
}

socket.on('match_update', data => {
  const hN = document.getElementById('homeName'); if(hN) hN.textContent = data.homeTeam;
  const aN = document.getElementById('awayName'); if(aN) aN.textContent = data.awayTeam;
  const hS = document.getElementById('homeScore'); if(hS) hS.textContent = data.homeScore;
  const aS = document.getElementById('awayScore'); if(aS) aS.textContent = data.awayScore;
});

async function loadInitialMatchState(sid) {
  try {
    const res = await fetch(`/api/match?stadiumId=${sid}`);
    const data = await res.json();
    if(data.success && data.data) {
      const hN = document.getElementById('homeName'); if(hN) hN.textContent = data.data.homeTeam;
      const aN = document.getElementById('awayName'); if(aN) aN.textContent = data.data.awayTeam;
      const hS = document.getElementById('homeScore'); if(hS) hS.textContent = data.data.homeScore;
      const aS = document.getElementById('awayScore'); if(aS) aS.textContent = data.data.awayScore;
    }
  } catch (e) {}
}
