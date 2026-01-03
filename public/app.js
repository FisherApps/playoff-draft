// Client-side state
let socket = null;
let localState = {
  myTeamId: null,
  myTeamName: null,
  isWatcher: false,  // true if joined as spectator
  myWatcherId: null,
  myWatcherName: null,
  currentView: 'setup',
  selectedPosition: 'ALL',
  searchQuery: '',
  draftState: null,
  availablePlayers: [],
  chatMessages: [],
  chatOpen: false,
  unreadCount: 0
};

// DOM Elements
const elements = {
  // Setup view
  setupView: document.getElementById('setup-view'),
  teamNameInput: document.getElementById('team-name-input'),
  joinButton: document.getElementById('join-button'),
  watchButton: document.getElementById('watch-button'),
  joinForm: document.getElementById('join-form'),
  joinedMessage: document.getElementById('joined-message'),
  watchingMessage: document.getElementById('watching-message'),
  yourTeamName: document.getElementById('your-team-name'),
  yourWatcherName: document.getElementById('your-watcher-name'),
  teamCount: document.getElementById('team-count'),
  teamsUl: document.getElementById('teams-ul'),
  startDraftButton: document.getElementById('start-draft-button'),
  waitingMessage: document.getElementById('waiting-message'),

  // Draft view
  draftView: document.getElementById('draft-view'),
  pickNumber: document.getElementById('pick-number'),
  pickTeam: document.getElementById('pick-team'),
  currentPickIndicator: document.getElementById('current-pick-indicator'),
  pauseResumeBtn: document.getElementById('pause-resume-btn'),
  draftTicker: document.getElementById('draft-ticker-inner'),
  teamsRosterList: document.getElementById('teams-roster-list'),
  positionFilter: document.getElementById('position-filter'),
  playerSearch: document.getElementById('player-search'),
  playersGrid: document.getElementById('players-grid'),
  noPlayersMessage: document.getElementById('no-players-message'),
  positionNeeds: document.getElementById('position-needs'),
  yourRoster: document.getElementById('your-roster'),
  recentPicksList: document.getElementById('recent-picks-list'),

  // Complete view
  completeView: document.getElementById('complete-view'),
  finalRosters: document.getElementById('final-rosters'),
  downloadResultsButton: document.getElementById('download-results-button'),

  // Chat
  chatContainer: document.getElementById('chat-container'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  chatToggleIcon: document.getElementById('chat-toggle-icon'),
  chatBody: document.getElementById('chat-body'),
  chatUnread: document.getElementById('chat-unread'),

  // Notification
  notification: document.getElementById('notification')
};

// Initialize socket connection
function initializeSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
    // Don't auto-reconnect here - wait for draft-state-updated to check draft ID
  });

  socket.on('joined', (data) => {
    localState.myTeamId = data.teamId;
    localState.myTeamName = data.teamName;
    localState.isWatcher = false;
    // Use sessionStorage so each browser tab has its own session
    sessionStorage.setItem('playoffDraftTeamName', data.teamName);
    sessionStorage.setItem('playoffDraftTeamId', data.teamId);
    sessionStorage.removeItem('playoffDraftWatcherName');
    sessionStorage.removeItem('playoffDraftWatcherId');
    console.log(`Joined as team: ${data.teamName} (ID: ${data.teamId})`);
    // Re-render everything to update draft buttons with correct team context
    renderCurrentView();
  });

  socket.on('joined-as-watcher', (data) => {
    localState.myWatcherId = data.watcherId;
    localState.myWatcherName = data.watcherName;
    localState.isWatcher = true;
    localState.myTeamId = null;
    localState.myTeamName = null;
    // Use sessionStorage so each browser tab has its own session
    sessionStorage.setItem('playoffDraftWatcherName', data.watcherName);
    sessionStorage.setItem('playoffDraftWatcherId', data.watcherId);
    sessionStorage.removeItem('playoffDraftTeamName');
    sessionStorage.removeItem('playoffDraftTeamId');
    console.log(`Joined as watcher: ${data.watcherName} (ID: ${data.watcherId})`);
    renderCurrentView();
  });

  socket.on('draft-state-updated', (state) => {
    // Check if this is a new draft or stale session
    const savedDraftId = sessionStorage.getItem('playoffDraftId');
    const savedTeamName = sessionStorage.getItem('playoffDraftTeamName');
    const savedWatcherName = sessionStorage.getItem('playoffDraftWatcherName');

    // It's stale if: different draft ID, OR has team/watcher name but no draft ID (old data)
    const isStaleSession = (savedDraftId && savedDraftId !== state.draftId) ||
                           ((savedTeamName || savedWatcherName) && !savedDraftId);

    if (isStaleSession) {
      // Clear ALL old data
      console.log('Stale session detected, clearing old data');
      sessionStorage.clear();
      localStorage.removeItem('playoffDraftTeamName');
      localStorage.removeItem('playoffDraftTeamId');
      localState.myTeamId = null;
      localState.myTeamName = null;
      localState.myWatcherId = null;
      localState.myWatcherName = null;
      localState.isWatcher = false;
    }

    // Save current draft ID
    sessionStorage.setItem('playoffDraftId', state.draftId);

    // Only try to reconnect if NOT stale and we have saved info
    if (!isStaleSession) {
      const teamName = sessionStorage.getItem('playoffDraftTeamName');
      const watcherName = sessionStorage.getItem('playoffDraftWatcherName');
      if (teamName && !localState.myTeamId) {
        socket.emit('join-draft', { teamName });
      } else if (watcherName && !localState.myWatcherId) {
        socket.emit('join-as-watcher', { watcherName });
      }
    }

    localState.draftState = state;
    // Convert draftedPlayerIds back to Set for easier lookup
    localState.draftState.draftedPlayerIdsSet = new Set(state.draftedPlayerIds);
    renderCurrentView();
  });

  socket.on('players-updated', (players) => {
    localState.availablePlayers = players;
    if (localState.currentView === 'drafting') {
      renderPlayersGrid();
    }
  });

  socket.on('draft-started', (data) => {
    localState.currentView = 'drafting';
    showNotification('Draft has started!');
    renderCurrentView();
  });

  socket.on('player-drafted', (data) => {
    const isMyPick = data.teamId === localState.myTeamId;
    if (!isMyPick) {
      showNotification(`${data.teamName} drafted ${data.playerName} (${data.playerPosition})`);
    }
  });

  socket.on('error', (data) => {
    alert(data.message);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });

  // Chat events
  socket.on('chat-message', (message) => {
    localState.chatMessages.push(message);
    // Keep only last 100 messages locally
    if (localState.chatMessages.length > 100) {
      localState.chatMessages.shift();
    }
    // Track unread if chat is collapsed and message is from someone else
    const myId = localState.isWatcher ? localState.myWatcherId : localState.myTeamId;
    if (!localState.chatOpen && message.teamId !== myId) {
      localState.unreadCount++;
      updateUnreadBadge();
    }
    renderChatMessages();
  });

  socket.on('chat-history', (messages) => {
    localState.chatMessages = messages;
    renderChatMessages();
  });
}

