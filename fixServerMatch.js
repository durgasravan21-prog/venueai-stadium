const fs = require('fs');

try {
  let code = fs.readFileSync('server.js', 'utf8');

  const newMatchControl = `app.post('/api/match/control', (req, res) => {
  const { action } = req.body;
  switch (action) {
    case 'start':
      matchState.status = 'first_half';
      if(matchState.minute === 0) matchState.minute = 1;
      addAlert('info', 'Match has started! First half underway.', 'match');
      break;
    case 'halftime':
      matchState.status = 'halftime';
      addAlert('info', 'Halftime break initiated.', 'match');
      break;
    case 'second_half':
      matchState.status = 'second_half';
      if(matchState.minute < 45) matchState.minute = 45;
      addAlert('info', 'Second half begins!', 'match');
      break;
    case 'end':
      matchState.status = 'post_match';
      if(matchState.minute < 90) matchState.minute = 90;
      addAlert('info', 'Match concluded.', 'match');
      break;
    case 'reset':
      matchState = {
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
});`;

  // First replace: API Endpoint
  code = code.replace(/app\.post\('\/api\/match\/control', \(req, res\) => \{[\s\S]*?res\.json\(\{ success: true, data: matchState \}\);\n\}\);/, newMatchControl);

  // Second replace: simulateMatch()
  const newSimulateMatch = `let matchTickCount = 0;
function simulateMatch() {
  if (matchState.status === 'pre_match' || matchState.status === 'post_match' || matchState.status === 'halftime') return;

  matchTickCount++;
  
  if (matchTickCount >= 4) {
      matchTickCount = 0;
      matchState.minute++;
  }

  if (Math.random() < 0.005) {
      const isHome = Math.random() > 0.45;
      if (isHome) matchState.homeScore++;
      else matchState.awayScore++;
      const team = isHome ? matchState.homeTeam : matchState.awayTeam;
      matchState.events.push({ minute: matchState.minute, type: 'goal', team });
      const icon = matchState.sport === 'cricket' ? '🏏' : matchState.sport === 'basketball' ? '🏀' : '⚽';
      addAlert('success', \`\${icon} EVENT! \${team} scores at \${matchState.minute}'!\`, 'match');
      io.emit('match_update', matchState);
  }
}
`;

  code = code.replace(/function simulateMatch\(\) \{[\s\S]*?function addAlert/m, newSimulateMatch + '\nfunction addAlert');

  fs.writeFileSync('server.js', code);
  console.log("Successfully patched server.js");

} catch (e) {
  console.error("Error occurred:", e);
}
