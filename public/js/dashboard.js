/**
 * VenueAI — Staff Command Center Dashboard JS
 * Full rewrite: Stadium dropdown, Sport types, Manual score,
 * AI weather + match intelligence, CCTV webcam, QR scanner
 */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────
// ─── State ────────────────────────────────────────────────────────────
let densityChart = null;
let allStaff = [];
let allOrders = [];
let allAlerts = [];
let allMatchEvents = [];
let menuItems = [];
let currentStaffFilter = 'all';
let currentAlertFilter = 'all';
let unreadAlerts = 0;
let venueState = null;
let matchState = { homeScore: 0, awayScore: 0, status: 'pre_match', minute: 0 };
let currentSport = 'cricket';
let currentStadium = localStorage.getItem('dash_stadium_id');
let scannerStream = null;
let scannerInterval = null;
let recentScansLog = [];
let weatherData = null;

// ─── Boot ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStadiumsForLogin();
  
  if (currentStadium) {
    loginToStadium(currentStadium);
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      // Auto trigger relevant actions based on the input id
      const id = e.target.id;
      if (id === 'manualQrInput') processManualQr();
      if (id === 'teamAName' || id === 'teamBName') applyMatchConfig();
      if (id === 'homeScoreInput' || id === 'awayScoreInput') pushManualScore();
    }
  });

  setInterval(updateTime, 1000);
  updateTime();
  initCharts();
  fetchStaff();
  fetchOrders();
  loadInitialAlerts();
  fetchMenuItems();
  fetchWeather();
  setInterval(fetchWeather, 60000);     // refresh weather every 60s
  setInterval(runAIAnalysis, 3000);     // AI analysis every 3s
  setInterval(updateMatchMinute, 60000); // match minute every 60s
});

async function loadStadiumsForLogin() {
  try {
    const res = await fetch('/api/stadiums');
    const data = await res.json();
    if (data.success) {
      const select = document.getElementById('loginStadiumSelect');
      const dashSelect = document.getElementById('stadiumSelect');
      const options = data.data.map(s => `<option value="${s.id}">${s.sport.toUpperCase()}: ${s.name}, ${s.city}</option>`).join('');
      if (select) select.innerHTML = `<option value="">-- Select Stadium --</option>` + options;
      if (dashSelect) dashSelect.innerHTML = options;
    }
  } catch (e) {
    console.error("Failed to load stadiums for login.");
  }
}

function loginToStadium(sid) {
  const selectedId = sid || document.getElementById('loginStadiumSelect').value;
  if (!selectedId) {
     alert("Please select a stadium to manage.");
     return;
  }
  
  currentStadium = selectedId;
  localStorage.setItem('dash_stadium_id', selectedId);
  
  // Join Room
  socket.emit('join_stadium', selectedId);
  
  // UI Transition
  const overlay = document.getElementById('dashboardLogin');
  if (overlay) overlay.style.display = 'none';
  
  // Trigger initial fetch
  fetchMatchState();
}

// ─── Time ──────────────────────────────────────────────────────────────
function updateTime() {
  const el = document.getElementById('topbarTime');
  if (el) el.innerText = new Date().toLocaleTimeString('en-IN', { hour12: true });
}

// ─── Match minute ticker ───────────────────────────────────────────────
function updateMatchMinute() {
  if (matchState.status === 'first_half' || matchState.status === 'second_half') {
    matchState.minute = (matchState.minute || 0) + 1;
    setText('ctrlMinute', `${matchState.minute}'`);
  }
}

// ─── Weather Fetch (Open-Meteo, free, no key) ─────────────────────────
async function fetchWeather() {
  try {
    // Default: Mumbai, India. Using Open-Meteo free API
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=19.0760&longitude=72.8777&current_weather=true&hourly=relativehumidity_2m,precipitation_probability&forecast_days=1');
    const data = await res.json();
    const cw = data.current_weather;
    const temp = cw.temperature;
    const wind = cw.windspeed;
    const wcode = cw.weathercode;
    const humidity = data.hourly.relativehumidity_2m[0] || '--';
    const rainChance = data.hourly.precipitation_probability[0] || 0;

    const { icon, desc } = decodeWMO(wcode);
    weatherData = { temp, wind, humidity, rainChance, icon, desc };

    // Top bar
    setText('weatherIcon', icon);
    setText('weatherTemp', `${temp}°C`);
    setText('weatherDesc', desc);

    // Weather panel
    setText('weatherBigIcon', icon);
    setText('weatherBigTemp', `${temp}°C`);
    setText('weatherBigDesc', desc);
    setText('weatherHumidity', `${humidity}%`);
    setText('weatherWind', `${wind} km/h`);
    setText('weatherRain', `${rainChance}%`);

    // AI weather impact
    let impact = 'Low Risk';
    let impactColor = 'var(--emerald)';
    if (rainChance > 60) { impact = '⚠️ Rain Likely — Cover Alert'; impactColor = 'var(--red-hot)'; }
    else if (rainChance > 30) { impact = '🌧 Light Rain Possible'; impactColor = 'var(--amber)'; }
    else if (temp > 38) { impact = '🌡️ Heat Advisory — Hydrate Staff'; impactColor = 'var(--amber)'; }
    else if (wind > 35) { impact = '💨 High Wind — Check Banners'; impactColor = 'var(--amber)'; }

    setText('weatherImpact', impact);
    const aiWeatherEl = document.getElementById('aiWeatherImpact');
    if (aiWeatherEl) { aiWeatherEl.innerText = impact; aiWeatherEl.style.color = impactColor; }
  } catch (e) {
    setText('weatherDesc', 'Weather unavailable');
  }
}

function decodeWMO(code) {
  if (code === 0) return { icon: '☀️', desc: 'Clear Sky' };
  if (code <= 3) return { icon: '🌤️', desc: 'Partly Cloudy' };
  if (code <= 9) return { icon: '🌫️', desc: 'Foggy' };
  if (code <= 19) return { icon: '🌦️', desc: 'Drizzle' };
  if (code <= 29) return { icon: '🌧️', desc: 'Rain' };
  if (code <= 39) return { icon: '❄️', desc: 'Snow' };
  if (code <= 49) return { icon: '🌫️', desc: 'Fog' };
  if (code <= 59) return { icon: '🌦️', desc: 'Drizzle' };
  if (code <= 69) return { icon: '🌧️', desc: 'Rain' };
  if (code <= 79) return { icon: '❄️', desc: 'Snow Grains' };
  if (code <= 82) return { icon: '🌧️', desc: 'Rain Showers' };
  if (code <= 84) return { icon: '🌨️', desc: 'Snow Showers' };
  if (code <= 94) return { icon: '⛈️', desc: 'Thunderstorm' };
  return { icon: '⛈️', desc: 'Thunderstorm + Hail' };
}