// Show notification
function showNotification(message) {
  elements.notification.textContent = message;
  elements.notification.style.display = 'block';
  setTimeout(() => {
    elements.notification.style.display = 'none';
  }, 3000);
}

// Render based on current state
function renderCurrentView() {
  if (!localState.draftState) return;

  const phase = localState.draftState.phase;

  // Hide all views
  elements.setupView.style.display = 'none';
  elements.draftView.style.display = 'none';
  elements.completeView.style.display = 'none';

  if (phase === 'setup') {
    localState.currentView = 'setup';
    elements.setupView.style.display = 'block';
    elements.chatContainer.style.display = 'none';
    renderSetupView();
  } else if (phase === 'drafting') {
    localState.currentView = 'drafting';
    elements.draftView.style.display = 'block';
    elements.chatContainer.style.display = 'flex';
    socket.emit('get-chat-history');
    renderDraftView();
  } else if (phase === 'complete') {
    localState.currentView = 'complete';
    elements.completeView.style.display = 'block';
    elements.chatContainer.style.display = 'flex';
    renderCompleteView();
  }
}

// Setup View
function renderSetupView() {
  const state = localState.draftState;
  if (!state) return;

  // Update team count
  elements.teamCount.textContent = state.teams.length;

  // Update teams list
  elements.teamsUl.innerHTML = state.teams.map(team => {
    const isMe = team.id === localState.myTeamId;
    return `<li class="${isMe ? 'my-team' : ''}">${escapeHtml(team.name)}${isMe ? ' (You)' : ''}</li>`;
  }).join('');

  updateSetupView();
}

