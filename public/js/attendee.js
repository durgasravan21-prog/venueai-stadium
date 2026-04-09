/**
 * VenueAI Attendee App — Full Client Logic
 * Handles: navigation tabs, live socket updates, food ordering → Razorpay,
 *          entry slot booking, gate navigation routing, order QR display.
 */

const socket = io();

// ── State ──────────────────────────────────────────────────────────────
let currentTab = 'venue';
let myOrders   = [];
let cart       = [];
let fullMenu   = [];
let venueState = null;

// ── Boot ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetchMenu();
  fetchSlots();
  checkExistingBooking();
  populateGateStatus();
  setInterval(tickOrders, 1000);
  setInterval(animateCameraBoxes, 2000);
});

// ── Live clock for orders ──────────────────────────────────────────────
function tickOrders() {
  let changed = false;
  myOrders.forEach(o => {
    if (o.status === 'preparing' && o.remainingTime > 0) {
      o.remainingTime--;
      changed = true;
    }
  });
  if (changed) renderMyOrders();
}

// ── Existing booking restore ───────────────────────────────────────────
function checkExistingBooking() {
  const saved = localStorage.getItem('venue_booking');
  if (saved) renderTicket(JSON.parse(saved));
}

function renderTicket(d) {
  const grid = document.getElementById('slotsGrid');
  if (grid) grid.style.display = 'none';
  const display = document.getElementById('ticketDisplay');
  if (!display) return;
  display.style.display = 'block';
  document.getElementById('ticketTime').innerText = d.timeWindow;
  document.getElementById('ticketGate').innerText = 'Gate ' + d.gate;
  document.getElementById('ticketQRText').innerText = d.qrCode;
  document.getElementById('ticketQR').src =
    `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(d.qrCode)}`;
}

// ── Socket events ──────────────────────────────────────────────────────
socket.on('venue_update', data => {
  venueState = data;
  const att = document.getElementById('liveAttendance');
  if (att) att.innerText = data.totalAttendance.toLocaleString();
  const avgWait = data.concessions.reduce((a, c) => a + c.queue_time, 0) / data.concessions.length;
  const lw = document.getElementById('liveWait');
  if (lw) lw.innerText = avgWait.toFixed(1) + ' min';

  // Best gate
  const best = [...data.gates].sort((a, b) => a.queue_length - b.queue_length)[0];
  const bg = document.getElementById('bestGate');
  if (bg && best) bg.innerText = best.name;

  // Zone cards + map
  const container = document.getElementById('zoneCards');
  if (container) {
    container.innerHTML = data.zones.map(zone => {
      const pct = Math.min(100, (zone.current / zone.capacity) * 100).toFixed(0);
      const col = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';
      const zp = document.getElementById(`zone-${zone.id}`);
      if (zp) zp.className.baseVal = `zone-path ${pct > 80 ? 'hot' : pct > 50 ? 'warm' : 'cool'}`;
      return `<div class="zone-card">
        <div class="zone-card-name">${zone.name}</div>
        <div class="zone-card-count">${zone.current.toLocaleString()}</div>
        <div class="zone-card-bar"><div class="zone-card-fill" style="width:${pct}%;background:${col}"></div></div>
      </div>`;
    }).join('');
  }

  // Gate dots
  data.gates.forEach(gate => {
    const dot = document.getElementById(`gate-${gate.id}`);
    if (dot) dot.classList.toggle('busy', gate.queue_length > 50);
  });

  // Gate status grid in Navigate tab
  const gsGrid = document.getElementById('gateStatusGrid');
  if (gsGrid) {
    gsGrid.innerHTML = data.gates.map(g => {
      const busy = g.queue_length > 50;
      return `<div class="gate-status-card ${busy ? 'gate-busy' : 'gate-ok'}">
        <span class="gate-status-name">Gate ${g.id}</span>
        <span class="gate-status-q">${g.queue_length} in queue</span>
        <span class="gate-status-dot">${busy ? '🔴 Busy' : '🟢 Open'}</span>
      </div>`;
    }).join('');
  }
});

