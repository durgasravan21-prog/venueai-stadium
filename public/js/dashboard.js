/**
 * VenueAI — Staff Command Center Dashboard JS
 * Complete rewrite — fully functional with all panels
 */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────
let densityChart = null;
let allStaff = [];
let allOrders = [];
let allAlerts = [];
let allMatchEvents = [];
let currentStaffFilter = 'all';
let currentAlertFilter = 'all';
let unreadAlerts = 0;
let venueState = null;

// ─── Boot ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setInterval(updateTime, 1000);
  updateTime();
  initCharts();
  fetchStaff();
  fetchOrders();
  loadInitialAlerts();
});

// ─── Time ──────────────────────────────────────────────────────────────
function updateTime() {
  const el = document.getElementById('topbarTime');
  if (el) el.innerText = new Date().toLocaleTimeString('en-IN', { hour12: true });
}

// ─── Chart.js ──────────────────────────────────────────────────────────
function initCharts() {
  const ctx = document.getElementById('crowdChart');
  if (!ctx) return;
  densityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Live Attendance',
        data: [],
        borderColor: '#4493f8',
        backgroundColor: 'rgba(68,147,248,0.12)',
        tension: 0.4,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: 60000,
          ticks: { color: '#8b949e', font: { size: 11 }, callback: v => (v/1000).toFixed(0)+'k' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        x: {
          display: false,
          grid: { display: false }
        }
      },
      animation: false
    }
  });
}

// ─── Panel Navigation ──────────────────────────────────────────────────
function switchPanel(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  const panel = document.getElementById(`panel-${panelId}`);
  const btn = document.querySelector(`[data-panel="${panelId}"]`);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');

  const titles = {
    overview: 'Overview',
    crowd: 'Crowd Monitor',
    orders: 'Food Orders',
    staff: 'Staff Dispatch',
    alerts: 'Alert Center',
    cameras: 'Live CCTV Feeds',
    match: 'Match Control',
    settings: 'Venue Settings'
  };
  const el = document.getElementById('panelTitle');
  if (el) el.innerText = titles[panelId] || panelId;

  // Refresh data on switch
  if (panelId === 'staff') fetchStaff();
  if (panelId === 'orders') fetchOrders();
}

// ─── Socket: Venue Update ──────────────────────────────────────────────
socket.on('venue_update', data => {
  venueState = data;

  // KPI: Attendance
  setText('kpiAttendance', data.totalAttendance.toLocaleString('en-IN'));
  const pct = ((data.totalAttendance / data.capacity) * 100).toFixed(1);
  setText('kpiAttendancePct', `${pct}% capacity`);

  // KPI: Avg Wait
  const avgWait = data.concessions.reduce((a, c) => a + c.queue_time, 0) / data.concessions.length;
  setText('kpiWaitTime', avgWait.toFixed(1));

  // Chart update
  if (densityChart) {
    densityChart.data.labels.push(new Date().toLocaleTimeString());
    densityChart.data.datasets[0].data.push(data.totalAttendance);
    if (densityChart.data.labels.length > 40) {
      densityChart.data.labels.shift();
      densityChart.data.datasets[0].data.shift();
    }
    densityChart.update();
  }

  // Zone bars in Overview
  renderZoneBars(data.zones, data.capacity);

  // Gate flow
  renderGateFlow(data.gates);

  // Concession list
  renderConcessionList(data.concessions);

  // Crowd panel
  renderCrowdPanel(data);
});

// ─── Socket: Match Update ──────────────────────────────────────────────
socket.on('match_update', data => {
  setText('miniScore', `${data.homeScore} : ${data.awayScore}`);
  setText('miniStatus', data.minute > 0 ? `${data.minute}'` : data.status.replace('_', ' ').toUpperCase());
  setText('ctrlHomeScore', data.homeScore);
  setText('ctrlAwayScore', data.awayScore);
  setText('ctrlStatus', data.status.replace(/_/g, ' ').toUpperCase());
  setText('ctrlMinute', data.minute > 0 ? `${data.minute}'` : '—');

  // Build event list
  if (data.events && data.events.length > allMatchEvents.length) {
    allMatchEvents = data.events;
    renderMatchEvents();
  }
});