// ─── AI Analysis Engine ───────────────────────────────────────────────
function runAIAnalysis() {
  const preparing = allOrders.filter(o => o.status === 'preparing').length;
  const home = matchState.homeScore;
  const away = matchState.awayScore;
  const minute = matchState.minute || 0;
  const status = matchState.status;

  // Momentum
  let momentum = 'Even Match';
  if (home > away + 1) momentum = `🔵 ${document.getElementById('ctrlTeamA')?.innerText || 'Team A'} dominating`;
  else if (away > home + 1) momentum = `🔴 ${document.getElementById('ctrlTeamB')?.innerText || 'Team B'} dominating`;
  else if (home === away && minute > 70) momentum = '⚡ Tense — Could go either way!';
  setText('aiMomentum', momentum);

  // Crowd reaction
  let reaction = 'Calm & Settled';
  if (home + away > 3) reaction = '🔥 Electric! High scoring match';
  else if (minute > 80 && Math.abs(home - away) <= 1) reaction = '😰 Nail-biting tension!';
  else if (status === 'halftime') reaction = '🍔 Concession rush!';
  setText('aiCrowdReaction', reaction);

  // AI alert
  let alert = 'All systems normal ✅';
  if (preparing > 15) alert = `⚠️ ${preparing} orders in queue! Dispatch needed`;
  else if (weatherData?.rainChance > 60) alert = '🌧 Rain likely — alert attendees';
  else if (minute > 80 && status === 'second_half') alert = '📣 Pre-exit crowd management soon';
  setText('aiAlert', alert);

  // Weather Impact AI
  let wImpact = '✅ Low Risk (Good)';
  if((weatherData?.rainChance || 0) > 50) wImpact = '🌧️ High Risk (Rain)';
  else if((weatherData?.temp || 0) > 35) wImpact = '🔥 High Heat Risk';
  else if((weatherData?.temp || 0) < 5) wImpact = '❄️ Frost Risk';
  setText('aiWeatherImpact', wImpact);


  // Predicted winner
  let pred = 'Too early to predict';
  if (status === 'pre_match' || status === 'reset') pred = 'Match hasn\'t started';
  else if (home > away && minute > 60) pred = `🔵 ${document.getElementById('ctrlTeamA')?.innerText || 'Team A'} — strong lead`;
  else if (away > home && minute > 60) pred = `🔴 ${document.getElementById('ctrlTeamB')?.innerText || 'Team B'} — strong lead`;
  else pred = '🤝 Draw predicted at full time';
  const pw = document.getElementById('aiPredWinner');
  if (pw) pw.innerText = pred;

  // Excitement level
  const excitement = home + away > 4 ? '🔥🔥🔥 INSANE' :
                     home + away > 2 ? '🔥🔥 High' :
                     home + away > 0 ? '🔥 Moderate' : '😐 Pre-match calm';
  const ex = document.getElementById('aiExcitement');
  if (ex) ex.innerText = excitement;

  // Next key moment
  const sportMoments = {
    cricket: ['Next wicket predicted in ~2 overs', 'Batting powerplay incoming', 'Strategic timeout expected'],
    football: ['Corner kick opportunity', 'Substitution window approaching', 'Set piece situation developing'],
    basketball: ['Timeout expected', 'Quarter break soon', 'Fast break opportunity'],
    volleyball: ['Set point approaching', 'Rally likely to continue', 'Serving pressure building'],
  };
  const moments = sportMoments[currentSport] || sportMoments.football;
  const nm = document.getElementById('aiNextMoment');
  if (nm) nm.innerText = moments[Math.floor(Date.now() / 10000) % moments.length];
}

// ─── Stadium & Sport Config ────────────────────────────────────────────
const sportIcons = {
  cricket: '🏏', football: '⚽', basketball: '🏀', volleyball: '🏐', kabaddi: '🤸', hockey: '🏑'
};
const sportLabels = {
  cricket: 'Cricket Match', football: 'Football / Soccer',
  basketball: 'Basketball Game', volleyball: 'Volleyball Match',
  kabaddi: 'Kabaddi Match', hockey: 'Hockey Match'
};
const sportControlLabels = {
  cricket: ['Start Innings', 'Drinks Break', '2nd Innings', 'Match Over', 'Reset'],
  football: ['Kick Off', 'Half Time', '2nd Half', 'Full Time', 'Reset'],
  basketball: ['Tip Off', 'Half Time', '2nd Half', 'Final Buzzer', 'Reset'],
  volleyball: ['Serve', 'Set Break', '3rd Set', 'Match Point', 'Reset'],
  kabaddi: ['Start', 'Half Time', '2nd Half', 'End', 'Reset'],
  hockey: ['Kick Off', 'Half Time', '2nd Half', 'Full Time', 'Reset'],
};

function updateStadium() {
  const select = document.getElementById('stadiumSelect');
  if(!select) return;
  currentStadium = select.value || 'metastadium';
  
  // Real-world Auto-detection of Sport type from Tournament
  const tournamentSportMap = {
    ipl: 'cricket', t20: 'cricket',
    epl: 'football', football: 'football',
    nba: 'basketball', tennis: 'tennis',
    volleyball: 'volleyball', kabaddi: 'kabaddi', hockey: 'hockey'
  };
  
  if (tournamentSportMap[currentStadium]) {
    const sportSelect = document.getElementById('sportSelect');
    if (sportSelect) {
      sportSelect.value = tournamentSportMap[currentStadium];
      updateSport(); // Switch controls immediately
    }
  }

  showToast(`🏟️ Stadium updated to ${select.options[select.selectedIndex]?.text}`);
  applyMatchConfig(); 
}

function updateSport() {
  currentSport = document.getElementById('sportSelect')?.value || 'football';
  const icon = sportIcons[currentSport] || '🏆';
  // Update match label
  const label = document.getElementById('matchSportLabel');
  if (label) label.innerText = `${icon} ${sportLabels[currentSport]} Scoreboard`;
  // Update control buttons
  const labels = sportControlLabels[currentSport] || sportControlLabels.football;
  const actions = ['start', 'halftime', 'second_half', 'end', 'reset'];
  const container = document.getElementById('matchControlBtns');
  if (container) {
    container.innerHTML = labels.map((l, i) => {
      const cls = i === 3 ? 'btn-danger' : i === 0 ? 'btn-success' : 'btn-primary';
      return `<button class="btn ${cls}" onclick="matchControl('${actions[i]}')">${icon} ${l}</button>`;
    }).join('');
  }
  showToast(`${icon} Sport set to ${sportLabels[currentSport]}`);
}

