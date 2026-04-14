/**
 * VenueAI Attendee App — Full Client JS
 * Fixed: slot booking, food ordering (demo mode), match score sync,
 *        navigation routing, CCTV animation, real-time socket updates
 */

const socket = io();

let currentTab  = 'venue';
let myOrders    = [];
let cart        = [];
let fullMenu    = [];
let venueState  = null;
let isCartOpen  = false;

let currentStadiumId = localStorage.getItem('venue_stadium_id');
let activeStadiums   = [];

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (currentStadiumId) {
    enterStadium(currentStadiumId);
  } else {
    loadStadiums();
  }
  
  fetchMenu();
  fetchSlots();
  restoreBooking();
  restoreOrders();
  setInterval(tickETAs, 1000);
  setInterval(animateBboxes, 1800);
  fetchWeather();
});

async function loadStadiums() {
  try {
    const res = await fetch('/api/stadiums');
    const data = await res.json();
    if (data.success) {
      activeStadiums = data.data;
      renderStadiumList();
    }
  } catch (e) {
    console.error("Failed to load stadiums knowledge base.");
  }
}

function renderStadiumList() {
  const grid = document.getElementById('stadiumGrid');
  if (!grid) return;
  grid.innerHTML = activeStadiums.map(s => `
    <div class="stadium-card" onclick="enterStadium('${s.id}')">
      <h4>${s.name}</h4>
      <p>${s.city}, ${s.country}</p>
      <div style="font-size:0.6rem; margin-top:5px; color:var(--amber)">${s.sport.toUpperCase()}</div>
    </div>
  `).join('');
}

function selectStadiumById() {
  const sid = document.getElementById('customStadiumId').value.trim();
  if (sid) enterStadium(sid);
}

function enterStadium(sid) {
  currentStadiumId = sid;
  localStorage.setItem('venue_stadium_id', sid);
  
  // Join Room
  socket.emit('join_stadium', sid);
  
  // UI Transition
  const overlay = document.getElementById('stadiumOverlay');
  if (overlay) overlay.style.display = 'none';
  const hero = document.getElementById('mainHero');
  if (hero) hero.style.display = 'block';
  
  fetchMatch();
}

// ── Restore from localStorage ─────────────────────────────────
function restoreBooking() {
  const b = localStorage.getItem('venue_booking');
  if (b) showTicket(JSON.parse(b));
}
function restoreOrders() {
  const o = localStorage.getItem('my_orders');
  if (o) { myOrders = JSON.parse(o); renderMyOrders(); }
}
function saveOrders() { localStorage.setItem('my_orders', JSON.stringify(myOrders)); }

// ── Countdown on orders ───────────────────────────────────────
function tickETAs() {
  let changed = false;
  myOrders.forEach(o => {
    if (o.status === 'preparing' && o.remainingTime > 0) { o.remainingTime--; changed = true; }
  });
  if (changed) renderMyOrders();
}

// ── Socket events ─────────────────────────────────────────────
socket.on('venue_update', data => {
  venueState = data;
  const att = data.totalAttendance.toLocaleString('en-IN');
  setText('liveAttendance', att);
  const avgWait = (data.concessions.reduce((a,c) => a + c.queue_time, 0) / data.concessions.length).toFixed(1);
  setText('liveWait', avgWait + ' min');
  const best = [...data.gates].sort((a,b) => a.queue_length - b.queue_length)[0];
  if (best) setText('bestGate', 'Gate ' + best.id);
  renderZoneCards(data);
  renderGateStatus(data.gates);
});

// ─── Fetch Match State ────────────────────────────────────────
async function fetchMatch() {
  try {
    const res = await fetch(`/api/match?stadiumId=${currentStadiumId || 'hyderabad_stadium'}`);
    const data = await res.json();
    if (data.success) updateMatchUI(data.data);
  } catch (e) { console.error('Match fetch failed'); }
}