// ─── Socket: Alerts ────────────────────────────────────────────────────
socket.on('alerts_init', existingAlerts => {
  allAlerts = existingAlerts;
  renderAllAlerts();
});

socket.on('alert', alert => {
  allAlerts.unshift(alert);
  unreadAlerts++;
  const badge = document.getElementById('alertBadge');
  if (badge) badge.innerText = unreadAlerts;

  // Append to overview feed
  const feed = document.getElementById('alertFeedOverview');
  if (feed) {
    const div = document.createElement('div');
    div.className = `alert-item ${alert.type}`;
    div.innerHTML = `<span>${alert.message}</span><button class="btn btn-sm btn-secondary" onclick="ackAlert(this, ${alert.id})">Ack</button>`;
    feed.insertBefore(div, feed.firstChild);
    if (feed.children.length > 12) feed.lastChild.remove();
  }

  renderAllAlerts();

  // Increment orders KPI if it's a revenue/order event (just use orders array length)
  refreshOrderKPIs();
});

// ─── Socket: Staff ─────────────────────────────────────────────────────
socket.on('staff_update', updated => {
  const idx = allStaff.findIndex(s => s.id === updated.id);
  if (idx >= 0) allStaff[idx] = updated;
  renderStaffGrid();
});

socket.on('new_order', () => fetchOrders());
socket.on('order_update', () => fetchOrders());

// ─── Render: Zone Bars (Overview) ─────────────────────────────────────
function renderZoneBars(zones, totalCap) {
  const container = document.getElementById('zoneBars');
  if (!container) return;
  container.innerHTML = zones.map(z => {
    const pct = Math.min(100, (z.current / z.capacity) * 100);
    const color = pct > 85 ? 'var(--danger)' : pct > 55 ? 'var(--warning)' : 'var(--success)';
    return `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:0.83rem;margin-bottom:6px;">
          <span style="font-weight:600">${z.name}</span>
          <span style="color:var(--text-muted)">${z.current.toLocaleString('en-IN')} / ${z.capacity.toLocaleString('en-IN')}</span>
        </div>
        <div style="width:100%;height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.5s ease;"></div>
        </div>
        <div style="text-align:right;font-size:0.72rem;color:${color};margin-top:3px;font-weight:700;">${pct.toFixed(0)}%</div>
      </div>`;
  }).join('');
}

// ─── Render: Gate Flow ────────────────────────────────────────────────
function renderGateFlow(gates) {
  const container = document.getElementById('gateFlowList');
  if (!container) return;
  const maxFlow = Math.max(...gates.map(g => g.throughput));
  container.innerHTML = gates.slice(0, 6).map(g => {
    const pct = Math.min(100, (g.current_flow / maxFlow) * 100);
    const color = g.queue_length > 100 ? 'var(--danger)' : g.queue_length > 30 ? 'var(--warning)' : 'var(--success)';
    return `
      <div class="gate-flow-item">
        <span class="gate-name">${g.name}</span>
        <div class="gate-bar-wrap">
          <div class="gate-bar" style="width:${pct}%;background:${color};"></div>
        </div>
        <span class="gate-queue">${g.queue_length} queued</span>
      </div>`;
  }).join('');
}

// ─── Render: Concession List ──────────────────────────────────────────
function renderConcessionList(concessions) {
  const container = document.getElementById('concessionList');
  if (!container) return;
  container.innerHTML = concessions.map(c => {
    const color = c.queue_time > 10 ? 'var(--danger)' : c.queue_time > 5 ? 'var(--warning)' : 'var(--success)';
    return `
      <div class="concession-item">
        <div>
          <div class="concession-name">${c.name}</div>
          <div class="concession-zone">${c.zone.toUpperCase()} • ${c.orders_pending} pending</div>
        </div>
        <div class="concession-wait" style="color:${color}">${c.queue_time}m wait</div>
      </div>`;
  }).join('');
}