function updateSetupView() {
  const state = localState.draftState;

  // Show/hide join form vs joined/watching message
  if (localState.myTeamId) {
    elements.joinForm.style.display = 'none';
    elements.joinedMessage.style.display = 'block';
    elements.watchingMessage.style.display = 'none';
    elements.yourTeamName.textContent = localState.myTeamName;
  } else if (localState.isWatcher) {
    elements.joinForm.style.display = 'none';
    elements.joinedMessage.style.display = 'none';
    elements.watchingMessage.style.display = 'block';
    elements.yourWatcherName.textContent = localState.myWatcherName;
  } else {
    elements.joinForm.style.display = 'flex';
    elements.joinedMessage.style.display = 'none';
    elements.watchingMessage.style.display = 'none';
  }

  // Show/hide start button (only for BD Crushers team when 2+ teams)
  const isBDCrushers = localState.myTeamName === 'BD Crushers';
  if (state && state.teams.length >= 2 && localState.myTeamId && isBDCrushers) {
    elements.startDraftButton.style.display = 'block';
    elements.waitingMessage.style.display = 'none';
  } else if (localState.myTeamId) {
    elements.startDraftButton.style.display = 'none';
    elements.waitingMessage.style.display = 'block';
    if (!isBDCrushers && state && state.teams.length >= 2) {
      elements.waitingMessage.textContent = 'Waiting for BD Crushers to start the draft...';
    } else {
      elements.waitingMessage.textContent = 'Waiting for more teams to join...';
    }
  } else if (localState.isWatcher) {
    // Watcher: show waiting message
    elements.startDraftButton.style.display = 'none';
    elements.waitingMessage.style.display = 'block';
    elements.waitingMessage.textContent = 'Waiting for the draft to start...';
  } else {
    elements.startDraftButton.style.display = 'none';
    elements.waitingMessage.style.display = 'none';
  }
}

// Draft View
function renderDraftView() {
  renderCurrentPickIndicator();
  renderPauseResumeButton();
  renderDraftTicker();
  renderPositionNeeds();
  renderTeamsRosters();
  renderPlayersGrid();
  renderYourRoster();
  renderRecentPicks();
}

function renderPositionNeeds() {
  const myTeam = findTeamById(localState.myTeamId);
  if (!myTeam || !elements.positionNeeds) {
    if (elements.positionNeeds) {
      if (localState.isWatcher) {
        elements.positionNeeds.innerHTML = '<span class="watcher-badge">Spectator Mode</span>';
      } else {
        elements.positionNeeds.innerHTML = '';
      }
    }
    return;
  }

  const needs = [
    { pos: 'QB', have: myTeam.roster.QB.length, need: 1 },
    { pos: 'RB', have: myTeam.roster.RB.length, need: 2 },
    { pos: 'WR/TE', have: myTeam.roster.WR_TE.length, need: 3 },
    { pos: 'K', have: myTeam.roster.K.length, need: 1 }
  ];

  const html = needs.map(n => {
    const filled = n.have >= n.need;
    const posClass = n.pos === 'WR/TE' ? 'WR' : n.pos;
    return `
      <div class="need-badge ${filled ? 'filled' : ''}" data-position="${posClass}">
        <span class="need-pos">${n.pos}</span>
        <span class="need-count">${n.have}/${n.need}</span>
      </div>
    `;
  }).join('');

  elements.positionNeeds.innerHTML = html;
}