// ─── Socket: Match Update ──────────────────────────────────────────────
socket.on('match_update', data => {
  updateMatchUI(data);
});

const STADIUM_MAP = {
  metastadium: 'MetaStadium Arena',
  eden: 'Eden Gardens',
  wankhede: 'Wankhede Stadium',
  chepauk: 'Chepauk Stadium',
  chinnaswamy: 'Chinnaswamy Stadium',
  saltlake: 'Salt Lake Stadium',
  jawaharlal: 'Jawaharlal Nehru Stadium',
  indira: 'Indira Gandhi Arena',
  smc: 'SMC Indoor Complex',
  hyderabad_stadium: 'Rajiv Gandhi Intl Stadium',
};

function showStadiumSelector() {
  const overlay = document.getElementById('stadiumOverlay');
  if (overlay) overlay.style.display = 'flex';
  loadStadiums();
}

function updateMatchUI(data) {
  // Score Update
  setText('homeScore', data.homeScore);
  setText('awayScore', data.awayScore);
  
  // Wickets Update (Special for Cricket)
  const homeW = document.getElementById('homeWickets');
  const homeWrap = document.getElementById('homeWicketsWrap');
  const awayW = document.getElementById('awayWickets');
  const awayWrap = document.getElementById('awayWicketsWrap');

  if (data.sport === 'cricket') {
    if (homeW) homeW.innerText = data.homeWickets || 0;
    if (awayW) awayW.innerText = data.awayWickets || 0;
    if (homeWrap) homeWrap.style.display = 'inline';
    if (awayWrap) awayWrap.style.display = 'inline';
  } else {
    if (homeWrap) homeWrap.style.display = 'none';
    if (awayWrap) awayWrap.style.display = 'none';
  }

  setText('matchStatus', data.status.replace(/_/g,' ').toUpperCase());
  setText('matchMinute', data.minute > 0 ? data.minute + "'" : '');

  // Target Update
  const targetEl = document.getElementById('targetScore');
  if (targetEl) {
    if (data.target > 0) {
      targetEl.innerText = `Target: ${data.target}`;
      targetEl.style.display = 'block';
    } else {
      targetEl.style.display = 'none';
    }
  }

  // Sport-specific Icons and Real-world Role Assignment
  const sportIcons = { cricket:'🏏', football:'⚽', basketball:'🏀', volleyball:'🏐', kabaddi:'⛹️', hockey:'🏑' };
  let iconA = sportIcons[data.sport] || '🏟️';
  let iconB = iconA;

  // Custom roles for Cricket (Batting vs Bowling swap)
  if (data.sport === 'cricket') {
    if (data.battingTeam === 'home') {
      iconA = '🏏'; 
      iconB = '⚾'; 
    } else {
      iconA = '⚾'; 
      iconB = '🏏'; 
    }
  }

  if (data.homeTeam) setText('heroTeamA', data.homeTeam);
  if (data.awayTeam) setText('heroTeamB', data.awayTeam);
  setText('heroIconA', iconA);
  setText('heroIconB', iconB);

  // Reality Sync Status (AI Agent connection simulation)
  const syncMsgs = [
    `📡 Reality Sync: Active (${data.sport?.toUpperCase()} API)`,
    `🤖 AI Agent: Analyzing ${data.homeTeam} performance...`,
    `🌍 Cloud Sync: Connected to Global Sports Feed`,
    `🌡️ Weather: ${data.weather?.temp}°C | Humidity: ${data.weather?.humidity}%`
  ];
  const msg = syncMsgs[Math.floor(Math.random() * syncMsgs.length)];
  const statusEl = document.getElementById('aiSyncText');
  if (statusEl) statusEl.innerText = msg;

  if (data.weather) {
    const weatherEl = document.getElementById('heroWeather');
    if (weatherEl) weatherEl.innerText = `${data.weather.temp}°C | ${data.weather.condition}`;
  }

  // Force Update Stadium Name (PRIORITIZE data.stadiumName or Mapping)
  const stName = data.stadiumName || STADIUM_MAP[data.stadium] || 'Rajiv Gandhi Intl Stadium';
  const titleEl = document.getElementById('heroTitle');
  if (titleEl) {
    const words = stName.split(' ');
    if (words.length > 1) {
       const last = words.pop();
       titleEl.innerHTML = `${words.join(' ')} <span class="gradient-text">${last}</span>`;
    } else {
       titleEl.innerHTML = stName;
    }
  }

  // Goal toast
  if (data.events && data.events.length) {
    const last = data.events[data.events.length - 1];
    if (last && (last.type === 'goal' || last.type === 'alert')) {
       showToast(`${last.msg || (last.team + ' scored!')}`, 'success');
    }
  }
}