// ─── Render: Crowd Panel ───────────────────────────────────────────────
function renderCrowdPanel(data) {
  // Big number
  setText('crowdTotal', data.totalAttendance.toLocaleString('en-IN'));

  // Ring progress
  const pct = Math.min(100, (data.totalAttendance / data.capacity) * 100);
  setText('ringText', `${pct.toFixed(0)}%`);
  const ring = document.getElementById('ringProgress');
  if (ring) {
    const circumference = 327;
    ring.style.strokeDashoffset = circumference - (circumference * pct / 100);
  }

  // Zone cards
  const zonesContainer = document.getElementById('crowdZonesDetail');
  if (zonesContainer) {
    zonesContainer.innerHTML = data.zones.map(z => {
      const zpct = Math.min(100, (z.current / z.capacity) * 100);
      const color = zpct > 85 ? 'var(--danger)' : zpct > 55 ? 'var(--warning)' : 'var(--success)';
      const label = zpct > 85 ? '🔴 Critical' : zpct > 55 ? '🟡 Busy' : '🟢 Normal';
      return `
        <div class="zone-detail-card">
          <div class="zone-detail-name">${z.name}</div>
          <div class="zone-detail-count">${z.current.toLocaleString('en-IN')} / ${z.capacity.toLocaleString('en-IN')}</div>
          <div class="zone-detail-bar">
            <div class="zone-detail-fill" style="width:${zpct}%;background:${color};"></div>
          </div>
          <div class="zone-detail-pct" style="color:${color}">${zpct.toFixed(0)}% — ${label}</div>
        </div>`;
    }).join('');
  }

  // Heatmap
  const heatmap = document.getElementById('heatmapGrid');
  if (heatmap && data.zones) {
    heatmap.innerHTML = data.zones.map(z => {
      const zpct = Math.min(100, (z.current / z.capacity) * 100);
      const alpha = 0.15 + (zpct / 100) * 0.7;
      const color = zpct > 85 ? `rgba(248,81,73,${alpha})` : zpct > 55 ? `rgba(210,153,34,${alpha})` : `rgba(63,185,80,${alpha})`;
      const icon = zpct > 85 ? '🔴' : zpct > 55 ? '🟡' : '🟢';
      return `
        <div class="heatmap-cell" style="background:${color};">
          <div style="font-size:1.3rem">${icon}</div>
          <div style="font-weight:800;font-size:0.8rem">${zpct.toFixed(0)}%</div>
          <div class="cell-name">${z.name.split(' ')[0]}</div>
        </div>`;
    }).join('') +
    `<div class="heatmap-cell" style="background:rgba(63,185,80,0.15)">
      <div style="font-size:1.3rem">🟢</div>
      <div style="font-weight:800;font-size:0.8rem">—</div>
      <div class="cell-name">Parking</div>
    </div>`;
  }
}

// ─── Staff ─────────────────────────────────────────────────────────────
async function fetchStaff() {
  try {
    const res = await fetch('/api/staff');
    const data = await res.json();
    allStaff = data.data;
    renderStaffGrid();
  } catch (e) { console.error('Staff fetch error:', e); }
}

function renderStaffGrid() {
  const grid = document.getElementById('staffGrid');
  if (!grid) return;

  const filtered = currentStaffFilter === 'all'
    ? allStaff
    : allStaff.filter(s => s.role === currentStaffFilter);

  const avail = allStaff.filter(s => s.status === 'available').length;
  const dep = allStaff.filter(s => s.status !== 'available').length;
  setText('staffAvail', avail);
  setText('staffDeployed', dep);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span>👷</span><p>No staff in this category</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(s => {
    const roleClass = { security: 'role-security', service: 'role-service', medical: 'role-medical' }[s.role] || 'role-service';
    const statusClass = s.status === 'available' ? 's-available' : 's-dispatched';
    const roleIcon = { security: '🛡️', service: '🤝', medical: '🏥' }[s.role] || '👤';
    return `
      <div class="staff-card" data-role="${s.role}">
        <div class="staff-card-header">
          <div class="staff-name">${roleIcon} ${s.name}</div>
          <div class="staff-role-badge ${roleClass}">${s.role}</div>
        </div>
        <div class="staff-info">📍 Zone: ${s.zone.replace('_', ' ').toUpperCase()}</div>
        ${s.currentTask ? `<div class="staff-task">▶ ${s.currentTask}</div>` : ''}
        <div class="staff-status-row">
          <span class="staff-status-badge ${statusClass}">${s.status}</span>
          ${s.status === 'available'
            ? `<button class="btn btn-sm btn-warning" onclick="dispatchStaff('${s.id}')">Dispatch</button>`
            : `<button class="btn btn-sm btn-secondary" onclick="releaseStaff('${s.id}')">Release</button>`}
        </div>
      </div>`;
  }).join('');
}