socket.on('match_update', data => {
  const el = id => document.getElementById(id);
  if (el('homeScore'))   el('homeScore').innerText  = data.homeScore;
  if (el('awayScore'))   el('awayScore').innerText  = data.awayScore;
  if (el('matchStatus')) el('matchStatus').innerText = data.status.replace(/_/g, ' ').toUpperCase();
  if (el('matchMinute')) el('matchMinute').innerText = data.minute > 0 ? data.minute + "'" : '';
  // Update team names if admin changed them
  const sportIcons = { cricket:'🏏', football:'⚽', basketball:'🏀', volleyball:'🏐', kabaddi:'🤸', hockey:'🏑' };
  const icon = sportIcons[data.sport] || '🏆';
  const heroTeams = document.querySelectorAll('.team-name');
  if (heroTeams.length >= 2 && data.homeTeam && data.awayTeam) {
    heroTeams[0].innerText = data.homeTeam;
    heroTeams[1].innerText = data.awayTeam;
  }
  const teamIcons = document.querySelectorAll('.team-icon');
  if (teamIcons.length >= 2 && data.sport) {
    teamIcons[0].innerText = icon;
    teamIcons[1].innerText = icon;
  }
  // Highlight goal events
  if (data.events && data.events.length > 0) {
    const last = data.events[data.events.length - 1];
    if (last && last.type === 'goal') {
      showToast(`${icon} GOAL! ${last.team} scores at ${last.minute}'`, 'success');
    }
  }
});

// Venue alerts → update the Venue tab list ONLY, never block the screen
socket.on('alert', alert => {
  // Only show a tiny toast for critical/emergency events; ignore routine ones
  if (alert.type === 'danger' || alert.type === 'emergency') {
    showToast(alert.message, 'danger');
  }
  // Silently append to the Venue tab list
  const list = document.getElementById('alertsList');
  if (!list) return;
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  list.insertAdjacentHTML('afterbegin', `
    <div class="alert-item-mini ${alert.type}">
      <span class="alert-dot-${alert.type}"></span>
      <span class="alert-msg-text">${alert.message}</span>
      <span class="alert-time-text">${now}</span>
    </div>`);
  while (list.children.length > 5) list.lastChild.remove();
});

socket.on('order_update', order => {
  const existing = myOrders.find(o => o.id === order.id);
  if (existing) {
    Object.assign(existing, order);
    renderMyOrders();
    // Only notify on meaningful status changes for MY orders
    if (order.status === 'ready') showToast(`✅ ${order.id} ready — go collect!`, 'success');
    if (order.status === 'delivered') showToast(`📦 ${order.id} delivered`, 'info');
  }
});

// Staff pushed a menu update (availability toggle)
socket.on('menu_update', updatedMenu => {
  fullMenu = updatedMenu;
  renderMenu(fullMenu);
});

// ── Tab navigation ─────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(`tab-${tabId}`);
  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  if (panel) panel.classList.add('active');
  if (btn)   btn.classList.add('active');
  currentTab = tabId;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToSection(id) { switchTab(id); }

// ── Entry Slots ────────────────────────────────────────────────────────
async function fetchSlots() {
  try {
    const res  = await fetch('/api/entry/slots');
    const data = await res.json();
    const grid = document.getElementById('slotsGrid');
    if (!grid) return;
    grid.innerHTML = data.data.map(slot => `
      <div class="slot-card ${slot.status === 'full' ? 'full' : ''}" onclick="bookSlot('${slot.id}')">
        <div class="slot-time">${slot.startTime} – ${slot.endTime}</div>
        <div class="slot-avail">${slot.capacity - slot.booked} spots left</div>
        <div class="slot-bar"><div class="slot-fill" style="width:${(slot.booked/slot.capacity)*100}%"></div></div>
      </div>`).join('');
  } catch (e) { console.error('fetchSlots', e); }
}

async function bookSlot(slotId) {
  const res  = await fetch('/api/entry/book', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ slotId })
  });
  const data = await res.json();
  if (data.success) {
    localStorage.setItem('venue_booking', JSON.stringify(data.data));
    renderTicket(data.data);
    showToast('✅ Entry slot booked!', 'success');
  } else {
    showToast(data.error, 'danger');
  }
}

// ── Food Menu ──────────────────────────────────────────────────────────
async function fetchMenu() {
  try {
    const res  = await fetch('/api/food/menu');
    const body = await res.json();
    fullMenu = body.data;
    renderMenu(fullMenu);
  } catch (e) { console.error('fetchMenu', e); }
}