function applyMatchConfig() {
  const teamA = document.getElementById('teamAName')?.value || 'Team A';
  const teamB = document.getElementById('teamBName')?.value || 'Team B';
  setText('ctrlTeamA', teamA);
  setText('ctrlTeamB', teamB);
  setText('topTeamHome', `${sportIcons[currentSport] || '🔵'} ${teamA}`);
  setText('topTeamAway', `${teamB} 🔴`);
  setText('teamAIcon', sportIcons[currentSport] || '🔵');
  setText('teamBIcon', '🔴');
  updateSport();
  showToast(`✅ Match config applied — ${teamA} vs ${teamB}`);
  // Push to server
  fetch('/api/match/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamA, teamB, sport: currentSport, stadiumId: currentStadium })
  }).catch(() => {});
}

// ─── Manual Score Control ─────────────────────────────────────────────
function incrementScore(inputId, delta) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const newVal = Math.max(0, parseInt(el.value || 0) + delta);
  el.value = newVal;

  // Optimistically update local state so socket broadcast doesn't overwrite it
  if (inputId === 'homeScoreInput') matchState.homeScore = newVal;
  if (inputId === 'awayScoreInput') matchState.awayScore = newVal;
}

async function pushManualScore() {
  const home = parseInt(document.getElementById('homeScoreInput')?.value || 0);
  const away = parseInt(document.getElementById('awayScoreInput')?.value || 0);
  matchState.homeScore = home;
  matchState.awayScore = away;

  setText('ctrlHomeScore', home);
  setText('ctrlAwayScore', away);
  setText('topScore', `${home} : ${away}`);

  try {
    await fetch('/api/match/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeScore: home, awayScore: away, sport: currentSport, stadiumId: currentStadium })
    });
    showToast(`✅ Score pushed — ${home} : ${away}`);
  } catch (e) {
    // Emit via socket if API not available
    socket.emit('admin_score_update', { homeScore: home, awayScore: away });
    showToast('📡 Score updated via socket');
  }
}

async function matchControl(action) {
  try {
    await fetch('/api/match/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, stadiumId: currentStadium })
    });
    showToast(`✅ Match state updated: ${action.toUpperCase()}`);
  } catch (e) {
    showToast('Failed to change match state', 'danger');
  }
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
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.08)',
        tension: 0.4, fill: true, pointRadius: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true, suggestedMax: 60000,
          ticks: { color: '#8b7355', font: { size: 11 }, callback: v => (v/1000).toFixed(0)+'k' },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        x: { display: false }
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
    overview: ['Overview', 'Real-time venue monitoring'],
    crowd: ['Crowd Monitor', 'Zone density & heatmap'],
    orders: ['Food Orders', 'Live order queue management'],
    staff: ['Staff Dispatch', 'Deploy & manage field staff'],
    alerts: ['Alert Center', 'All venue alerts'],
    cameras: ['Live CCTV', 'AI-powered crowd detection'],
    match: ['Match Control', 'Score, stadium & AI intelligence'],
    menu: ['Menu Management', 'Add, toggle & remove items'],
    scanner: ['QR Scanner', 'Order pickup confirmation'],
    settings: ['Settings', 'Venue & broadcast configuration'],
  };
  const [t, s] = titles[panelId] || ['Dashboard', ''];
  setText('panelTitle', t);
  setText('panelSubtitle', s);

  if (panelId === 'staff') fetchStaff();
  if (panelId === 'orders') fetchOrders();
  if (panelId === 'menu') fetchMenuItems();
  if (panelId === 'cameras') startWebcam();
}

// ─── WEBCAM CCTV ───────────────────────────────────────────────────────
async function startWebcam() {
  const video = document.getElementById('webcamFeed');
  const placeholder = document.getElementById('webcamPlaceholder');
  if (video.srcObject) return; // avoid re-starting
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    video.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    // Simulated AI density readings
    if (!window.webcamInterval) {
      window.webcamInterval = setInterval(() => {
        const count = Math.floor(Math.random() * 80 + 20);
        setText('webcamAI', `AI: ${count}p · ${count > 60 ? 'HIGH' : count > 35 ? 'MED' : 'LOW'}`);
        const badge = document.getElementById('webcamDensity');
        if (badge) {
          badge.className = `cctv-crowd-badge ${count > 60 ? 'high' : count > 35 ? 'medium' : 'low'}`;
          badge.innerText = count > 60 ? '🔴 High' : count > 35 ? '🟡 Medium' : '🟢 Low';
        }
      }, 2000);
    }
  } catch (e) {
    if (placeholder) placeholder.innerHTML = '<span style="font-size:2rem">🚫</span><span style="color:#f87171;font-size:0.85rem;">Camera access denied</span>';
    showToast('Camera access denied. Check browser permissions.');
  }
}

function openCctvModal(title, source) {
  const modal = document.getElementById('cctvModal');
  const modalTitle = document.getElementById('cctvModalTitle');
  const modalVideo = document.getElementById('cctvModalVideo');
  if (!modal || !modalVideo) return;
  modalTitle.innerText = `CCTV FEED: ${title}`;
  modalVideo.src = source;
  modal.style.display = 'flex';
}

function closeCctvModal() {
  const modal = document.getElementById('cctvModal');
  const modalVideo = document.getElementById('cctvModalVideo');
  if (modal) modal.style.display = 'none';
  if (modalVideo) modalVideo.src = "";
}

// ─── Socket: Venue Update ──────────────────────────────────────────────
socket.on('venue_update', data => {
  venueState = data;
  setText('kpiAttendance', data.totalAttendance.toLocaleString('en-IN'));
  const pct = ((data.totalAttendance / data.capacity) * 100).toFixed(1);
  setText('kpiAttendancePct', `${pct}% capacity`);
  const avgWait = data.concessions.reduce((a, c) => a + c.queue_time, 0) / data.concessions.length;
  setText('kpiWaitTime', avgWait.toFixed(1));

  if (densityChart) {
    densityChart.data.labels.push(new Date().toLocaleTimeString());
    densityChart.data.datasets[0].data.push(data.totalAttendance);
    if (densityChart.data.labels.length > 40) {
      densityChart.data.labels.shift();
      densityChart.data.datasets[0].data.shift();
    }
    densityChart.update();
  }

  renderZoneBars(data.zones, data.capacity);
  renderGateFlow(data.gates);
  renderConcessionList(data.concessions);
  renderCrowdPanel(data);
});