function filterStaff(role) {
  currentStaffFilter = role;
  document.querySelectorAll('.staff-filter').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.staff-filter[onclick="filterStaff('${role}')"]`);
  if (btn) btn.classList.add('active');
  renderStaffGrid();
}

async function dispatchStaff(id) {
  const zone = prompt('Enter zone to dispatch to (e.g. north, south, east, west, vip):', 'north');
  if (!zone) return;
  await fetch(`/api/staff/${id}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone, task: 'Manual dispatch by command center' })
  });
  fetchStaff();
}

async function releaseStaff(id) {
  await fetch(`/api/staff/${id}/release`, { method: 'POST' });
  fetchStaff();
}

// ─── Orders ────────────────────────────────────────────────────────────
async function fetchOrders() {
  try {
    const res = await fetch('/api/food/orders');
    const data = await res.json();
    allOrders = data.data;
    renderOrdersGrid();
    refreshOrderKPIs();
  } catch (e) { console.error('Orders fetch error:', e); }
}

function refreshOrderKPIs() {
  const preparing = allOrders.filter(o => o.status === 'preparing').length;
  const ready = allOrders.filter(o => o.status === 'ready').length;
  const delivered = allOrders.filter(o => o.status === 'delivered').length;
  setText('ordersPending', preparing);
  setText('ordersReady', ready);
  setText('ordersDelivered', delivered);
  setText('kpiOrders', allOrders.length);

  const revenue = allOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  setText('kpiRevenue', '₹' + revenue.toLocaleString('en-IN'));
}