function filterMenu(category) {
  document.querySelectorAll('.food-cat-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderMenu(category === 'all' ? fullMenu : fullMenu.filter(m => m.category === category));
}

function renderMenu(items) {
  const grid = document.getElementById('menuGrid');
  if (!grid) return;
  const available = items.filter(i => i.available !== false);
  const unavailable = items.filter(i => i.available === false);
  grid.innerHTML = [
    ...available.map(item => `
      <div class="menu-item" onclick="addToCart('${item.id}','${item.name.replace(/'/g,"\\'")}',${item.price})">
        <span class="menu-item-emoji">${item.image}</span>
        <div class="menu-item-name">${item.name}</div>
        <div class="menu-item-price">₹${item.price}</div>
        <div class="menu-item-add">+</div>
      </div>`),
    ...unavailable.map(item => `
      <div class="menu-item unavailable" title="Currently unavailable">
        <span class="menu-item-emoji" style="opacity:0.4">${item.image}</span>
        <div class="menu-item-name" style="opacity:0.5">${item.name}</div>
        <div class="menu-item-price" style="color:#666">Unavailable</div>
        <div class="menu-item-add" style="background:#444;cursor:not-allowed">✕</div>
      </div>`)
  ].join('');
}

function addToCart(id, name, price) {
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty++;
  else cart.push({ id, name, price, qty: 1 });
  updateCartUI();
  showToast(`🛒 ${name} added`, 'success');
}

function removeFromCart(id) {
  const idx = cart.findIndex(i => i.id === id);
  if (idx !== -1) {
    if (cart[idx].qty > 1) cart[idx].qty--;
    else cart.splice(idx, 1);
    updateCartUI();
  }
}

function updateCartUI() {
  const container = document.getElementById('cartContainer');
  if (!container) return;
  if (cart.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const count = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('cartTotal').innerText = total;
  document.getElementById('cartCount').innerText = count;
  document.getElementById('cartItems').innerHTML = cart.map(item => `
    <div class="cart-item">
      <span>${item.image || ''} ${item.name} (x${item.qty})</span>
      <span style="display:flex;align-items:center;gap:8px">
        ₹${item.price * item.qty}
        <button onclick="removeFromCart('${item.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:1rem">✕</button>
      </span>
    </div>`).join('');
}

function toggleCart() {
  const body = document.getElementById('cartBody');
  if (body) body.style.display = body.style.display === 'block' ? 'none' : 'block';
}

// ── Razorpay Payment Flow ──────────────────────────────────────────────
async function placeOrder() {
  const seat = document.getElementById('seatInput')?.value?.trim();
  const zone = document.getElementById('foodZone')?.value;
  if (!seat) return showToast('Enter your seat/section first', 'danger');
  if (!cart.length) return showToast('Cart is empty', 'danger');

  // Check Razorpay SDK is loaded
  if (!window.Razorpay) {
    return showToast('Payment SDK not loaded — check internet connection', 'danger');
  }

  const placeBtn = document.getElementById('placeOrderBtn');
  if (placeBtn) { placeBtn.disabled = true; placeBtn.innerText = '⏳ Creating order...'; }

  try {
    const res  = await fetch('/api/payment/create-order', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ items: cart, zone, seat })
    });
    const data = await res.json();

    if (!data.success) {
      showToast(data.error || 'Failed to initiate payment', 'danger');
      return;
    }

    // Always open real Razorpay checkout — no custom modal
    openRazorpay(data.data, zone, seat);

  } catch (e) {
    showToast('Network error — please retry', 'danger');
    console.error(e);
  } finally {
    if (placeBtn) { placeBtn.disabled = false; placeBtn.innerText = '💳 Pay & Order'; }
  }
}