// ─── Google AI Sync ───────────────────────────────────────────────────
async function fetchMatchState() {
  try {
    const res = await fetch(`/api/match?stadiumId=${currentStadium || 'hyderabad_stadium'}`);
    const data = await res.json();
    if (data.success) {
       matchState = data.data;
       socket.emit('join_stadium', currentStadium || 'hyderabad_stadium');
    }
  } catch (e) { console.error("Initial match fetch failed"); }
}

async function toggleWorldSync() {
  const newState = !matchState.worldSyncMode;
  try {
    const res = await fetch('/api/match/sync', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ enabled: newState, stadiumId: currentStadium })
    });
    const d = await res.json();
    matchState.worldSyncMode = d.enabled;
    showToast(d.enabled ? '🌍 Google AI Sync ACTIVATED' : '⭕ Google AI Sync DISABLED');
  } catch(e) { showToast('❌ Sync error'); }
}

// ─── Socket: Match Update ──────────────────────────────────────────────
socket.on('match_update', data => {
  matchState = { ...matchState, ...data };
  
  // Update Sync UI
  const syncBtn = document.getElementById('syncToggleBtn');
  const syncInd = document.getElementById('syncIndicator');
  if (syncBtn) {
    syncBtn.innerText = data.worldSyncMode ? 'DEACTIVATE ⏹' : 'ACTIVATE 🤖';
    syncBtn.style.background = data.worldSyncMode ? '#666' : '#db4437';
  }
  if (syncInd) {
    const syncText = data.worldSyncMode 
      ? `Syncing: ${data.homeTeam} vs ${data.awayTeam} @ ${data.stadiumName} (Google AI)`
      : 'Agent Idle';
    syncInd.innerText = syncText;
    syncInd.style.color = data.worldSyncMode ? '#4285f4' : 'var(--text-muted)';
  }

  const hScore = data.sport === 'cricket' ? `${data.homeScore}/${data.homeWickets}` : data.homeScore;
  const aScore = data.sport === 'cricket' ? `${data.awayScore}/${data.awayWickets}` : data.awayScore;

  setText('topScore', `${hScore} : ${aScore}`);
  
  let statusText = data.status.replace(/_/g, ' ').toUpperCase();
  if (data.minute > 0) statusText = `${data.minute}' | ${statusText}`;
  if (data.target > 0 && data.status === 'second_half') statusText += ` (TARGET: ${data.target})`;
  
  setText('topStatus', statusText);
  setText('ctrlHomeScore', hScore);
  setText('ctrlAwayScore', aScore);
  setText('ctrlStatus', data.status.replace(/_/g, ' ').toUpperCase());
  setText('ctrlMinute', data.minute > 0 ? `${data.minute}'` : '—');
  
  // FIXED: Update Team Names, Sport, and Stadium from backend broadcast
  setText('ctrlTeamA', data.homeTeam);
  setText('ctrlTeamB', data.awayTeam);
  
  // Cricket Bat/Bowl Icons Role Management (SWAP AFTER 1ST INNINGS)
  let iconA = (typeof sportIcons !== 'undefined' && sportIcons[data.sport]) ? sportIcons[data.sport] : '⚽';
  let iconB = '🔴';
  if (data.sport === 'cricket') {
    if (data.battingTeam === 'home') { iconA = '🏏'; iconB = '⚾'; }
    else { iconA = '⚾'; iconB = '🏏'; }
  }

  setText('topTeamHome', `${iconA} ${data.homeTeam}`);
  setText('topTeamAway', `${data.awayTeam} ${iconB}`);
  setText('teamAIcon', iconA);
  setText('teamBIcon', iconB);
  


  const hi = document.getElementById('homeScoreInput');
  const ai = document.getElementById('awayScoreInput');
  const ss = document.getElementById('sportSelect');
  const stSelect = document.getElementById('stadiumSelect');
  const tAName = document.getElementById('teamAName');
  const tBName = document.getElementById('teamBName');

  if (ss) ss.disabled = data.worldSyncMode;
  if (stSelect) stSelect.disabled = data.worldSyncMode;
  if (tAName) tAName.disabled = data.worldSyncMode;
  if (tBName) tBName.disabled = data.worldSyncMode;
  
  // Set stadium selection based on Agent response if active
  if (data.worldSyncMode && stSelect) {
     stSelect.value = data.stadium;
  }
  const sts = document.getElementById('stadiumSelect');

  // Input fields are now NEVER overwritten by the socket heartbeat to prevent 'snapping back'
  // Labels (topScore, etc.) above still update to show the current server-side reality.

  if (data.events && data.events.length > allMatchEvents.length) {
    allMatchEvents = data.events;
    renderMatchEvents();
  }
});

socket.on('alerts_init', alerts => { allAlerts = alerts; renderAllAlerts(); });
socket.on('alert', alert => {
  allAlerts.unshift(alert);
  unreadAlerts++;
  const badge = document.getElementById('alertBadge');
  if (badge) badge.innerText = unreadAlerts;
  appendAlertToOverview(alert);
  renderAllAlerts();
  refreshOrderKPIs();
});
const staffLocks = {};
socket.on('staff_update', updated => {
  // If we just manually sent a command, ignore server updates for 2 seconds to prevent flickering
  if (staffLocks[updated.id] && Date.now() < staffLocks[updated.id]) return;
  
  const idx = allStaff.findIndex(s => s.id === updated.id);
  if (idx >= 0) allStaff[idx] = updated;
  renderStaffGrid();
});
socket.on('new_order', () => fetchOrders());
socket.on('order_update', () => fetchOrders());
socket.on('menu_update', updated => { menuItems = updated; renderMenuManagement(); });