function renderOrdersGrid() {
  const grid = document.getElementById('ordersGrid');
  if (!grid) return;

  if (allOrders.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span>📋</span><p>No orders yet. Waiting for attendees to place orders...</p></div>`;
    return;
  }

  grid.innerHTML = allOrders.slice(0, 30).map(o => {
    const sc = { preparing: 'status-preparing', ready: 'status-ready', delivered: 'status-delivered' }[o.status] || 'status-preparing';
    return `
      <div class="order-card">
        <div class="order-id">${o.id}</div>
        <div class="order-seat">🪑 ${o.seat}</div>
        <div class="order-zone">📍 ${o.zone?.toUpperCase()} • ${o.concession}</div>
        <div class="order-items">
          ${(o.items || []).map(i => `<div class="order-item-row"><span>${i.image} ${i.name}</span><span>x${i.qty}</span></div>`).join('')}
        </div>
        <div class="order-total">Total: ₹${(o.total || 0).toLocaleString('en-IN')}</div>
        <div><span class="order-status-badge ${sc}">${o.status}</span></div>
        ${o.status === 'preparing' ? `<div class="order-eta">⏱ Est. ${o.remainingTime ?? o.estimatedTime}m remaining</div>
          <button class="btn btn-success btn-sm" onclick="completeOrder('${o.id}')">✅ Mark Ready</button>` : ''}
      </div>`;
  }).join('');
}

async function completeOrder(id) {
  await fetch(`/api/food/orders/${id}/complete`, { method: 'POST' });
  fetchOrders();
}

// ─── Alerts ────────────────────────────────────────────────────────────
async function loadInitialAlerts() {
  try {
    const res = await fetch('/api/alerts');
    const data = await res.json();
    allAlerts = data.data;
    renderAllAlerts();
  } catch (e) { console.error('Alerts fetch error:', e); }
}

function renderAllAlerts() {
  const list = document.getElementById('alertsFullList');
  if (!list) return;

  const filtered = currentAlertFilter === 'all'
    ? allAlerts
    : allAlerts.filter(a => a.type === currentAlertFilter);

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><span>🔔</span><p>No alerts in this category</p></div>`;
    return;
  }

  const typeIcon = { danger: '🔴', warning: '🟡', info: '🔵', success: '🟢' };
  list.innerHTML = filtered.map(a => {
    const time = new Date(a.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `
      <div class="alert-full-item ${a.type} ${a.acknowledged ? 'acknowledged' : ''}" id="alert-${a.id}">
        <div class="alert-body">
          <div class="alert-msg">${typeIcon[a.type] || '•'} ${a.message}</div>
          <div class="alert-meta">
            <span>🕐 ${time}</span>
            <span>Source: ${a.source || 'system'}</span>
            ${a.acknowledged ? '<span style="color:var(--success)">✔ Acknowledged</span>' : ''}
          </div>
        </div>
        <div class="alert-actions">
          ${!a.acknowledged ? `<button class="btn btn-sm btn-secondary" onclick="ackAlertFull(${a.id})">Ack</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function filterAlerts(type) {
  currentAlertFilter = type;
  document.querySelectorAll('.alert-filter').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.alert-filter[onclick="filterAlerts('${type}')"]`);
  if (btn) btn.classList.add('active');
  renderAllAlerts();
}

function ackAlert(btn, id) {
  btn.parentElement.remove();
  unreadAlerts = Math.max(0, unreadAlerts - 1);
  const badge = document.getElementById('alertBadge');
  if (badge) badge.innerText = unreadAlerts;
  const a = allAlerts.find(a => a.id === id);
  if (a) a.acknowledged = true;
}

async function ackAlertFull(id) {
  await fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
  const a = allAlerts.find(a => a.id === id);
  if (a) a.acknowledged = true;
  renderAllAlerts();
}

// ─── Match Events ──────────────────────────────────────────────────────
function renderMatchEvents() {
  const list = document.getElementById('matchEventsList');
  if (!list) return;
  if (allMatchEvents.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>⚽ No events yet</p></div>`;
    return;
  }
  const icons = { goal: '⚽', yellow_card: '🟨', red_card: '🟥', substitution: '🔄' };
  list.innerHTML = [...allMatchEvents].reverse().map(e => `
    <div class="match-event-item">
      <div class="event-minute">${e.minute}'</div>
      <div class="event-icon">${icons[e.type] || '⚽'}</div>
      <div class="event-desc">${e.type === 'goal' ? `GOAL! ${e.team}` : `${e.type} — ${e.team}`}</div>
    </div>`).join('');
}

// ─── Match Control ─────────────────────────────────────────────────────
async function matchControl(action) {
  const res = await fetch('/api/match/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
  const data = await res.json();
  if (data.success) {
    const statusEl = document.getElementById('ctrlStatus');
    if (statusEl) statusEl.innerText = data.data.status.replace(/_/g, ' ').toUpperCase();
  }
}

// ─── Venue Settings ────────────────────────────────────────────────────
async function updateVenueSettings() {
  const cap = document.getElementById('settingCapacity')?.value;
  if (!cap || isNaN(cap) || parseInt(cap) < 1000) {
    alert('Please enter a valid capacity (minimum 1000).');
    return;
  }
  const res = await fetch('/api/venue/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capacity: parseInt(cap) })
  });
  const data = await res.json();
  if (data.success) {
    showToast(`✅ Capacity updated to ${parseInt(cap).toLocaleString('en-IN')}!`);
  }
}

async function createManualAlert() {
  const type = document.getElementById('alertType')?.value || 'info';
  const msg = document.getElementById('alertMessage')?.value;
  if (!msg) { alert('Please enter an alert message.'); return; }
  await fetch('/api/alerts/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, message: msg, source: 'manual' })
  });
  if (document.getElementById('alertMessage')) document.getElementById('alertMessage').value = '';
  showToast('✅ Alert broadcast to all connected clients!');
}

// ─── Helpers ───────────────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function showToast(msg) {
  let toast = document.getElementById('venueToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'venueToast';
    toast.style.cssText = `
      position:fixed; bottom:28px; right:28px; background:#1c2230;
      border:1px solid rgba(68,147,248,0.4); color:#e6edf3;
      padding:14px 22px; border-radius:10px; font-size:0.9rem; font-weight:600;
      box-shadow:0 4px 20px rgba(0,0,0,0.5); z-index:9999;
      animation:fadeIn 0.3s ease; max-width:320px;
    `;
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ─── Menu Management ───────────────────────────────────────────────────
let menuItems = [];

async function fetchMenuItems() {
  try {
    const res = await fetch('/api/food/menu');
    const data = await res.json();
    menuItems = data.data || [];
    renderMenuManagement();
  } catch(e) { console.error('fetchMenuItems', e); }
}

function renderMenuManagement() {
  const list = document.getElementById('menuManagementList');
  if (!list) return;
  if (!menuItems.length) { list.innerHTML = '<div style="color:var(--text-muted)">No menu items yet.</div>'; return; }
  list.innerHTML = menuItems.map(item => `
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.5rem">${item.image}</span>
          <div>
            <div style="font-weight:600">${item.name}</div>
            <div style="font-size:0.75rem;color:#9ca3af">${item.category} · ₹${item.price} · ${item.prepTime}min</div>
          </div>
        </div>
        <span style="padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;background:${item.available ? '#10b981' : '#6b7280'};color:#fff">
          ${item.available ? 'Available' : 'Unavailable'}
        </span>
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="toggleMenuItem('${item.id}')" class="btn ${item.available ? 'btn-warning' : 'btn-success'}" style="flex:1;padding:6px;font-size:0.8rem">
          ${item.available ? '⛔ Mark Unavailable' : '✅ Mark Available'}
        </button>
        <button onclick="deleteMenuItem('${item.id}')" class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem">🗑️</button>
      </div>
    </div>`).join('');
}

async function addMenuItem() {
  const name = document.getElementById('menuItemName')?.value?.trim();
  const price = document.getElementById('menuItemPrice')?.value;
  const category = document.getElementById('menuItemCategory')?.value;
  const prepTime = document.getElementById('menuItemPrepTime')?.value || 5;
  const image = document.getElementById('menuItemEmoji')?.value?.trim() || '🍽️';
  if (!name || !price || !category) return showToast('Please fill all required fields');

  const res = await fetch('/api/food/menu/add', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, price, category, prepTime, image })
  });
  const data = await res.json();
  if (data.success) {
    menuItems.push(data.data);
    renderMenuManagement();
    // Clear form
    ['menuItemName','menuItemPrice','menuItemPrepTime','menuItemEmoji'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    showToast(`✅ "${name}" added to menu`);
  } else {
    showToast(data.error || 'Failed to add item');
  }
}

async function toggleMenuItem(id) {
  const res = await fetch(`/api/food/menu/${id}/toggle`, { method:'POST' });
  const data = await res.json();
  if (data.success) {
    const item = menuItems.find(m => m.id === id);
    if (item) item.available = data.data.available;
    renderMenuManagement();
    showToast(`"${data.data.name}" marked ${data.data.available ? 'available' : 'unavailable'}`);
  }
}

async function deleteMenuItem(id) {
  if (!confirm('Remove this item from the menu?')) return;
  const res = await fetch(`/api/food/menu/${id}`, { method:'DELETE' });
  const data = await res.json();
  if (data.success) {
    menuItems = menuItems.filter(m => m.id !== id);
    renderMenuManagement();
    showToast(`"${data.data.name}" removed`);
  }
}

// Listen for menu changes from socket (other staff updated menu)
socket.on('menu_update', updated => {
  menuItems = updated;
  renderMenuManagement();
});

// Fetch menu on load
fetchMenuItems();

// ─── QR Scanner (Pickup Confirmation) ─────────────────────────────────
let scannerStream = null;
let scannerInterval = null;

async function startScanner() {
  const video = document.getElementById('scannerVideo');
  const placeholder = document.getElementById('scannerPlaceholder');
  const overlay = document.getElementById('scannerOverlay');
  const btn = document.getElementById('startScanBtn');

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scannerStream;
    video.style.display = 'block';
    placeholder.style.display = 'none';
    overlay.style.display = 'block';
    if (btn) { btn.innerText = '🔴 Camera Active'; btn.disabled = true; }

    // Note: Real QR scanning requires a library like jsQR.
    // Here we set up the canvas loop to demonstrate the scanning UI.
    const canvas = document.getElementById('scannerCanvas');
    const ctx = canvas.getContext('2d');
    scannerInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // In production: imageData → jsQR(imageData.data, width, height) → code.data
      }
    }, 500);
    showToast('📷 Camera started. Use manual entry below to confirm orders.');
  } catch(e) {
    showToast('Camera access denied. Please use manual entry.');
    placeholder.innerHTML = '<span style="font-size:2.5rem">🚫</span><span style="color:#ef4444">Camera access denied</span>';
  }
}