socket.on('alert', alert => {
  if (alert.type === 'danger') showToast(alert.message, 'danger');
  appendAlert(alert);
});

socket.on('order_update', updated => {
  const o = myOrders.find(x => x.id === updated.id);
  if (o) {
    Object.assign(o, updated);
    renderMyOrders(); saveOrders();
    if (updated.status === 'ready')     showToast(`✅ ${updated.id} ready for pickup!`, 'success');
    if (updated.status === 'delivered') showToast(`📦 ${updated.id} delivered!`, 'info');
  }
});

socket.on('menu_update', updated => { fullMenu = updated; renderMenu(); });

// ── Tab nav ───────────────────────────────────────────────────
function switchTab(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(`tab-${id}`);
  const btn   = document.querySelector(`[data-tab="${id}"]`);
  if (panel) panel.classList.add('active');
  if (btn)   btn.classList.add('active');
  currentTab = id;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── UI Updates ────────────────────────────────────────────────
function updateVenueUI(data) {
  if (data.infrastructure) {
    renderZoneCards(data.infrastructure);
    renderGateStatus(data.infrastructure.gates);
    renderCCTVs(data.infrastructure.cctv);
  }
}

function renderCCTVs(cctvs) {
  const grid = document.getElementById('cctvGrid');
  if (!grid || !cctvs) return;
  grid.innerHTML = cctvs.map(cam => `
    <div class="ai-cctv-card">
      <div class="ai-cctv-video">
        <img src="${cam.feed}" style="width:100%;height:100%;object-fit:cover;opacity:0.8">
        <div class="ai-bbox" style="top:${20 + Math.random()*40}%;left:${10 + Math.random()*60}%"></div>
        <div class="ai-overlay-badge"><span style="color:#10b981">●</span> ${cam.status.toUpperCase()} | AI SECURE</div>
      </div>
      <div class="ai-cctv-footer">
        <span>${cam.name}</span>
        <span class="queue-badge ${Math.random() > 0.5 ? 'short' : 'medium'}">● Active</span>
      </div>
    </div>
  `).join('');
}

// ── Zone cards ────────────────────────────────────────────────
function renderZoneCards(data) {
  const c = document.getElementById('zoneCards');
  if (!c) return;
  c.innerHTML = data.zones.map(z => {
    const pct = Math.min(100, (z.current / z.capacity) * 100).toFixed(0);
    const col = pct > 85 ? '#dc2626' : pct > 60 ? '#f59e0b' : '#059669';
    const lab = pct > 85 ? '🔴 Packed' : pct > 60 ? '🟡 Busy' : '🟢 Free';
    const zEl = document.getElementById(`zone-${z.id}`);
    if (zEl) zEl.setAttribute('class', `zone-path ${pct > 80 ? 'hot' : pct > 50 ? 'warm' : 'cool'}`);
    return `
      <div class="zone-card">
        <div class="zone-card-name">${z.name}</div>
        <div class="zone-card-count" style="color:${col}">${z.current.toLocaleString('en-IN')}</div>
        <div class="zone-bar"><div class="zone-bar-fill" style="width:${pct}%;background:${col}"></div></div>
        <div class="zone-card-label">${lab} · ${pct}%</div>
      </div>`;
  }).join('');

  // Gate dots
  data.gates.forEach(g => {
    const dot = document.getElementById(`gate-${g.id}`);
    if (dot) { dot.classList.toggle('busy', g.queue_length > 50); }
  });
}

function renderGateStatus(gates) {
  const c = document.getElementById('gateStatusGrid');
  if (!c) return;
  c.innerHTML = gates.map(g => {
    const busy = g.queue_length > 50;
    return `
      <div class="gate-status-card ${busy ? 'gate-busy' : 'gate-ok'}">
        <span class="gate-id">Gate ${g.id}</span>
        <span class="gate-q">${g.queue_length} in queue</span>
        <span class="gate-dot-label">${busy ? '🔴 Busy' : '🟢 Open'}</span>
      </div>`;
  }).join('');
}

function appendAlert(a) {
  const list = document.getElementById('alertsList');
  if (!list) return;
  const icons = { danger:'🔴', warning:'🟡', info:'🔵', success:'🟢' };
  const time = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  list.insertAdjacentHTML('afterbegin', `
    <div class="alert-mini ${a.type}">
      <span>${icons[a.type] || '•'}</span>
      <span class="alert-mini-msg">${a.message}</span>
      <span class="alert-mini-time">${time}</span>
    </div>`);
  while (list.children.length > 6) list.lastChild.remove();
}

// ── Weather ───────────────────────────────────────────────────
async function fetchWeather() {
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=19.0760&longitude=72.8777&current_weather=true&forecast_days=1');
    const d = await res.json();
    const cw = d.current_weather;
    const icons = [0,1,2,3].includes(cw.weathercode) ? '☀️' : cw.weathercode < 60 ? '🌦️' : '⛈️';
    setText('heroWeather', `${icons} ${cw.temperature}°C`);
  } catch(e) {}
}

