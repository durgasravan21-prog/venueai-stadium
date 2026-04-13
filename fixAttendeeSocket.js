const fs = require('fs');

try {
  let code = fs.readFileSync('public/js/attendee.js', 'utf8');

  const newSocketOn = `socket.on('match_update', data => {
  setText('homeScore', data.homeScore);
  setText('awayScore', data.awayScore);
  setText('matchStatus', data.status.replace(/_/g,' ').toUpperCase());
  setText('matchMinute', data.minute > 0 ? data.minute + "'" : '');

  // Update team names from admin config
  const sportIcons = { cricket:'🏏', football:'⚽', basketball:'🏀', volleyball:'🏐', kabaddi:'🤸', hockey:'🏑' };
  const icon = sportIcons[data.sport] || '⚽';
  if (data.homeTeam) setText('heroTeamA', data.homeTeam);
  if (data.awayTeam) setText('heroTeamB', data.awayTeam);
  if (data.sport) { setText('heroIconA', icon); setText('heroIconB', icon); }

  // Update Stadium Name
  if (data.stadium) {
    const stadiumNames = {
      metastadium: 'MetaStadium Arena',
      eden: 'Eden Gardens',
      wankhede: 'Wankhede Stadium',
      chepauk: 'Chepauk Stadium',
      chinnaswamy: 'Chinnaswamy Stadium',
      saltlake: 'Salt Lake Stadium',
      jawaharlal: 'Jawaharlal Nehru Stadium',
      indira: 'Indira Gandhi Arena',
      smc: 'SMC Indoor Complex'
    };
    const stName = stadiumNames[data.stadium] || 'VenueAI Stadium';
    const titleEl = document.getElementById('heroTitle');
    if (titleEl) {
      const words = stName.split(' ');
      if (words.length > 1) {
         const last = words.pop();
         titleEl.innerHTML = \`\${words.join(' ')} <span class="gradient-text">\${last}</span>\`;
      } else {
         titleEl.innerHTML = stName;
      }
    }
  }

  // Goal toast
  if (data.events && data.events.length) {
    const last = data.events[data.events.length - 1];
    if (last && last.type === 'goal') showToast(\`\${icon} GOAL! \${last.team} at \${last.minute}'\`, 'success');
  }
});`;

  // Regex replacement
  code = code.replace(/socket\.on\('match_update', data => \{[\s\S]*?\}\);/, newSocketOn);
  fs.writeFileSync('public/js/attendee.js', code);
  console.log("✅ Successfully updated socket.on match_update in attendee.js to reflect the Stadium name.");
} catch(e) {
  console.error("Error:", e);
}