function renderCurrentPickIndicator() {
  const state = localState.draftState;
  const currentPicker = getCurrentPicker();

  if (!currentPicker) {
    elements.pickNumber.textContent = 'Draft Complete';
    elements.pickTeam.textContent = '';
    elements.currentPickIndicator.classList.remove('your-turn');
    elements.currentPickIndicator.classList.remove('paused');
    return;
  }

  const pickNum = state.currentPickIndex + 1;
  const round = Math.floor(state.currentPickIndex / state.teams.length) + 1;
  const pickInRound = (state.currentPickIndex % state.teams.length) + 1;

  elements.pickNumber.textContent = `Round ${round}, Pick ${pickInRound} (Overall #${pickNum})`;

  if (state.paused) {
    elements.pickTeam.textContent = 'DRAFT PAUSED';
    elements.currentPickIndicator.classList.remove('your-turn');
    elements.currentPickIndicator.classList.add('paused');
  } else {
    elements.currentPickIndicator.classList.remove('paused');
    const isMyTurn = currentPicker.id === localState.myTeamId;
    if (isMyTurn) {
      elements.pickTeam.textContent = 'YOUR TURN!';
      elements.currentPickIndicator.classList.add('your-turn');
    } else {
      elements.pickTeam.textContent = `${currentPicker.name} is on the clock`;
      elements.currentPickIndicator.classList.remove('your-turn');
    }
  }
}

function renderPauseResumeButton() {
  const state = localState.draftState;
  const isBDCrushers = localState.myTeamName === 'BD Crushers';

  if (!isBDCrushers || !elements.pauseResumeBtn) {
    if (elements.pauseResumeBtn) elements.pauseResumeBtn.style.display = 'none';
    return;
  }

  elements.pauseResumeBtn.style.display = 'block';
  if (state.paused) {
    elements.pauseResumeBtn.textContent = 'Resume Draft';
    elements.pauseResumeBtn.classList.add('resume');
    elements.pauseResumeBtn.classList.remove('pause');
  } else {
    elements.pauseResumeBtn.textContent = 'Pause Draft';
    elements.pauseResumeBtn.classList.add('pause');
    elements.pauseResumeBtn.classList.remove('resume');
  }
}

function renderDraftTicker() {
  const state = localState.draftState;
  if (!state.draftOrder || state.draftOrder.length === 0 || !elements.draftTicker) return;

  // Show current pick + upcoming picks (enough to fill the ticker)
  const startIdx = state.currentPickIndex;
  const endIdx = Math.min(startIdx + 16, state.draftOrder.length); // Show up to 16 upcoming

  let html = '';
  for (let i = startIdx; i < endIdx; i++) {
    const teamId = state.draftOrder[i];
    const team = findTeamById(teamId);
    if (!team) continue;

    const isCurrent = i === state.currentPickIndex;
    const isMe = team.id === localState.myTeamId;
    const pickNum = i + 1;
    const round = Math.floor(i / state.teams.length) + 1;

    html += `
      <div class="ticker-pick ${isCurrent ? 'current' : ''} ${isMe ? 'my-pick' : ''}">
        <span class="ticker-round">R${round}</span>
        <span class="ticker-num">#${pickNum}</span>
        <span class="ticker-team">${escapeHtml(team.name)}</span>
      </div>
    `;
  }

  elements.draftTicker.innerHTML = html;
}

function renderTeamsRosters() {
  const state = localState.draftState;

  let html = state.teams.map(team => {
    const isMe = team.id === localState.myTeamId;
    const totalPlayers = team.roster.QB.length + team.roster.RB.length +
                         team.roster.WR_TE.length + team.roster.K.length;

    return `
      <div class="team-summary ${isMe ? 'my-team' : ''}" onclick="toggleTeamDetail('${team.id}')">
        <div class="team-header">
          <span class="team-name">${escapeHtml(team.name)}${isMe ? ' (You)' : ''}</span>
          <span class="team-count">${totalPlayers}/7</span>
        </div>
        <div id="team-detail-${team.id}" class="team-detail" style="display: none;">
          ${renderMiniRoster(team)}
        </div>
      </div>
    `;
  }).join('');

  elements.teamsRosterList.innerHTML = html;
}