// ─── Render: Zone Bars ─────────────────────────────────────────────────
function renderZoneBars(zones, cap) {
  const container = document.getElementById('zoneBars');
  if (!container) return;
  container.innerHTML = zones.map(z => {
    const pct = Math.min(100, (z.current / z.capacity) * 100);
    const color = pct > 85 ? 'var(--red-hot)' : pct > 55 ? 'var(--amber)' : 'var(--emerald)';
    return `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:0.83rem;margin-bottom:5px;">
          <span style="font-weight:700;color:var(--walnut-cream)">${z.name}</span>
          <span style="color:var(--text-muted)">${z.current.toLocaleString('en-IN')} / ${z.capacity.toLocaleString('en-IN')}</span>
        </div>
        <div style="width:100%;height:8px;background:rgba(0,0,0,0.5);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.5s;box-shadow:0 0 8px ${color};"></div>
        </div>
        <div style="text-align:right;font-size:0.72rem;color:${color};margin-top:3px;font-weight:900;">${pct.toFixed(0)}%</div>
      </div>`;
  }).join('');
}

// ─── Render: Gate Flow ─────────────────────────────────────────────────
function renderGateFlow(gates) {
  const container = document.getElementById('gateFlowList');
  if (!container) return;
  const maxFlow = Math.max(...gates.map(g => g.throughput), 1);
  container.innerHTML = gates.slice(0, 6).map(g => {
    const pct = Math.min(100, (g.current_flow / maxFlow) * 100);
    const color = g.queue_length > 100 ? 'var(--red-hot)' : g.queue_length > 30 ? 'var(--amber)' : 'var(--emerald)';
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:0.82rem;">
        <span style="min-width:70px;font-weight:700;color:var(--walnut-cream)">${g.name}</span>
        <div style="flex:1;height:6px;background:rgba(0,0,0,0.5);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;"></div>
        </div>
        <span style="color:${color};font-weight:700;min-width:60px;text-align:right;">${g.queue_length} q</span>
      </div>`;
  }).join('');
}

// ─── Render: Concession List ───────────────────────────────────────────
function renderConcessionList(concessions) {
  const container = document.getElementById('concessionList');
  if (!container) return;
  container.innerHTML = concessions.map(c => {
    const color = c.queue_time > 10 ? 'var(--red-hot)' : c.queue_time > 5 ? 'var(--amber)' : 'var(--emerald)';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed rgba(107,76,42,0.2);">
        <div>
          <div style="font-weight:700;font-size:0.85rem;color:var(--walnut-cream)">${c.name}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">${c.zone.toUpperCase()} · ${c.orders_pending} pending</div>
        </div>
        <div style="color:${color};font-weight:900;font-size:0.88rem;">${c.queue_time}m</div>
      </div>`;
  }).join('');
}

// ─── Render: Crowd Panel ───────────────────────────────────────────────
function renderCrowdPanel(data) {
  setText('crowdTotal', data.totalAttendance.toLocaleString('en-IN'));
  const pct = Math.min(100, (data.totalAttendance / data.capacity) * 100);
  setText('ringText', `${pct.toFixed(0)}%`);
  const ring = document.getElementById('ringProgress');
  if (ring) ring.style.strokeDashoffset = 327 - (327 * pct / 100);

  const zonesContainer = document.getElementById('crowdZonesDetail');
  if (zonesContainer) {
    zonesContainer.innerHTML = data.zones.map(z => {
      const zpct = Math.min(100, (z.current / z.capacity) * 100);
      const color = zpct > 85 ? 'var(--red-hot)' : zpct > 55 ? 'var(--amber)' : 'var(--emerald)';
      const label = zpct > 85 ? '🔴 Critical' : zpct > 55 ? '🟡 Busy' : '🟢 Normal';
      return `
        <div style="background:rgba(0,0,0,0.35);border:1px solid var(--border-color);border-radius:10px;padding:14px;">
          <div style="font-weight:900;color:var(--walnut-cream);margin-bottom:4px;">${z.name}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">${z.current.toLocaleString('en-IN')} / ${z.capacity.toLocaleString('en-IN')}</div>
          <div style="width:100%;height:8px;background:rgba(0,0,0,0.5);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${zpct}%;background:${color};border-radius:4px;transition:width 0.5s;"></div>
          </div>
          <div style="text-align:right;font-size:0.72rem;color:${color};margin-top:4px;font-weight:900;">${zpct.toFixed(0)}% — ${label}</div>
        </div>`;
    }).join('');
  }

  const heatmap = document.getElementById('heatmapGrid');
  if (heatmap && data.zones) {
    heatmap.innerHTML = data.zones.map(z => {
      const zpct = Math.min(100, (z.current / z.capacity) * 100);
      const alpha = 0.15 + (zpct / 100) * 0.7;
      const color = zpct > 85 ? `rgba(220,38,38,${alpha})` : zpct > 55 ? `rgba(245,158,11,${alpha})` : `rgba(5,150,105,${alpha})`;
      const icon = zpct > 85 ? '🔴' : zpct > 55 ? '🟡' : '🟢';
      return `
        <div style="background:${color};border-radius:10px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:1.4rem">${icon}</div>
          <div style="font-weight:900;font-size:0.85rem;color:var(--walnut-cream);margin-top:4px">${zpct.toFixed(0)}%</div>
          <div style="font-size:0.7rem;color:rgba(255,255,255,0.6);margin-top:2px">${z.name.split(' ')[0]}</div>
        </div>`;
    }).join('');
  }
}

// ─── Append alert to overview ──────────────────────────────────────────
function appendAlertToOverview(alert) {
  const feed = document.getElementById('alertFeedOverview');
  if (!feed) return;
  const typeIcon = { danger: '🔴', warning: '🟡', info: '🔵', success: '🟢' };
  const div = document.createElement('div');
  div.style.cssText = 'margin-bottom:6px;padding:8px;background:rgba(0,0,0,0.3);border-radius:8px;font-size:0.82rem;color:var(--walnut-cream);';
  div.innerText = `${typeIcon[alert.type] || '•'} ${alert.message}`;
  feed.insertBefore(div, feed.firstChild);
  if (feed.children.length > 10) feed.lastChild.remove();
}

// ─── Staff ─────────────────────────────────────────────────────────────
async function fetchStaff() {
  try {
    const res = await fetch(`/api/staff?stadiumId=${currentStadium}`);
    const data = await res.json();
    allStaff = data.data;
    renderStaffGrid();
  } catch (e) {}
}