function openRazorpay({ pendingRef, rzpOrderId, rzpKeyId, total }, zone, seat) {
  const options = {
    key: rzpKeyId,                        // Your rzp_test_ or rzp_live_ key
    amount: total * 100,                  // paise
    currency: 'INR',
    name: 'VenueAI Stadium',
    description: `Food Order — Seat ${seat}`,
    image: 'https://via.placeholder.com/80x80/6366f1/ffffff?text=🏟',
    order_id: rzpOrderId,
    prefill: {
      name: '',                           // Razorpay will let user fill
      email: '',
      contact: ''
    },
    notes: { seat, zone },
    theme: { color: '#6366f1' },
    handler: async function (response) {
      // response = { razorpay_payment_id, razorpay_order_id, razorpay_signature }
      try {
        const vRes = await fetch('/api/payment/verify', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ pendingRef, ...response })
        });
        const vData = await vRes.json();
        if (vData.success) {
          onOrderSuccess(vData.data);
        } else {
          showToast('Payment verification failed — contact support', 'danger');
        }
      } catch (e) {
        showToast('Verification network error', 'danger');
      }
    },
    modal: {
      ondismiss: () => showToast('Payment cancelled', 'warning')
    }
  };

  const rzp = new window.Razorpay(options);
  rzp.on('payment.failed', function (resp) {
    showToast(`Payment failed: ${resp.error.description}`, 'danger');
  });
  rzp.open();
}

function onOrderSuccess(order) {
  myOrders.push(order);
  cart = [];
  updateCartUI();
  const cartBody = document.getElementById('cartBody');
  if (cartBody) cartBody.style.display = 'none';
  switchTab('myorders');
  renderMyOrders();
  showToast('✅ Order confirmed! Show QR at pickup', 'success');
}


