const fs = require('fs');

try {
  let code = fs.readFileSync('public/js/dashboard.js', 'utf8');
  
  const newSocketOn = `socket.on('match_update', data => {
  matchState = { ...matchState, ...data };
  setText('topScore', \`\${data.homeScore} : \${data.awayScore}\`);
  setText('topStatus', data.minute > 0 ? \`\${data.minute}'\` : data.status.replace(/_/g, ' ').toUpperCase());
  setText('ctrlHomeScore', data.homeScore);
  setText('ctrlAwayScore', data.awayScore);
  setText('ctrlStatus', data.status.replace(/_/g, ' ').toUpperCase());
  setText('ctrlMinute', data.minute > 0 ? \`\${data.minute}'\` : '—');
  
  // FIXED: Update Team Names, Sport, and Stadium from backend broadcast
  setText('ctrlTeamA', data.homeTeam);
  setText('ctrlTeamB', data.awayTeam);
  const icon = (typeof sportIcons !== 'undefined' && sportIcons[data.sport]) ? sportIcons[data.sport] : '⚽';
  setText('topTeamHome', \`\${icon} \${data.homeTeam}\`);
  setText('topTeamAway', \`\${data.awayTeam} 🔴\`);
  setText('teamAIcon', icon);
  
  if (typeof currentSport !== 'undefined' && currentSport !== data.sport && typeof updateSport === 'function') {
      const sportSelect = document.getElementById('sportSelect');
      if(sportSelect) {
         sportSelect.value = data.sport;
         currentSport = data.sport;
      }
      const stadiumSelect = document.getElementById('stadiumSelect');
      if(stadiumSelect && data.stadium) {
         stadiumSelect.value = data.stadium;
      }
  }

  const hi = document.getElementById('homeScoreInput');
  const ai = document.getElementById('awayScoreInput');
  if (hi) hi.value = data.homeScore;
  if (ai) ai.value = data.awayScore;
  if (data.events && data.events.length > allMatchEvents.length) {
    allMatchEvents = data.events;
    renderMatchEvents();
  }
});`;

  // Find the exact socket.on block by searching string replacing
  code = code.replace(/socket\.on\('match_update', data => \{[\s\S]*?renderMatchEvents\(\);\n  \}\n\}\);/, newSocketOn);
  fs.writeFileSync('public/js/dashboard.js', code);
  console.log("✅ Successfully updated socket.on match_update in dashboard.js");
} catch(e) {
  console.error("Error:", e);
}