function renderStaffGrid() {
  const grid = document.getElementById('staffGrid');
  if (!grid) return;
  const filtered = currentStaffFilter === 'all' ? allStaff : allStaff.filter(s => s.role === currentStaffFilter);
  setText('staffAvail', allStaff.filter(s => s.status === 'available').length);
  setText('staffDeployed', allStaff.filter(s => s.status !== 'available').length);

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><span>👷</span><p>No staff in this category</p></div>`;
    return;
  }
  const roleIcon = { security: '🛡️', service: '🤝', medical: '🏥' };
  grid.innerHTML = filtered.map(s => `
    <div class="staff-card">
      <div class="staff-card-top">
        <div class="staff-avatar">${roleIcon[s.role] || '👤'}</div>
        <div>
          <div class="staff-name">${s.name}</div>
          <div class="staff-role">${s.role}</div>
        </div>
      </div>
      <div class="staff-status">
        <div class="staff-dot ${s.status === 'available' ? 'available' : 'busy'}"></div>
        <span style="font-size:0.82rem;color:var(--walnut-cream);">${s.status}</span>
      </div>
      <div class="staff-location">📍 ${s.zone?.replace('_', ' ').toUpperCase() || 'Unassigned'}</div>
      ${s.currentTask ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">▶ ${s.currentTask}</div>` : ''}
      <div style="display:flex; gap:8px;">
        <button class="dispatch-btn" onclick="${s.status === 'available' ? `dispatchStaff('${s.id}')` : `releaseStaff('${s.id}')`}" style="flex:1;">
          ${s.status === 'available' ? '🚀 Dispatch' : '✅ Release'}
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteStaff('${s.id}')" style="padding:6px 10px;">🗑</button>
      </div>
    </div>`).join('');
}

function filterStaff(role) {
  currentStaffFilter = role;
  document.querySelectorAll('.staff-filter').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.staff-filter`).forEach(b => {
    if (b.getAttribute('onclick') === `filterStaff('${role}')`) b.classList.add('active');
  });
  renderStaffGrid();
}

async function addStaff() {
  const name = document.getElementById('newStaffName').value;
  const role = document.getElementById('newStaffRole').value;
  const zone = document.getElementById('newStaffZone').value;
  if (!name) { showToast('⚠️ Enter staff name'); return; }
  await fetch('/api/staff/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, role, zone, stadiumId: currentStadium })
  });
  document.getElementById('newStaffName').value = '';
  showToast('✅ Staff added');
  fetchStaff();
}

async function deleteStaff(id) {
  if (!confirm('Remove this staff member?')) return;
  await fetch(`/api/staff/${id}`, { method: 'DELETE' });
  showToast('🗑 Staff removed');
  fetchStaff();
}

async function dispatchStaff(id) {
  const zone = prompt('Zone to dispatch to (north/south/east/west/vip):', 'north');
  if (!zone) return;

  // Set local lock to prevent flickering while server processes
  staffLocks[id] = Date.now() + 2000;

  // Optimistic UI update
  const s = allStaff.find(st => st.id === id);
  if (s) {
    s.status = 'dispatched';
    s.zone = zone;
    s.currentTask = 'Manual dispatch';
    renderStaffGrid(); // Refresh UI immediately
  }

  await fetch(`/api/staff/${id}/dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone, task: 'Manual dispatch' })
  });
}

async function releaseStaff(id) {
  // Set local lock to prevent flickering while server processes
  staffLocks[id] = Date.now() + 2000;

  // Optimistic UI update
  const s = allStaff.find(st => st.id === id);
  if (s) {
    s.status = 'available';
    s.currentTask = null;
    renderStaffGrid(); // Refresh UI immediately
  }
  await fetch(`/api/staff/${id}/release`, { method: 'POST' });
}

// ─── Orders ────────────────────────────────────────────────────────────
async function fetchOrders() {
  try {
    const res = await fetch(`/api/food/orders?stadiumId=${currentStadium}`);
    const data = await res.json();
    allOrders = data.data;
    renderOrdersGrid();
    refreshOrderKPIs();
  } catch (e) {}
}

function refreshOrderKPIs() {
  const preparing = allOrders.filter(o => o.status === 'preparing').length;
  const ready = allOrders.filter(o => o.status === 'ready').length;
  const delivered = allOrders.filter(o => o.status === 'delivered').length;
  setText('ordersPending', preparing);
  setText('ordersReady', ready);
  setText('ordersDelivered', delivered);
  setText('kpiOrders', allOrders.length);
  const revenue = allOrders.reduce((s, o) => s + (o.total || 0), 0);
  setText('kpiRevenue', '₹' + revenue.toLocaleString('en-IN'));
  setText('ordersRevenue', '₹' + revenue.toLocaleString('en-IN'));
}

function renderOrdersGrid() {
  const grid = document.getElementById('ordersGrid');
  if (!grid) return;
  if (!allOrders.length) {
    grid.innerHTML = `<div class="empty-state"><span>📋</span><p>No orders yet.</p></div>`;
    return;
  }
  const sc = { preparing: 'preparing', ready: 'ready', delivered: 'delivered' };
  grid.innerHTML = allOrders.slice(0, 30).map(o => `
    <div style="background:rgba(0,0,0,0.3);border:1px solid var(--border-color);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:900;color:var(--amber);font-family:'Georgia',serif;">${o.id}</div>
        <span class="status-badge ${sc[o.status] || 'preparing'}">${o.status}</span>
      </div>
      <div style="font-size:0.8rem;color:var(--walnut-cream);">🪑 ${o.seat} · 📍 ${o.zone?.toUpperCase()} · ${o.concession}</div>
      <div style="font-size:0.8rem;color:var(--text-muted);">${(o.items || []).map(i => `${i.image || '🍽'} ${i.name} x${i.qty}`).join(' · ')}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
        <div style="font-weight:900;color:var(--walnut-cream)">₹${(o.total || 0).toLocaleString('en-IN')}</div>
        ${o.status === 'preparing' ? `<button class="btn btn-success btn-sm" onclick="completeOrder('${o.id}')">✅ Mark Ready</button>` : ''}
      </div>
    </div>`).join('');
}

async function completeOrder(id) {
  await fetch(`/api/food/orders/${id}/complete`, { method: 'POST' });
  fetchOrders();
}

// ─── Alerts ────────────────────────────────────────────────────────────
async function loadInitialAlerts() {
  try {
    const res = await fetch(`/api/alerts?stadiumId=${currentStadium}`);
    const data = await res.json();
    allAlerts = data.data;
    renderAllAlerts();
  } catch (e) {}
}

function renderAllAlerts() {
  const list = document.getElementById('alertsFullList');
  if (!list) return;
  const filtered = currentAlertFilter === 'all' ? allAlerts : allAlerts.filter(a => a.type === currentAlertFilter);
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span>🔔</span><p>No alerts</p></div>`;
    return;
  }
  const typeIcon = { danger: '🔴', warning: '🟡', info: '🔵', success: '🟢' };
  list.innerHTML = filtered.map(a => {
    const time = new Date(a.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="alert-row ${a.type} ${a.acknowledged ? 'acknowledged' : ''}">
        <div class="alert-icon">${typeIcon[a.type] || '•'}</div>
        <div style="flex:1;">
          <div class="alert-msg">${a.message}</div>
          <div class="alert-time">🕐 ${time} · ${a.source || 'system'} ${a.acknowledged ? '· ✔ Acked' : ''}</div>
        </div>
        ${!a.acknowledged ? `<button class="btn btn-sm btn-primary" onclick="ackAlertFull(${a.id})" style="flex-shrink:0;">Ack</button>` : ''}
      </div>`;
  }).join('');
}

function filterAlerts(type) {
  currentAlertFilter = type;
  document.querySelectorAll('.alert-filter').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.alert-filter').forEach(b => {
    if (b.getAttribute('onclick') === `filterAlerts('${type}')`) b.classList.add('active');
  });
  renderAllAlerts();
}

async function ackAlertFull(id) {
  await fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
  const a = allAlerts.find(a => a.id === id);
  if (a) a.acknowledged = true;
  unreadAlerts = Math.max(0, unreadAlerts - 1);
  setText('alertBadge', unreadAlerts);
  renderAllAlerts();
}

// ─── Match Events ──────────────────────────────────────────────────────
function renderMatchEvents() {
  const list = document.getElementById('matchEventsList');
  if (!list) return;
  if (!allMatchEvents.length) {
    list.innerHTML = `<div class="empty-state"><p>No events yet</p></div>`;
    return;
  }
  const sportEventIcon = {
    cricket: { goal: '🏏', wicket: '🎯', yellow_card: '⚠️', substitution: '🔄' },
    football: { goal: '⚽', yellow_card: '🟨', red_card: '🟥', substitution: '🔄' },
    basketball: { goal: '🏀', foul: '⚠️', substitution: '🔄', timeout: '⏸' },
    volleyball: { goal: '🏐', substitution: '🔄', timeout: '⏸' },
  };
  const icons = sportEventIcon[currentSport] || sportEventIcon.football;
  list.innerHTML = [...allMatchEvents].reverse().map(e => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(0,0,0,0.3);border-radius:10px;">
      <div style="font-size:1.4rem;">${icons[e.type] || '🏆'}</div>
      <div style="font-weight:900;color:var(--amber);font-family:'Georgia',serif;min-width:32px;">${e.minute}'</div>
      <div style="color:var(--walnut-cream);font-weight:700;">${e.type === 'goal' ? `GOAL! ${e.team}` : `${e.type} — ${e.team}`}</div>
    </div>`).join('');
}

// ─── Match Control ─────────────────────────────────────────────────────
async function matchControl(action) {
  try {
    const res = await fetch('/api/match/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sport: currentSport, stadiumId: currentStadium })
    });
    const data = await res.json();
    if (data.success) {
      matchState.status = data.data.status;
      setText('ctrlStatus', data.data.status.replace(/_/g, ' ').toUpperCase());
      setText('topStatus', data.data.status.replace(/_/g, ' ').toUpperCase());
      showToast(`✅ Match: ${data.data.status.replace(/_/g, ' ')} — ${sportLabels[currentSport]}`);
    }
  } catch (e) {}
}

// ─── Venue Settings ────────────────────────────────────────────────────
async function updateVenueSettings() {
  const cap = document.getElementById('settingCapacity')?.value;
  if (!cap || parseInt(cap) < 1000) { showToast('⚠️ Enter a valid capacity'); return; }
  const res = await fetch('/api/venue/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capacity: parseInt(cap), stadiumId: currentStadium })
  });
  const data = await res.json();
  if (data.success) showToast(`✅ Capacity updated to ${parseInt(cap).toLocaleString('en-IN')}`);
}