// ── My Orders ──────────────────────────────────────────────────────────
function renderMyOrders() {
  const list = document.getElementById('myOrdersList');
  if (!list) return;
  if (!myOrders.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>No orders yet. Head to the Food tab to order!</p></div>`;
    return;
  }
  list.innerHTML = [...myOrders].reverse().map(order => {
    const eta = order.remainingTime > 0 ? `${order.remainingTime}s` : '—';
    const statusColor = order.status === 'ready' ? '#10b981' : order.status === 'delivered' ? '#6366f1' : '#f59e0b';
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(order.qrCode || order.id)}`;
    return `
      <div class="order-card">
        <div class="order-card-top">
          <div>
            <span class="order-id">${order.id}</span>
            <div class="order-items-summary">${(order.items||[]).map(i=>`${i.image||'🍽️'} ${i.name} x${i.qty}`).join(', ')}</div>
          </div>
          <span class="order-status-badge" style="background:${statusColor}">${order.status.toUpperCase()}</span>
        </div>
        <div class="order-meta">
          <span>📍 ${order.seat} — ${order.zone?.toUpperCase()}</span>
          <span>💰 ₹${order.total}</span>
          <span>${order.status === 'preparing' ? `⏱️ ETA: ${eta}` : order.status === 'ready' ? '✅ Ready for pickup!' : '📦 Delivered'}</span>
        </div>
        ${order.status !== 'delivering' ? `
        <div class="order-qr-row">
          <img src="${qrUrl}" alt="Pickup QR" style="width:80px;height:80px;border-radius:8px">
          <div class="order-qr-text">
            <p style="font-weight:600">Pickup QR Code</p>
            <p style="font-size:0.75rem;color:#9ca3af;font-family:monospace">${order.qrCode || order.id}</p>
            <p style="font-size:0.75rem;color:#9ca3af">Show to staff at ${order.concession || 'concession stand'}</p>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');
}

// ── Smart Navigation ───────────────────────────────────────────────────
async function getRoute() {
  const destination = document.getElementById('navDestination')?.value || 'seat';
  const gate = venueState?.gates ? [...venueState.gates].sort((a,b)=>a.queue_length-b.queue_length)[0]?.id : 'A';

  const btn = document.querySelector('.nav-find-btn');
  if (btn) { btn.disabled = true; btn.innerText = '🔎 Finding route...'; }

  try {
    const res  = await fetch(`/api/routing/optimal?to=${destination}&gate=${gate}`);
    const data = await res.json();
    if (!data.success) return showToast('Could not calculate route', 'danger');

    const r = data.data.recommended;
    const alts = data.data.alternatives;
    const congColor = r.congestion === 'low' ? '#10b981' : r.congestion === 'medium' ? '#f59e0b' : '#ef4444';

    document.getElementById('routeResults').style.display = 'block';
    document.getElementById('recommendedRoute').innerHTML = `
      <div class="route-badge">⭐ Best Route</div>
      <div class="route-steps">
        ${r.steps.map((step, i) => `
          <div class="route-step">
            <div class="route-step-num">${i+1}</div>
            <div>${step}</div>
          </div>`).join('<div class="route-connector"></div>')}
      </div>
      <div class="route-meta">
        <span>📏 ${r.distance}</span>
        <span>⏱️ ${r.time}</span>
        <span style="color:${congColor}">● ${r.congestion.toUpperCase()} congestion</span>
      </div>`;

    const altContainer = document.getElementById('altRoutes');
    if (altContainer) {
      altContainer.innerHTML = alts.map(alt => `
        <div class="route-alt-card">
          <div style="font-weight:600;margin-bottom:8px">${alt.label}</div>
          <div style="font-size:0.85rem;color:#9ca3af;margin-bottom:6px">${alt.steps.join(' → ')}</div>
          <div class="route-meta"><span>📏 ${alt.distance}</span><span>⏱️ ${alt.time}</span></div>
        </div>`).join('');
    }

    if (data.data.lowCongestionGates?.length) {
      showToast(`💡 Low congestion: Gates ${data.data.lowCongestionGates.join(', ')}`, 'info');
    }
  } catch(e) {
    showToast('Navigation error. Please retry.', 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '🧭 Find Best Route'; }
  }
}

function populateGateStatus() {
  // Placeholder until first socket update
  const gsGrid = document.getElementById('gateStatusGrid');
  if (!gsGrid) return;
  ['A','B','C','D','E','F','G','H'].forEach(id => {
    gsGrid.innerHTML += `<div class="gate-status-card gate-ok" id="gstatus-${id}">
      <span class="gate-status-name">Gate ${id}</span>
      <span class="gate-status-q">— in queue</span>
      <span class="gate-status-dot">⏳ Loading...</span>
    </div>`;
  });
}

// ── CCTV AI bounding box animation ─────────────────────────────────────
function animateCameraBoxes() {
  document.querySelectorAll('.ai-bbox').forEach(box => {
    const top  = 10 + Math.random() * 50;
    const left = 10 + Math.random() * 60;
    box.style.top  = top + '%';
    box.style.left = left + '%';
  });
  const confEl = document.getElementById('aiConfidence');
  if (confEl) confEl.innerText = (94 + Math.random()*5).toFixed(1) + '%';
}

// ── Toast — tiny pill at top, non-blocking ─────────────────────────────
let _toastQueue = [];
let _toastShowing = false;

function showToast(msg, type = 'info') {
  _toastQueue.push({ msg, type });
  if (!_toastShowing) _flushToast();
}

function _flushToast() {
  if (!_toastQueue.length) { _toastShowing = false; return; }
  _toastShowing = true;
  const { msg, type } = _toastQueue.shift();

  const colors = { danger:'#dc2626', success:'#059669', warning:'#d97706', info:'#4f46e5' };
  const icons  = { danger:'⚠', success:'✓', warning:'●', info:'ℹ' };

  // Reuse or create the single shared pill element
  let pill = document.getElementById('_toastPill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = '_toastPill';
    pill.style.cssText = [
      'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%) translateY(-48px)',
      'z-index:99999', 'display:flex', 'align-items:center', 'gap:6px',
      'padding:5px 14px 5px 10px', 'border-radius:999px',
      'font-size:0.78rem', 'font-weight:600', 'color:#fff',
      'box-shadow:0 2px 12px rgba(0,0,0,0.35)',
      'transition:transform 0.25s cubic-bezier(.4,0,.2,1), opacity 0.25s',
      'opacity:0', 'pointer-events:none', 'max-width:80vw',
      'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis'
    ].join(';');
    document.body.appendChild(pill);
  }

  pill.style.background = colors[type] || colors.info;
  pill.innerHTML = `<span style="font-size:0.85rem">${icons[type]||icons.info}</span><span>${msg}</span>`;

  // Slide in
  requestAnimationFrame(() => {
    pill.style.opacity = '1';
    pill.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Slide out after 2.2 s
  setTimeout(() => {
    pill.style.opacity = '0';
    pill.style.transform = 'translateX(-50%) translateY(-48px)';
    setTimeout(() => _flushToast(), 280);
  }, 2200);
}