function renderMiniRoster(team) {
  return `
    <div class="mini-roster">
      <div class="position-row"><strong>QB:</strong> ${team.roster.QB.map(p => p.name).join(', ') || '-'}</div>
      <div class="position-row"><strong>RB:</strong> ${team.roster.RB.map(p => p.name).join(', ') || '-'}</div>
      <div class="position-row"><strong>WR/TE:</strong> ${team.roster.WR_TE.map(p => p.name).join(', ') || '-'}</div>
      <div class="position-row"><strong>K:</strong> ${team.roster.K.map(p => p.name).join(', ') || '-'}</div>
    </div>
  `;
}

function toggleTeamDetail(teamId) {
  const detail = document.getElementById(`team-detail-${teamId}`);
  if (detail) {
    detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
  }
}

function renderPlayersGrid() {
  const players = filterPlayers();

  if (players.length === 0) {
    elements.playersGrid.innerHTML = '';
    elements.noPlayersMessage.style.display = 'block';
    return;
  }

  elements.noPlayersMessage.style.display = 'none';

  const state = localState.draftState;
  const currentPicker = getCurrentPicker();
  const isMyTurn = currentPicker && currentPicker.id === localState.myTeamId;
  const myTeam = findTeamById(localState.myTeamId);
  const isPaused = state.paused;

  const html = players.map(player => {
    const canDraft = !isPaused && isMyTurn && myTeam && canDraftPosition(myTeam, player.position);
    const errorMsg = isPaused ? 'Draft is paused' : getCannotDraftReason(player, isMyTurn, myTeam);
    const positionFilled = myTeam && !canDraftPosition(myTeam, player.position);

    return `
      <div class="player-card ${positionFilled ? 'position-filled' : ''}" data-position="${player.position}">
        <div class="player-info">
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-details">
            <span class="position-badge position-${player.position}">${player.position}</span>
            <span class="team-abbr">${player.team}</span>
            ${positionFilled ? '<span class="filled-indicator">FILLED</span>' : ''}
          </div>
        </div>
        <button
          class="draft-btn"
          data-player-id="${player.id}"
          ${!canDraft ? 'disabled' : ''}
          title="${errorMsg || 'Draft this player'}"
          onclick="draftPlayer('${player.id}')"
        >
          Draft
        </button>
      </div>
    `;
  }).join('');

  elements.playersGrid.innerHTML = html;
}

function filterPlayers() {
  let players = localState.availablePlayers;

  // Filter by position
  if (localState.selectedPosition !== 'ALL') {
    players = players.filter(p => p.position === localState.selectedPosition);
  }

  // Filter by search query
  if (localState.searchQuery.trim() !== '') {
    const query = localState.searchQuery.toLowerCase();
    players = players.filter(p => p.searchText.includes(query));
  }

  // Sort by position then last name
  const posOrder = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5 };
  players.sort((a, b) => {
    if (posOrder[a.position] !== posOrder[b.position]) {
      return posOrder[a.position] - posOrder[b.position];
    }
    // Extract last name (last word in the name)
    const aLastName = a.name.split(' ').pop();
    const bLastName = b.name.split(' ').pop();
    return aLastName.localeCompare(bLastName);
  });

  return players;
}

function canDraftPosition(team, position) {
  const limits = { QB: 1, RB: 2, WR_TE: 3, K: 1 };

  if (position === 'QB') return team.roster.QB.length < limits.QB;
  if (position === 'RB') return team.roster.RB.length < limits.RB;
  if (position === 'WR' || position === 'TE') return team.roster.WR_TE.length < limits.WR_TE;
  if (position === 'K') return team.roster.K.length < limits.K;

  return false;
}

function getCannotDraftReason(player, isMyTurn, myTeam) {
  if (!isMyTurn) return 'Not your turn';
  if (!myTeam) return 'You are not in the draft';
  if (!canDraftPosition(myTeam, player.position)) {
    return `You've filled your ${player.position} slots`;
  }
  return '';
}