// ── Entry Slots ───────────────────────────────────────────────
async function fetchSlots() {
  const grid = document.getElementById('slotsGrid');
  if (!grid) return;
  try {
    const res  = await fetch('/api/entry/slots');
    const data = await res.json();
    if (!data.success) { grid.innerHTML = `<div class="slot-error">❌ Failed to load slots</div>`; return; }
    renderSlots(data.data);
  } catch(e) {
    grid.innerHTML = `<div class="slot-error">❌ Server error — refresh to retry</div>`;
  }
}

function renderSlots(slots) {
  const grid = document.getElementById('slotsGrid');
  if (!grid) return;
  grid.innerHTML = slots.map(s => {
    const pct = ((s.booked / s.capacity) * 100).toFixed(0);
    const left = s.capacity - s.booked;
    const full = s.status === 'full' || left <= 0;
    return `
      <div class="slot-card ${full ? 'full' : ''}" onclick="${full ? '' : `bookSlot('${s.id}')`}">
        <div class="slot-time">${s.startTime} – ${s.endTime}</div>
        <div class="slot-avail">${full ? '⛔ Full' : `${left} spots left`}</div>
        <div class="slot-bar"><div class="slot-fill" style="width:${pct}%"></div></div>
        ${!full ? `<div class="slot-cta">Tap to Book ↗</div>` : ''}
      </div>`;
  }).join('');
}

async function bookSlot(slotId) {
  showToast('⏳ Booking slot...', 'info');
  try {
    const res  = await fetch('/api/entry/book', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ slotId, count: 1 })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('venue_booking', JSON.stringify(data.data));
      showTicket(data.data);
      showToast('✅ Entry slot booked!', 'success');
    } else {
      showToast(data.error || 'Booking failed', 'danger');
    }
  } catch(e) { showToast('Network error — retry', 'danger'); }
}