async function createManualAlert() {
  const type = document.getElementById('alertType')?.value || 'info';
  const msg = document.getElementById('alertMessage')?.value;
  if (!msg) { showToast('⚠️ Enter a message'); return; }
  await fetch('/api/alerts/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, message: msg, source: 'manual', stadiumId: currentStadium })
  });
  const el = document.getElementById('alertMessage');
  if (el) el.value = '';
  showToast('✅ Alert broadcast sent!');
}

// ─── Menu Management ───────────────────────────────────────────────────
async function fetchMenuItems() {
  try {
    const res = await fetch(`/api/food/menu?stadiumId=${currentStadium}`);
    const data = await res.json();
    menuItems = data.data || [];
    renderMenuManagement();
  } catch (e) {}
}

function renderMenuManagement() {
  const list = document.getElementById('menuManagementList');
  if (!list) return;
  if (!menuItems.length) { list.innerHTML = `<div class="empty-state"><span>🍽️</span><p>No menu items</p></div>`; return; }
  list.innerHTML = menuItems.map(item => `
    <div class="menu-mgmt-card">
      <span class="menu-mgmt-emoji">${item.image || '🍽️'}</span>
      <div class="menu-mgmt-name">${item.name}</div>
      <div class="menu-mgmt-price">₹${item.price} · ${item.category} · ${item.prepTime || 5}min</div>
      <div class="menu-mgmt-actions">
        <button class="toggle-avail-btn ${item.available ? '' : 'unavail'}" onclick="toggleMenuItem('${item.id}')">
          ${item.available ? '✅ Available' : '⛔ Unavailable'}
        </button>
        <button class="delete-item-btn" onclick="deleteMenuItem('${item.id}')">🗑</button>
      </div>
    </div>`).join('');
}

async function addMenuItem() {
  const name = document.getElementById('menuItemName')?.value?.trim();
  const price = document.getElementById('menuItemPrice')?.value;
  const category = document.getElementById('menuItemCategory')?.value;
  const prepTime = document.getElementById('menuItemPrepTime')?.value || 5;
  const image = document.getElementById('menuItemEmoji')?.value?.trim() || '🍽️';
  if (!name || !price) { showToast('⚠️ Fill name and price'); return; }
  const res = await fetch('/api/food/menu/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, price, category, prepTime, image })
  });
  const data = await res.json();
  if (data.success) {
    menuItems.push(data.data);
    renderMenuManagement();
    ['menuItemName', 'menuItemPrice', 'menuItemPrepTime', 'menuItemEmoji'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    showToast(`✅ "${name}" added`);
  }
}