function renderYourRoster() {
  const myTeam = findTeamById(localState.myTeamId);

  if (!myTeam) {
    if (localState.isWatcher) {
      elements.yourRoster.innerHTML = '<p class="watcher-notice">Watching as spectator</p>';
    } else {
      elements.yourRoster.innerHTML = '<p>Not in draft</p>';
    }
    return;
  }

  elements.yourRoster.innerHTML = `
    <div class="roster-section">
      <div class="position-group">
        <h3>QB (${myTeam.roster.QB.length}/1)</h3>
        ${myTeam.roster.QB.map(p => renderRosterPlayer(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
      <div class="position-group">
        <h3>RB (${myTeam.roster.RB.length}/2)</h3>
        ${myTeam.roster.RB.map(p => renderRosterPlayer(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
      <div class="position-group">
        <h3>WR/TE (${myTeam.roster.WR_TE.length}/3)</h3>
        ${myTeam.roster.WR_TE.map(p => renderRosterPlayer(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
      <div class="position-group">
        <h3>K (${myTeam.roster.K.length}/1)</h3>
        ${myTeam.roster.K.map(p => renderRosterPlayer(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
    </div>
  `;
}

function renderRosterPlayer(player) {
  return `
    <div class="roster-player">
      <span class="roster-player-name">${escapeHtml(player.name)}</span>
      <span class="roster-player-team">${player.team}</span>
    </div>
  `;
}

function renderRecentPicks() {
  const state = localState.draftState;
  const recentPicks = state.picks.slice(-10).reverse();
  const isBDCrushers = localState.myTeamName === 'BD Crushers';
  const showUndo = isBDCrushers && state.paused;

  if (recentPicks.length === 0) {
    elements.recentPicksList.innerHTML = '<li class="no-picks">No picks yet</li>';
    return;
  }

  const html = recentPicks.map(pick => {
    const team = findTeamById(pick.teamId);
    const player = localState.availablePlayers.find(p => p.id === pick.playerId) ||
                   findDraftedPlayer(pick.playerId);

    if (!team || !player) return '';

    return `
      <li class="recent-pick">
        <span class="pick-number">#${pick.pickNumber}</span>
        <span class="pick-info">
          <strong>${escapeHtml(team.name)}</strong> - ${escapeHtml(player.name)} (${player.position})
        </span>
        ${showUndo ? `<button class="undo-pick-btn" onclick="undoPick(${pick.pickNumber})" title="Undo this pick">×</button>` : ''}
      </li>
    `;
  }).join('');

  elements.recentPicksList.innerHTML = html;
}

function findDraftedPlayer(playerId) {
  // Search through all team rosters
  for (const team of localState.draftState.teams) {
    for (const pos of ['QB', 'RB', 'WR_TE', 'K']) {
      const player = team.roster[pos].find(p => p.id === playerId);
      if (player) return player;
    }
  }
  return null;
}