function stopScanner() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  clearInterval(scannerInterval);
  const video = document.getElementById('scannerVideo');
  const placeholder = document.getElementById('scannerPlaceholder');
  const overlay = document.getElementById('scannerOverlay');
  const btn = document.getElementById('startScanBtn');
  if (video) video.style.display = 'none';
  if (placeholder) { placeholder.style.display = 'flex'; placeholder.innerHTML = '<span style="font-size:3rem">📷</span><span>Camera stopped</span>'; }
  if (overlay) overlay.style.display = 'none';
  if (btn) { btn.innerText = '📷 Start Camera'; btn.disabled = false; }
}

async function scanManualQR() {
  const input = document.getElementById('manualQrInput');
  const qrCode = input?.value?.trim();
  if (!qrCode) return showToast('Please enter a QR / pickup code');

  const resultDiv = document.getElementById('scanResult');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<span style="color:#9ca3af">⏳ Verifying...</span>';
  resultDiv.style.background = 'rgba(255,255,255,0.04)';

  try {
    const res = await fetch('/api/orders/scan-pickup', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ qrCode })
    });
    const data = await res.json();

    if (data.success) {
      const order = data.data;
      resultDiv.style.background = 'rgba(16,185,129,0.1)';
      resultDiv.style.border = '1px solid rgba(16,185,129,0.4)';
      resultDiv.innerHTML = `
        <div style="color:#10b981;font-weight:700;font-size:1.1rem;margin-bottom:8px">✅ Order Confirmed & Delivered</div>
        <div style="color:#d1d5db;font-size:0.9rem">
          <div><strong>Order:</strong> ${order.id}</div>
          <div><strong>Items:</strong> ${(order.items||[]).map(i=>`${i.name} x${i.qty}`).join(', ')}</div>
          <div><strong>Seat:</strong> ${order.seat} · ${order.zone?.toUpperCase()}</div>
          <div><strong>Total:</strong> ₹${order.total}</div>
          <div style="margin-top:6px;color:#10b981">${data.message || 'Delivered!'}</div>
        </div>`;
      if (input) input.value = '';
      showToast(`✅ Order ${order.id} delivered!`);
      // Refresh orders panel in background
      fetchOrders();
    } else {
      resultDiv.style.background = 'rgba(239,68,68,0.08)';
      resultDiv.style.border = '1px solid rgba(239,68,68,0.3)';
      const preparing = data.data?.status === 'preparing';
      resultDiv.innerHTML = `
        <div style="color:#ef4444;font-weight:700;margin-bottom:6px">
          ${preparing ? '⏳ Not Ready Yet' : '❌ Scan Failed'}
        </div>
        <div style="color:#d1d5db;font-size:0.9rem">
          ${preparing
            ? `Order <strong>${data.data.id}</strong> is still being prepared. Ask attendee to wait.`
            : (data.error || 'Invalid or unknown QR code.')}
        </div>`;
      showToast(data.error || 'QR verification failed');
    }
  } catch(e) {
    resultDiv.innerHTML = '<span style="color:#ef4444">Network error. Please retry.</span>';
    showToast('Network error');
  }
}

