const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Generate unique draft ID on server start (used to invalidate old client sessions)
const DRAFT_ID = 'draft-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
console.log(`Draft ID: ${DRAFT_ID}`);

// Load players from JSON file
let allPlayers = [];
try {
  const playersData = fs.readFileSync(path.join(__dirname, 'players.json'), 'utf8');
  allPlayers = JSON.parse(playersData);
  console.log(`Loaded ${allPlayers.length} players from players.json`);
} catch (err) {
  console.error('Error loading players.json:', err.message);
  process.exit(1);
}

// Draft state
const draftState = {
  phase: 'setup', // 'setup' | 'drafting' | 'complete'
  teams: [],
  watchers: [], // People watching but not drafting
  draftOrder: [],
  currentPickIndex: 0,
  picks: [],
  draftedPlayerIds: new Set(),
  paused: false
};

// Chat messages (kept separate, not sent with every state update)
const chatMessages = [];

// Helper: Get available players (not drafted)
function getAvailablePlayers() {
  return allPlayers.filter(p => !draftState.draftedPlayerIds.has(p.id));
}

// Helper: Find team by socket ID
function findTeamBySocketId(socketId) {
  return draftState.teams.find(t => t.socketId === socketId);
}

// Helper: Find team by ID
function findTeamById(teamId) {
  return draftState.teams.find(t => t.id === teamId);
}

// Helper: Find team by name (case-insensitive)
function findTeamByName(name) {
  return draftState.teams.find(t => t.name.toLowerCase() === name.toLowerCase());
}

// Helper: Find watcher by socket ID
function findWatcherBySocketId(socketId) {
  return draftState.watchers.find(w => w.socketId === socketId);
}

// Helper: Find watcher by name (case-insensitive)
function findWatcherByName(name) {
  return draftState.watchers.find(w => w.name.toLowerCase() === name.toLowerCase());
}

// Helper: Get current picker team
function getCurrentPicker() {
  if (draftState.phase !== 'drafting' || draftState.currentPickIndex >= draftState.draftOrder.length) {
    return null;
  }
  const teamId = draftState.draftOrder[draftState.currentPickIndex];
  return findTeamById(teamId);
}

// Helper: Check if team can draft a position
function canDraftPosition(team, position) {
  const limits = { QB: 1, RB: 2, WR_TE: 3, K: 1 };

  if (position === 'QB') return team.roster.QB.length < limits.QB;
  if (position === 'RB') return team.roster.RB.length < limits.RB;
  if (position === 'WR' || position === 'TE') return team.roster.WR_TE.length < limits.WR_TE;
  if (position === 'K') return team.roster.K.length < limits.K;

  return false;
}

// Helper: Get roster slot for position
function getRosterSlot(position) {
  if (position === 'WR' || position === 'TE') return 'WR_TE';
  return position;
}

// Helper: Generate snake draft order
function generateSnakeDraftOrder(teams) {
  // Shuffle teams randomly
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const order = [];

  // Total picks: 7 rounds × number of teams
  const rounds = 7;
  for (let round = 0; round < rounds; round++) {
    if (round % 2 === 0) {
      // Even rounds: normal order
      order.push(...shuffled.map(t => t.id));
    } else {
      // Odd rounds: reverse order
      order.push(...shuffled.slice().reverse().map(t => t.id));
    }
  }

  return order;
}

// Helper: Generate unique team ID
function generateTeamId() {
  return 'team-' + Math.random().toString(36).substr(2, 9);
}

// Helper: Serialize draft state for client (convert Set to Array)
function serializeDraftState() {
  return {
    draftId: DRAFT_ID,
    phase: draftState.phase,
    teams: draftState.teams,
    watchers: draftState.watchers.map(w => ({ id: w.id, name: w.name })),
    draftOrder: draftState.draftOrder,
    currentPickIndex: draftState.currentPickIndex,
    picks: draftState.picks,
    draftedPlayerIds: Array.from(draftState.draftedPlayerIds),
    paused: draftState.paused
  };
}