// Complete View
function renderCompleteView() {
  const state = localState.draftState;

  const html = state.teams.map(team => {
    const isMe = team.id === localState.myTeamId;

    return `
      <div class="final-team ${isMe ? 'my-team' : ''}">
        <h3>${escapeHtml(team.name)}${isMe ? ' (You)' : ''}</h3>
        <div class="final-roster">
          <div class="final-position">
            <strong>QB:</strong> ${team.roster.QB.map(p => `${p.name} (${p.team})`).join(', ')}
          </div>
          <div class="final-position">
            <strong>RB:</strong> ${team.roster.RB.map(p => `${p.name} (${p.team})`).join(', ')}
          </div>
          <div class="final-position">
            <strong>WR/TE:</strong> ${team.roster.WR_TE.map(p => `${p.name} (${p.team})`).join(', ')}
          </div>
          <div class="final-position">
            <strong>K:</strong> ${team.roster.K.map(p => `${p.name} (${p.team})`).join(', ')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  elements.finalRosters.innerHTML = html;

  // Show download button only for BD Crushers
  const isBDCrushers = localState.myTeamName === 'BD Crushers';
  if (elements.downloadResultsButton) {
    elements.downloadResultsButton.style.display = isBDCrushers ? 'block' : 'none';
  }
}

// Helper functions
function getCurrentPicker() {
  const state = localState.draftState;
  if (!state || state.phase !== 'drafting') return null;
  if (state.currentPickIndex >= state.draftOrder.length) return null;

  const teamId = state.draftOrder[state.currentPickIndex];
  return findTeamById(teamId);
}

function findTeamById(teamId) {
  if (!localState.draftState) return null;
  return localState.draftState.teams.find(t => t.id === teamId);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event handlers
function handleJoinDraft() {
  const teamName = elements.teamNameInput.value.trim();
  if (!teamName) {
    alert('Please enter a team name');
    return;
  }
  socket.emit('join-draft', { teamName });
}

function handleWatchDraft() {
  const watcherName = elements.teamNameInput.value.trim();
  if (!watcherName) {
    alert('Please enter your name');
    return;
  }
  socket.emit('join-as-watcher', { watcherName });
}

function handleStartDraft() {
  socket.emit('start-draft');
}

function draftPlayer(playerId) {
  socket.emit('draft-player', { playerId });
}

function downloadResults() {
  fetch('/api/results')
    .then(res => res.json())
    .then(data => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `draft-results-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(err => {
      alert('Error downloading results: ' + err.message);
    });
}

function togglePause() {
  const state = localState.draftState;
  if (state.paused) {
    socket.emit('resume-draft');
  } else {
    socket.emit('pause-draft');
  }
}

function undoPick(pickNumber) {
  if (!confirm(`Are you sure you want to undo pick #${pickNumber}?`)) {
    return;
  }
  socket.emit('undo-pick', { pickNumber });
}

function handlePositionFilter(position) {
  localState.selectedPosition = position;

  // Update active button
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.position === position);
  });

  renderPlayersGrid();
}

function handleSearch(query) {
  localState.searchQuery = query;
  renderPlayersGrid();
}

// Set up event listeners
function setupEventListeners() {
  // Join button
  elements.joinButton.addEventListener('click', handleJoinDraft);

  // Watch button
  elements.watchButton.addEventListener('click', handleWatchDraft);

  // Enter key on team name input (default to join as team)
  elements.teamNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinDraft();
  });

  // Start draft button
  elements.startDraftButton.addEventListener('click', handleStartDraft);

  // Position filter buttons
  elements.positionFilter.addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-btn')) {
      handlePositionFilter(e.target.dataset.position);
    }
  });

  // Search input
  elements.playerSearch.addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });

  // Chat input - Enter to send
  elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
}

// Chat functions
function renderChatMessages() {
  const container = elements.chatMessages;
  if (!container) return;

  const myId = localState.isWatcher ? localState.myWatcherId : localState.myTeamId;
  const html = localState.chatMessages.map(msg => {
    const isMe = msg.teamId === myId;
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="chat-message ${isMe ? 'my-message' : ''}">
        <span class="chat-sender">${escapeHtml(msg.teamName)}</span>
        <span class="chat-time">${time}</span>
        <div class="chat-text">${escapeHtml(msg.message)}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
  const input = elements.chatInput;
  const message = input.value.trim();

  if (!message) return;

  socket.emit('chat-message', { message });
  input.value = '';
}

function toggleChat() {
  localState.chatOpen = !localState.chatOpen;
  if (localState.chatOpen) {
    elements.chatContainer.classList.remove('chat-collapsed');
    elements.chatContainer.classList.add('chat-expanded');
    // Clear unread when opening
    localState.unreadCount = 0;
    updateUnreadBadge();
    // Scroll to bottom
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  } else {
    elements.chatContainer.classList.remove('chat-expanded');
    elements.chatContainer.classList.add('chat-collapsed');
  }
}

function updateUnreadBadge() {
  if (localState.unreadCount > 0) {
    elements.chatUnread.textContent = localState.unreadCount > 99 ? '99+' : localState.unreadCount;
    elements.chatUnread.style.display = 'inline';
  } else {
    elements.chatUnread.style.display = 'none';
  }
}

// Make functions available globally
window.toggleTeamDetail = toggleTeamDetail;
window.draftPlayer = draftPlayer;
window.downloadResults = downloadResults;
window.togglePause = togglePause;
window.undoPick = undoPick;
window.sendChatMessage = sendChatMessage;
window.toggleChat = toggleChat;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initializeSocket();
});