async function toggleMenuItem(id) {
  const res = await fetch(`/api/food/menu/${id}/toggle`, { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    const item = menuItems.find(m => m.id === id);
    if (item) item.available = data.data.available;
    renderMenuManagement();
    showToast(`${data.data.name}: ${data.data.available ? '✅ Available' : '⛔ Unavailable'}`);
  }
}

async function deleteMenuItem(id) {
  if (!confirm('Remove this item?')) return;
  const res = await fetch(`/api/food/menu/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) {
    menuItems = menuItems.filter(m => m.id !== id);
    renderMenuManagement();
    showToast(`"${data.data.name}" removed`);
  }
}

// ─── QR Scanner ────────────────────────────────────────────────────────
async function startScanner() {
  const video = document.getElementById('scannerVideo');
  const placeholder = document.getElementById('scannerPlaceholder');
  const overlay = document.getElementById('scannerOverlay');
  const btn = document.getElementById('startScanBtn');
  const statusEl = document.getElementById('scannerStatus');
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scannerStream;
    video.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    if (overlay) overlay.style.display = 'block';
    if (btn) { btn.innerText = '🔴 Scanning...'; btn.disabled = true; }
    if (statusEl) { statusEl.innerText = '● Scanning'; statusEl.className = 'pill pill-amber'; }

    // jsQR simulation — in production replace with actual jsQR library
    const canvas = document.getElementById('scannerCanvas');
    const ctx = canvas.getContext('2d');
    scannerInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        // Real QR: const code = jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height);
        // if (code) handleQRResult(code.data);
      }
    }, 300);
    showToast('📷 Camera active — use manual entry to confirm pickup');
  } catch (e) {
    if (placeholder) placeholder.innerHTML = '<span style="font-size:2rem">🚫</span><span style="color:#f87171">Camera denied</span>';
    if (statusEl) { statusEl.innerText = 'Denied'; statusEl.className = 'pill pill-red'; }
    showToast('Camera access denied. Use manual entry below.');
  }
}

function stopScanner() {
  if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
  clearInterval(scannerInterval);
  const video = document.getElementById('scannerVideo');
  const placeholder = document.getElementById('scannerPlaceholder');
  const overlay = document.getElementById('scannerOverlay');
  const btn = document.getElementById('startScanBtn');
  const statusEl = document.getElementById('scannerStatus');
  if (video) video.style.display = 'none';
  if (placeholder) { placeholder.style.display = 'flex'; placeholder.innerHTML = '<span>📷</span><span>Camera stopped</span>'; }
  if (overlay) overlay.style.display = 'none';
  if (btn) { btn.innerText = '📷 Start Camera'; btn.disabled = false; }
  if (statusEl) { statusEl.innerText = 'Ready'; statusEl.className = 'pill pill-green'; }
}

async function handleQRResult(code) {
  const input = document.getElementById('manualQrInput');
  if (input) { input.value = code; }
  await scanManualQR();
}

async function scanManualQR() {
  const input = document.getElementById('manualQrInput');
  const qrCode = input?.value?.trim();
  if (!qrCode) { showToast('⚠️ Enter a pickup code'); return; }

  const resultDiv = document.getElementById('scanResult');
  resultDiv.style.display = 'block';
  resultDiv.style.background = 'rgba(255,255,255,0.04)';
  resultDiv.style.border = '1px solid var(--border-color)';
  resultDiv.innerHTML = '<span style="color:var(--text-muted)">⏳ Verifying...</span>';

  try {
    const res = await fetch('/api/orders/scan-pickup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrCode })
    });
    const data = await res.json();
    if (data.success) {
      const o = data.data;
      resultDiv.style.background = 'rgba(5,150,105,0.12)';
      resultDiv.style.border = '1px solid rgba(5,150,105,0.4)';
      resultDiv.innerHTML = `
        <div style="color:var(--emerald);font-weight:900;font-size:1rem;margin-bottom:8px;">✅ Order Delivered!</div>
        <div style="font-size:0.88rem;color:var(--walnut-cream);line-height:1.8;">
          <div><strong>Order:</strong> ${o.id}</div>
          <div><strong>Items:</strong> ${(o.items||[]).map(i=>`${i.name} x${i.qty}`).join(', ')}</div>
          <div><strong>Seat:</strong> ${o.seat} · ${o.zone?.toUpperCase()}</div>
          <div><strong>Total:</strong> ₹${o.total}</div>
        </div>`;
      if (input) input.value = '';
      showToast(`✅ ${o.id} delivered!`);
      // Log recent scan
      addRecentScan(o.id, '✅ Delivered');
      fetchOrders();
    } else {
      resultDiv.style.background = 'rgba(220,38,38,0.08)';
      resultDiv.style.border = '1px solid rgba(220,38,38,0.3)';
      const not_ready = data.data?.status === 'preparing';
      resultDiv.innerHTML = `
        <div style="color:var(--red-hot);font-weight:900;margin-bottom:6px;">${not_ready ? '⏳ Not Ready' : '❌ Scan Failed'}</div>
        <div style="color:var(--walnut-cream);font-size:0.88rem;">${not_ready ? 'Order is still being prepared.' : (data.error || 'Invalid QR code')}</div>`;
      addRecentScan(qrCode, not_ready ? '⏳ Not Ready' : '❌ Failed');
      showToast(data.error || 'QR verification failed');
    }
  } catch (e) {
    resultDiv.innerHTML = '<span style="color:var(--red-hot)">❌ Network error. Retry.</span>';
    showToast('Network error');
  }
}

function addRecentScan(id, status) {
  recentScansLog.unshift({ id, status, time: new Date().toLocaleTimeString('en-IN') });
  if (recentScansLog.length > 5) recentScansLog.pop();
  const container = document.getElementById('recentScans');
  if (!container) return;
  container.innerHTML = recentScansLog.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(0,0,0,0.3);border-radius:8px;font-size:0.82rem;">
      <span style="color:var(--walnut-cream);font-family:'Courier New',monospace;">${s.id}</span>
      <span>${s.status}</span>
      <span style="color:var(--text-muted);">${s.time}</span>
    </div>`).join('');
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
      position:fixed; bottom:28px; right:28px;
      background:linear-gradient(135deg,#2e200f,#1c140a);
      border:1px solid var(--walnut-tan); color:var(--walnut-cream);
      padding:14px 22px; border-radius:12px; font-size:0.9rem; font-weight:700;
      box-shadow:0 8px 32px rgba(0,0,0,0.7); z-index:9999;
      max-width:320px; font-family:'Nunito',sans-serif;
    `;
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}