// Helper: Save draft results to file
function saveDraftResults() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `draft-results-${timestamp}.json`;

  const results = {
    completedAt: new Date().toISOString(),
    draftId: DRAFT_ID,
    teams: draftState.teams.map(team => ({
      name: team.name,
      roster: {
        QB: team.roster.QB.map(p => ({ name: p.name, team: p.team })),
        RB: team.roster.RB.map(p => ({ name: p.name, team: p.team })),
        WR_TE: team.roster.WR_TE.map(p => ({ name: p.name, team: p.team, position: p.position })),
        K: team.roster.K.map(p => ({ name: p.name, team: p.team }))
      }
    })),
    pickHistory: draftState.picks.map(pick => {
      const team = findTeamById(pick.teamId);
      const player = allPlayers.find(p => p.id === pick.playerId);
      return {
        pickNumber: pick.pickNumber,
        teamName: team ? team.name : 'Unknown',
        playerName: player ? player.name : 'Unknown',
        position: player ? player.position : 'Unknown',
        nflTeam: player ? player.team : 'Unknown'
      };
    })
  };

  try {
    fs.writeFileSync(path.join(__dirname, filename), JSON.stringify(results, null, 2));
    console.log(`Draft results saved to ${filename}`);
  } catch (err) {
    console.error('Error saving draft results:', err.message);
  }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: Get current state
app.get('/api/state', (req, res) => {
  res.json(serializeDraftState());
});

// API: Get available players
app.get('/api/players', (req, res) => {
  let players = getAvailablePlayers();

  // Filter by position if specified
  const position = req.query.position;
  if (position && position !== 'ALL') {
    players = players.filter(p => p.position === position);
  }

  res.json(players);
});

