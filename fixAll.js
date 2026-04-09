const fs = require('fs');

// --- 1. Fix server.js ---
try {
  let serverCode = fs.readFileSync('server.js', 'utf8');

  if (!serverCode.includes('/api/orders/scan-pickup')) {
    const scanPickupRoute = `
app.post('/api/orders/scan-pickup', (req, res) => {
  const { qrCode } = req.body;
  // Match QR with Order ID
  const order = orders.find(o => o.id === qrCode);
  if (order) {
    order.status = 'delivered';
    if(typeof syncOrder === 'function') syncOrder(order);
    io.emit('order_update', order);
    return res.json({ success: true, data: order });
  }
  return res.status(404).json({ success: false, error: 'Invalid QR code or Order not found' });
});
`;
    // Insert it before the Catch-all / Routing handler or just before app.get('/api/alerts')
    serverCode = serverCode.replace(/\/\/ --- Alerts ---/, scanPickupRoute + '\n// --- Alerts ---');
    fs.writeFileSync('server.js', serverCode);
    console.log("✅ Patched server.js with /api/orders/scan-pickup");
  } else {
    console.log("⚠️ /api/orders/scan-pickup already exists in server.js");
  }
} catch (e) {
  console.error("Error patching server.js:", e);
}

// --- 2. Fix dashboard.js ---
try {
  let dashCode = fs.readFileSync('public/js/dashboard.js', 'utf8');

  if (!dashCode.includes('function applyMatchConfig()')) {
    const dashboardFixes = `

// --- INJECTED MATCH CONTROLS FIXES ---
const sportLabels = {
    football: '⚽ Football', epl: '⚽ Premier League',
    cricket: '🏏 Cricket Test', t20: '🏏 T20 / IPL', ipl: '🏏 IPL',
    basketball: '🏀 Basketball', nba: '🏀 NBA Finals',
    volleyball: '🏐 Volleyball', tennis: '🎾 Tennis Grand Slam',
    kabaddi: '🤸 Pro Kabaddi', hockey: '🏑 Field Hockey'
};

function updateStadium() { }

function updateSport() {
  const sport = document.getElementById('sportSelect')?.value;
  if (sport) currentSport = sport;
}

async function applyMatchConfig() {
  const teamA = document.getElementById('teamAName')?.value || 'Team A';
  const teamB = document.getElementById('teamBName')?.value || 'Team B';
  const sport = document.getElementById('sportSelect')?.value || 'football';
  const stadium = document.getElementById('stadiumSelect')?.value || 'metastadium';
  currentSport = sport;

  try {
    const res = await fetch('/api/match/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamA, teamB, sport, stadium })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Match Configuration successfully updated!');
    }
  } catch (e) { }
}

function adjustScore(team, delta) {
  const el = document.getElementById(team + 'ScoreInput');
  if (el) {
    let val = parseInt(el.value) || 0;
    val = Math.max(0, val + delta);
    el.value = val;
  }
}

async function pushManualScore() {
  const homeScore = document.getElementById('homeScoreInput')?.value || 0;
  const awayScore = document.getElementById('awayScoreInput')?.value || 0;
  try {
    const res = await fetch('/api/match/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeScore, awayScore, sport: currentSport })
    });
    if (res.ok) {
      showToast('✅ Live Score forcefully updated to attendees!');
    }
  } catch (e) { }
}
`;
    // safely append to end
    fs.appendFileSync('public/js/dashboard.js', dashboardFixes);
    console.log("✅ Appended missing functions to public/js/dashboard.js");
  } else {
    console.log("⚠️ applyMatchConfig already exists in dashboard.js");
  }
} catch (e) {
  console.error("Error patching dashboard.js:", e);
}