function showTicket(d) {
  const grid    = document.getElementById('slotsGrid');
  const display = document.getElementById('ticketDisplay');
  if (grid)    grid.style.display = 'none';
  if (!display) return;
  display.style.display = 'block';
  setText('ticketTime', d.timeWindow);
  setText('ticketGate', 'Gate ' + d.gate);
  setText('ticketQRText', d.qrCode);
  const qr = document.getElementById('ticketQR');
  if (qr) {
    qr.innerHTML = '';
    new QRCode(qr, {
      text: d.qrCode,
      width: 150,
      height: 150,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }
}

/* resetBooking removed per user request */

// ── Food Menu ─────────────────────────────────────────────────
async function fetchMenu() {
  try {
    const res  = await fetch('/api/food/menu');
    const body = await res.json();
    fullMenu = body.data || [];
    renderMenu();
  } catch(e) {
    const g = document.getElementById('menuGrid');
    if (g) g.innerHTML = `<div class="slot-error">❌ Menu failed to load</div>`;
  }
}

let currentCategory = 'all';
function filterMenu(cat, btn) {
  currentCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderMenu();
}

function renderMenu() {
  const grid = document.getElementById('menuGrid');
  if (!grid) return;
  const items = currentCategory === 'all' ? fullMenu : fullMenu.filter(i => i.category === currentCategory);
  if (!items.length) { grid.innerHTML = `<div class="slot-error">No items in this category</div>`; return; }
  grid.innerHTML = items.map(item => {
    const avail = item.available !== false;
    return `
      <div class="menu-card ${avail ? '' : 'unavailable'}" onclick="${avail ? `addToCart('${item.id}','${item.name.replace(/'/g,"\\'")}',${item.price},'${item.image||'🍽️'}')` : ''}">
        <div class="menu-emoji">${item.image || '🍽️'}</div>
        <div class="menu-name">${item.name}</div>
        <div class="menu-price">${avail ? '₹'+item.price : '⛔ Unavailable'}</div>
        ${avail ? `<div class="menu-add-btn">+ Add</div>` : ''}
      </div>`;
  }).join('');
}

// ── Cart ──────────────────────────────────────────────────────
function addToCart(id, name, price, image) {
  const ex = cart.find(i => i.id === id);
  if (ex) ex.qty++;
  else cart.push({ id, name, price, qty:1, image });
  renderCart();
  showToast(`🛒 ${name} added!`, 'success');
}

function removeFromCart(id) {
  const idx = cart.findIndex(i => i.id === id);
  if (idx < 0) return;
  if (cart[idx].qty > 1) cart[idx].qty--;
  else cart.splice(idx, 1);
  renderCart();
}

function renderCart() {
  const bar = document.getElementById('cartBar');
  if (!bar) return;
  if (!cart.length) { bar.style.display = 'none'; isCartOpen = false; return; }
  bar.style.display = 'block';
  const total = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const count = cart.reduce((s,i) => s + i.qty, 0);
  setText('cartCount', count);
  setText('cartTotal', total.toLocaleString('en-IN'));
  const items = document.getElementById('cartItems');
  if (items) {
    items.innerHTML = cart.map(item => `
      <div class="cart-row">
        <span>${item.image} ${item.name} × ${item.qty}</span>
        <span>₹${(item.price * item.qty).toLocaleString('en-IN')}</span>
        <button onclick="removeFromCart('${item.id}')" class="cart-remove">✕</button>
      </div>`).join('');
  }
}

function toggleCart() {
  isCartOpen = !isCartOpen;
  const drop = document.getElementById('cartDropdown');
  if (drop) drop.style.display = isCartOpen ? 'block' : 'none';
}

// ── Place Order (Demo mode — works without Razorpay) ──────────
async function placeOrder() {
  const seat = document.getElementById('seatInput')?.value?.trim();
  const zone = document.getElementById('foodZone')?.value || 'north';
  if (!seat)        return showToast('⚠️ Enter your seat number first', 'danger');
  if (!cart.length) return showToast('⚠️ Cart is empty', 'danger');

  const btn = document.getElementById('placeOrderBtn');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Placing order...'; }

  try {
    // Step 1: Create order via API (triggers demo payment flow)
    const res  = await fetch('/api/payment/create-order', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ items: cart, zone, seat })
    });
    const data = await res.json();

    if (!data.success) {
      showToast(data.error || 'Failed to create order', 'danger');
      if (btn) { btn.disabled = false; btn.innerText = '💳 Confirm Order (Demo Pay)'; }
      return;
    }

    // Step 2: In demo mode, verify immediately (no payment gateway needed)
    const vRes = await fetch('/api/payment/verify', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        pendingRef: data.data.pendingRef,
        razorpay_order_id: data.data.rzpOrderId,
        razorpay_payment_id: `demo_${Date.now()}`,
        razorpay_signature: '',
        demoSuccess: true
      })
    });
    const vData = await vRes.json();

    if (vData.success) {
      handleOrderSuccess(vData.data);
    } else {
      showToast(vData.error || 'Order failed', 'danger');
    }
  } catch(e) {
    showToast('Network error — please retry', 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '💳 Confirm Order (Demo Pay)'; }
  }
}

function handleOrderSuccess(order) {
  myOrders.push(order);
  cart = [];
  renderCart();
  isCartOpen = false;
  const drop = document.getElementById('cartDropdown');
  if (drop) drop.style.display = 'none';
  saveOrders();
  renderMyOrders();
  switchTab('myorders');
  showToast('✅ Order confirmed! Show QR at pickup', 'success');
}

// ── My Orders ─────────────────────────────────────────────────
function renderMyOrders() {
  const list = document.getElementById('myOrdersList');
  if (!list) return;
  if (!myOrders.length) {
    list.innerHTML = `<div class="empty-state"><span>📋</span><p>No orders yet — go to Food tab!</p></div>`;
    return;
  }
  list.innerHTML = [...myOrders].reverse().map(o => {
    const eta = o.remainingTime > 0 ? `⏱️ ${o.remainingTime}s` : '';
    const sc = o.status === 'ready' ? '#059669' : o.status === 'delivered' ? '#6366f1' : '#f59e0b';
    return `
      <div class="order-card">
        <div class="order-top">
          <span class="order-id">${o.id}</span>
          <span class="order-badge" style="background:${sc}">${o.status.toUpperCase()}</span>
        </div>
        <div class="order-items">${(o.items||[]).map(i => `${i.image||'🍽️'} ${i.name} ×${i.qty}`).join(' · ')}</div>
        <div class="order-meta">
          <span>📍 ${o.seat} — ${(o.zone||'').toUpperCase()}</span>
          <span>💰 ₹${o.total}</span>
          <span>${o.status === 'preparing' ? eta || '⏳ Preparing' : o.status === 'ready' ? '✅ Ready!' : '📦 Delivered'}</span>
        </div>
        <div class="order-qr-row">
          <div id="qr-order-${o.id}" class="order-qr-wrap" style="display:inline-block;background:#fff;padding:8px;border-radius:8px;"></div>
          <div>
            <div style="font-weight:800;font-size:0.9rem;">Pickup QR</div>
            <div style="font-size:0.72rem;font-family:monospace;color:var(--text-secondary)">${o.qrCode || o.id}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">Show to staff at ${o.concession || 'concession'}</div>
          </div>
        </div>
      </div>`;
  }).join('');
  
  [...myOrders].reverse().forEach(o => {
    const el = document.getElementById(`qr-order-${o.id}`);
    if (el) {
      el.innerHTML = '';
      new QRCode(el, { text: o.qrCode || o.id, width: 80, height: 80, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });
    }
  });
}

// ── Smart Navigation ─────────────────────────────────────────
async function getRoute() {
  const dest = document.getElementById('navDestination')?.value || 'seat';
  const gate = venueState?.gates ? [...venueState.gates].sort((a,b)=>a.queue_length-b.queue_length)[0]?.id : 'A';
  const btn  = document.querySelector('.nav-btn');
  if (btn) { btn.disabled = true; btn.innerText = '🔎 Finding route...'; }
  try {
    const res  = await fetch(`/api/routing/optimal?to=${dest}&gate=${gate}`);
    const data = await res.json();
    if (!data.success) return showToast('Could not calculate route', 'danger');

    const r = data.data.recommended;
    const alts = data.data.alternatives;
    const col = r.congestion === 'low' ? '#059669' : r.congestion === 'medium' ? '#f59e0b' : '#dc2626';
    const results = document.getElementById('routeResults');
    results.style.display = 'block';
    results.innerHTML = `
      <div class="route-card best">
        <div class="route-best-badge">⭐ Best Route</div>
        <div class="route-steps">
          ${r.path.map((s,i) => `<div class="route-step"><div class="step-num">${i+1}</div><div>${s}</div></div>`).join('<div class="step-connector"></div>')}
        </div>
        <div class="route-meta">
          <span>📏 ${r.distance}</span>
          <span>⏱️ ${r.time}</span>
          <span style="color:${col}">● ${r.congestion.toUpperCase()}</span>
        </div>
      </div>
      ${alts.map(a => `
        <div class="route-card alt">
          <div style="font-weight:800;margin-bottom:6px">${a.label || 'Alternative Route'}</div>
          <div style="font-size:0.82rem;color:var(--text-secondary)">${a.path.join(' → ')}</div>
          <div class="route-meta" style="margin-top:6px"><span>📏 ${a.distance}</span><span>⏱️ ${a.time}</span></div>
        </div>`).join('')}`;

    if (data.data.lowCongestionGates?.length) showToast(`💡 Low traffic: Gates ${data.data.lowCongestionGates.join(', ')}`, 'info');
  } catch(e) { showToast('Navigation error — retry', 'danger'); }
  finally { if (btn) { btn.disabled = false; btn.innerText = '🧭 Find Best Route'; } }
}

// ── CCTV AI animation ─────────────────────────────────────────
function animateBboxes() {
  document.querySelectorAll('.ai-bbox').forEach(b => {
    b.style.top  = (10 + Math.random()*50)+'%';
    b.style.left = (10 + Math.random()*60)+'%';
  });
  const c = document.getElementById('aiConfidence');
  if (c) c.innerText = (94 + Math.random()*5).toFixed(1) + '%';
}

// ── Helpers ───────────────────────────────────────────────────
function setText(id, val) { const el = document.getElementById(id); if (el) el.innerText = val; }

// ── Toast ─────────────────────────────────────────────────────
let _tq = [], _ts = false;
function showToast(msg, type='info') { _tq.push({msg,type}); if (!_ts) _flush(); }
function _flush() {
  if (!_tq.length) { _ts = false; return; }
  _ts = true;
  const {msg,type} = _tq.shift();
  const cols = { danger:'#dc2626', success:'#059669', warning:'#d97706', info:'#4f46e5' };
  let pill = document.getElementById('_tp');
  if (!pill) {
    pill = document.createElement('div'); pill.id = '_tp';
    pill.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%) translateY(-60px);z-index:99999;display:flex;align-items:center;gap:6px;padding:8px 18px;border-radius:999px;font-size:0.82rem;font-weight:700;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.5);transition:transform 0.25s ease,opacity 0.25s ease;opacity:0;pointer-events:none;font-family:Nunito,sans-serif;max-width:85vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    document.body.appendChild(pill);
  }
  pill.style.background = cols[type] || cols.info;
  pill.innerText = msg;
  requestAnimationFrame(() => { pill.style.opacity='1'; pill.style.transform='translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    pill.style.opacity='0'; pill.style.transform='translateX(-50%) translateY(-60px)';
    setTimeout(_flush, 280);
  }, 2400);
}