// API: Get draft results (for download)
app.get('/api/results', (req, res) => {
  if (draftState.phase !== 'complete') {
    res.status(400).json({ error: 'Draft is not complete' });
    return;
  }

  const results = {
    completedAt: new Date().toISOString(),
    teams: draftState.teams.map(team => ({
      name: team.name,
      roster: {
        QB: team.roster.QB.map(p => ({ name: p.name, team: p.team })),
        RB: team.roster.RB.map(p => ({ name: p.name, team: p.team })),
        WR_TE: team.roster.WR_TE.map(p => ({ name: p.name, team: p.team, position: p.position })),
        K: team.roster.K.map(p => ({ name: p.name, team: p.team }))
      }
    })),
    pickHistory: draftState.picks.map(pick => {
      const team = findTeamById(pick.teamId);
      const player = allPlayers.find(p => p.id === pick.playerId);
      return {
        pickNumber: pick.pickNumber,
        teamName: team ? team.name : 'Unknown',
        playerName: player ? player.name : 'Unknown',
        position: player ? player.position : 'Unknown',
        nflTeam: player ? player.team : 'Unknown'
      };
    })
  };

  res.json(results);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send current state to newly connected client
  socket.emit('draft-state-updated', serializeDraftState());
  socket.emit('players-updated', getAvailablePlayers());

  // Join draft
  socket.on('join-draft', (data) => {
    const { teamName } = data;

    // Validation
    if (!teamName || teamName.trim() === '') {
      socket.emit('error', { message: 'Team name cannot be empty' });
      return;
    }

    const trimmedName = teamName.trim();

    // Check if reconnecting to existing team
    const existingTeam = findTeamByName(trimmedName);
    if (existingTeam) {
      // Reconnection - update socket ID
      existingTeam.socketId = socket.id;
      console.log(`Team "${trimmedName}" reconnected with socket ${socket.id}`);
      socket.emit('joined', { teamId: existingTeam.id, teamName: existingTeam.name });
      io.emit('draft-state-updated', serializeDraftState());
      return;
    }

    // Check if draft already started
    if (draftState.phase !== 'setup') {
      socket.emit('error', { message: 'Draft has already started. You can only rejoin with an existing team name.' });
      return;
    }

    // Check if max teams reached
    if (draftState.teams.length >= 8) {
      socket.emit('error', { message: 'Draft is full (8 teams maximum)' });
      return;
    }

    // Clear any previous team association for this socket
    // (handles case where same browser tab auto-reconnected to wrong team via localStorage)
    const previousTeam = findTeamBySocketId(socket.id);
    if (previousTeam) {
      previousTeam.socketId = null;
      console.log(`Cleared socket association from team "${previousTeam.name}"`);
    }

    // Create new team
    const newTeam = {
      id: generateTeamId(),
      name: trimmedName,
      socketId: socket.id,
      roster: {
        QB: [],
        RB: [],
        WR_TE: [],
        K: []
      }
    };

    draftState.teams.push(newTeam);
    console.log(`Team "${trimmedName}" joined the draft`);

    socket.emit('joined', { teamId: newTeam.id, teamName: newTeam.name });
    io.emit('draft-state-updated', serializeDraftState());
  });

  // Join as watcher (spectator mode)
  socket.on('join-as-watcher', (data) => {
    const { watcherName } = data;

    // Validation
    if (!watcherName || watcherName.trim() === '') {
      socket.emit('error', { message: 'Name cannot be empty' });
      return;
    }

    const trimmedName = watcherName.trim();

    // Check if this name is already a team
    const existingTeam = findTeamByName(trimmedName);
    if (existingTeam) {
      socket.emit('error', { message: 'This name is already registered as a team. Use "Join Draft" instead.' });
      return;
    }

    // Check if reconnecting as existing watcher
    const existingWatcher = findWatcherByName(trimmedName);
    if (existingWatcher) {
      existingWatcher.socketId = socket.id;
      console.log(`Watcher "${trimmedName}" reconnected with socket ${socket.id}`);
      socket.emit('joined-as-watcher', { watcherId: existingWatcher.id, watcherName: existingWatcher.name });
      io.emit('draft-state-updated', serializeDraftState());
      return;
    }

    // Create new watcher
    const newWatcher = {
      id: 'watcher-' + Math.random().toString(36).substr(2, 9),
      name: trimmedName,
      socketId: socket.id
    };

    draftState.watchers.push(newWatcher);
    console.log(`Watcher "${trimmedName}" joined to watch the draft`);

    socket.emit('joined-as-watcher', { watcherId: newWatcher.id, watcherName: newWatcher.name });
    io.emit('draft-state-updated', serializeDraftState());
  });

  // Start draft
  socket.on('start-draft', () => {
    // Validation
    if (draftState.phase !== 'setup') {
      socket.emit('error', { message: 'Draft has already started' });
      return;
    }

    if (draftState.teams.length < 2) {
      socket.emit('error', { message: 'Need at least 2 teams to start the draft' });
      return;
    }

    // Generate draft order
    draftState.draftOrder = generateSnakeDraftOrder(draftState.teams);
    draftState.phase = 'drafting';
    draftState.currentPickIndex = 0;

    console.log('Draft started!');
    console.log('Draft order:', draftState.draftOrder.map(id => findTeamById(id).name));

    io.emit('draft-started', { draftOrder: draftState.draftOrder });
    io.emit('draft-state-updated', serializeDraftState());
  });

  // Draft player
  socket.on('draft-player', (data) => {
    const { playerId } = data;

    // Validation: Phase check
    if (draftState.phase !== 'drafting') {
      socket.emit('error', { message: 'Draft is not in progress' });
      return;
    }

    // Validation: Pause check
    if (draftState.paused) {
      socket.emit('error', { message: 'Draft is paused' });
      return;
    }

    // Find the team making this pick
    const team = findTeamBySocketId(socket.id);
    if (!team) {
      socket.emit('error', { message: 'You are not registered as a team' });
      return;
    }

    // Check if it's this team's turn
    const currentPicker = getCurrentPicker();
    if (!currentPicker || currentPicker.id !== team.id) {
      socket.emit('error', { message: 'It is not your turn to pick' });
      return;
    }

    // Check if player exists
    const player = allPlayers.find(p => p.id === playerId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    // Check if player already drafted
    if (draftState.draftedPlayerIds.has(playerId)) {
      socket.emit('error', { message: 'Player has already been drafted' });
      return;
    }

    // Check position limit
    if (!canDraftPosition(team, player.position)) {
      socket.emit('error', { message: `You have already filled your ${player.position} roster slots` });
      return;
    }

    // Make the pick
    const rosterSlot = getRosterSlot(player.position);
    team.roster[rosterSlot].push(player);
    draftState.draftedPlayerIds.add(playerId);

    const pickNumber = draftState.currentPickIndex + 1;
    draftState.picks.push({
      teamId: team.id,
      playerId: playerId,
      pickNumber: pickNumber,
      timestamp: Date.now()
    });

    console.log(`Pick #${pickNumber}: ${team.name} drafts ${player.name} (${player.position})`);

    // Advance to next pick
    draftState.currentPickIndex++;

    // Check if draft is complete
    const totalPicks = draftState.teams.length * 7;
    if (draftState.currentPickIndex >= totalPicks) {
      draftState.phase = 'complete';
      console.log('Draft complete!');
      saveDraftResults();
    }

    // Notify all clients
    io.emit('player-drafted', {
      playerId: playerId,
      teamId: team.id,
      teamName: team.name,
      playerName: player.name,
      playerPosition: player.position,
      playerTeam: player.team,
      pickNumber: pickNumber
    });
    io.emit('draft-state-updated', serializeDraftState());
    io.emit('players-updated', getAvailablePlayers());
  });

  // Chat message
  socket.on('chat-message', (data) => {
    const { message } = data;

    // Find the team or watcher sending this message
    const team = findTeamBySocketId(socket.id);
    const watcher = findWatcherBySocketId(socket.id);

    if (!team && !watcher) {
      socket.emit('error', { message: 'You must join the draft to chat' });
      return;
    }

    // Validate message
    if (!message || message.trim() === '') {
      return;
    }

    const trimmedMessage = message.trim().substring(0, 200); // Limit to 200 chars

    const senderId = team ? team.id : watcher.id;
    const senderName = team ? team.name : watcher.name;

    const chatMessage = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      teamId: senderId,
      teamName: senderName + (watcher ? ' (Spectator)' : ''),
      message: trimmedMessage,
      timestamp: Date.now()
    };

    chatMessages.push(chatMessage);

    // Keep only last 100 messages
    if (chatMessages.length > 100) {
      chatMessages.shift();
    }

    // Broadcast to all clients
    io.emit('chat-message', chatMessage);
  });

  // Send chat history when requested
  socket.on('get-chat-history', () => {
    socket.emit('chat-history', chatMessages);
  });

  // Pause draft (BD Crushers only)
  socket.on('pause-draft', () => {
    const team = findTeamBySocketId(socket.id);
    if (!team || team.name !== 'BD Crushers') {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    if (draftState.phase !== 'drafting') {
      socket.emit('error', { message: 'Draft is not in progress' });
      return;
    }

    draftState.paused = true;
    console.log('Draft paused by BD Crushers');
    io.emit('draft-state-updated', serializeDraftState());
  });

  // Resume draft (BD Crushers only)
  socket.on('resume-draft', () => {
    const team = findTeamBySocketId(socket.id);
    if (!team || team.name !== 'BD Crushers') {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    if (draftState.phase !== 'drafting') {
      socket.emit('error', { message: 'Draft is not in progress' });
      return;
    }

    draftState.paused = false;
    console.log('Draft resumed by BD Crushers');
    io.emit('draft-state-updated', serializeDraftState());
  });

  // Undo pick (BD Crushers only, draft must be paused)
  socket.on('undo-pick', (data) => {
    const { pickNumber } = data;
    const team = findTeamBySocketId(socket.id);

    if (!team || team.name !== 'BD Crushers') {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    if (draftState.phase !== 'drafting') {
      socket.emit('error', { message: 'Draft is not in progress' });
      return;
    }

    if (!draftState.paused) {
      socket.emit('error', { message: 'Draft must be paused to undo picks' });
      return;
    }

    // Find the pick to undo
    const pickIndex = draftState.picks.findIndex(p => p.pickNumber === pickNumber);
    if (pickIndex === -1) {
      socket.emit('error', { message: 'Pick not found' });
      return;
    }

    const pick = draftState.picks[pickIndex];
    const pickTeam = findTeamById(pick.teamId);
    const player = allPlayers.find(p => p.id === pick.playerId);

    if (!pickTeam || !player) {
      socket.emit('error', { message: 'Invalid pick data' });
      return;
    }

    // Remove player from team roster
    const rosterSlot = getRosterSlot(player.position);
    const playerIndex = pickTeam.roster[rosterSlot].findIndex(p => p.id === pick.playerId);
    if (playerIndex !== -1) {
      pickTeam.roster[rosterSlot].splice(playerIndex, 1);
    }

    // Remove from drafted players
    draftState.draftedPlayerIds.delete(pick.playerId);

    // Remove from picks array
    draftState.picks.splice(pickIndex, 1);

    // Adjust currentPickIndex if needed (go back one pick)
    if (draftState.currentPickIndex > 0) {
      draftState.currentPickIndex--;
    }

    console.log(`Pick #${pickNumber} undone by BD Crushers: ${player.name} removed from ${pickTeam.name}`);

    // Notify all clients
    io.emit('draft-state-updated', serializeDraftState());
    io.emit('players-updated', getAvailablePlayers());
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    const team = findTeamBySocketId(socket.id);
    if (team) {
      team.socketId = null;
      console.log(`Team "${team.name}" disconnected`);
    }
    const watcher = findWatcherBySocketId(socket.id);
    if (watcher) {
      watcher.socketId = null;
      console.log(`Watcher "${watcher.name}" disconnected`);
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Share via ngrok: ngrok http ${PORT}`);
});
