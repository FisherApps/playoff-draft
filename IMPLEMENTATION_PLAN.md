# Playoff Fantasy Football Draft App - Detailed Implementation Plan

## Project Overview
Build a real-time web application for conducting a fantasy football draft for playoff teams. 8 teams will draft players remotely over the internet. The app must be simple, functional, and deployable via ngrok with minimal setup.

## Requirements Summary
- **8 teams** drafting remotely
- **Snake draft** format (1→8, then 8→1, repeat)
- **Roster requirements per team**: 1 QB, 2 RB, 3 WR/TE (flex), 1 K = 7 picks per team = 56 total picks
- **Player pool**: All players from 2024-2025 NFL playoff teams (14 teams made playoffs)
- **Real-time updates**: All users see picks instantly
- **Simple UI**: Similar to ESPN draft board - available players, team rosters, draft order
- **No authentication**: Trust-based system (acceptable for private league)
- **Deployment**: Local server + ngrok for internet access

---

## Technical Stack

### Backend
- **Node.js** with **Express** (web server)
- **Socket.io** (real-time bidirectional communication)
- **In-memory storage** (no database - draft state lives in RAM)

### Frontend
- **Single HTML page** (`index.html`)
- **Vanilla JavaScript** (no frameworks - keep it simple)
- **Socket.io client** (for real-time updates)
- **Basic CSS** (functional, clean interface)

### Deployment
- **ngrok** (tunneling service for internet access)

---

## File Structure

```
playoffDraft/
├── package.json              # Dependencies: express, socket.io
├── server.js                 # Main server file
├── players.json              # NFL playoff rosters data
├── README.md                 # Setup instructions for user
└── public/
    ├── index.html            # Main app page
    ├── style.css             # Styling
    └── app.js                # Client-side JavaScript
```

---

## Data Requirements

### players.json Structure
Must include ALL players from these 14 NFL playoff teams (2024-2025 season):
- **AFC**: Kansas City Chiefs, Buffalo Bills, Baltimore Ravens, Houston Texans, Los Angeles Chargers, Pittsburgh Steelers, Denver Broncos
- **NFC**: Detroit Lions, Philadelphia Eagles, Tampa Bay Buccaneers, Los Angeles Rams, Washington Commanders, Minnesota Vikings, Green Bay Packers

**Player Object Schema:**
```json
{
  "id": "unique-id",
  "name": "Patrick Mahomes",
  "team": "KC",
  "position": "QB",
  "searchText": "patrick mahomes qb kc"
}
```

**Important Player Data Notes:**
- Include ~30-40 players per team (focus on offensive players + kickers)
- Must include: Starting QB, backup QB, all RBs, all WRs, all TEs, kicker
- `searchText` field for easy filtering (lowercase, includes name + position + team)
- Positions: QB, RB, WR, TE, K (defense not needed)
- Generate unique IDs (use team + name, e.g., "KC-PatrickMahomes")

**How to gather data:**
- Use web search to find 2024-2025 playoff team rosters
- Focus on offensive players and kickers
- Aim for ~400-500 total players across 14 teams

---

## Server Implementation (server.js)

### State Management
Store everything in memory:

```javascript
const draftState = {
  // Pre-draft phase
  phase: 'setup', // 'setup' | 'drafting' | 'complete'
  teams: [],      // Array of team objects

  // Draft phase
  draftOrder: [], // Array of team IDs in snake order
  currentPickIndex: 0,
  picks: [],      // Array of {teamId, playerId, pickNumber, timestamp}

  // Player pool
  availablePlayers: [], // Loaded from players.json
  draftedPlayerIds: new Set()
};

// Team object structure
{
  id: 'unique-uuid',
  name: 'Team Name',
  socketId: 'socket-id-for-current-connection',
  roster: {
    QB: [],
    RB: [],
    WR_TE: [], // Combined flex spots
    K: []
  }
}
```

### Socket.io Events

#### Client → Server Events:

1. **`join-draft`**
   - Payload: `{ teamName: string }`
   - Validation:
     - Team name not empty
     - Team name unique (case-insensitive)
     - Max 8 teams not reached
     - Draft hasn't started (phase === 'setup')
   - Action: Create team object, add to teams array
   - Emit: `draft-state-updated` to all clients

2. **`start-draft`**
   - Payload: none
   - Validation:
     - At least 2 teams joined
     - Phase is 'setup'
   - Action:
     - Generate snake draft order (randomize teams, then create snake pattern)
     - Set phase to 'drafting'
     - Set currentPickIndex to 0
   - Emit: `draft-started` to all clients

3. **`draft-player`**
   - Payload: `{ playerId: string }`
   - Validation:
     - Phase is 'drafting'
     - Player exists and not already drafted
     - Socket's team is the current picker
     - Team hasn't filled their roster yet
     - Team hasn't exceeded position limits
   - Action:
     - Add player to team roster (categorize by position)
     - Add pick to picks array
     - Add playerId to draftedPlayerIds
     - Increment currentPickIndex
     - Check if draft is complete (56 picks made)
     - If complete, set phase to 'complete'
   - Emit: `player-drafted` to all clients

4. **`disconnect`**
   - Action: Update team's socketId to null (team stays in draft, can reconnect)

5. **`reconnect`** (via join-draft with existing team name)
   - If team name exists, update socketId
   - Send current draft state

#### Server → Client Events:

1. **`draft-state-updated`**
   - Payload: Entire draftState object
   - When: After any state change
   - Client action: Re-render UI

2. **`draft-started`**
   - Payload: `{ draftOrder: array }`
   - When: Draft begins
   - Client action: Switch to draft board view

3. **`player-drafted`**
   - Payload: `{ playerId, teamId, teamName, playerName, pickNumber }`
   - When: Player successfully drafted
   - Client action: Show notification, update UI

4. **`error`**
   - Payload: `{ message: string }`
   - When: Validation fails
   - Client action: Show error alert

### Server Endpoints

**GET /**
- Serve `public/index.html`

**GET /api/players**
- Return available players (not drafted)
- Include filter query support: `?position=QB`

**GET /api/state**
- Return current draftState (for page refreshes)

### Position Limit Validation Logic

When validating `draft-player`:
```javascript
function canDraftPosition(team, position) {
  const limits = { QB: 1, RB: 2, WR_TE: 3, K: 1 };

  if (position === 'QB') return team.roster.QB.length < 1;
  if (position === 'RB') return team.roster.RB.length < 2;
  if (position === 'WR' || position === 'TE') {
    return team.roster.WR_TE.length < 3;
  }
  if (position === 'K') return team.roster.K.length < 1;

  return false;
}
```

### Snake Draft Order Generation

```javascript
function generateSnakeDraftOrder(teams) {
  // Shuffle teams randomly
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const order = [];

  // Total picks: 7 rounds × 8 teams = 56 picks
  for (let round = 0; round < 7; round++) {
    if (round % 2 === 0) {
      // Even rounds: normal order
      order.push(...shuffled.map(t => t.id));
    } else {
      // Odd rounds: reverse order
      order.push(...shuffled.map(t => t.id).reverse());
    }
  }

  return order;
}
```

---

## Frontend Implementation (public/)

### index.html Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playoff Fantasy Draft</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <!-- Setup Phase View -->
  <div id="setup-view" class="view">
    <h1>Playoff Fantasy Football Draft</h1>
    <div id="join-form">
      <input type="text" id="team-name-input" placeholder="Enter your team name">
      <button id="join-button">Join Draft</button>
    </div>
    <div id="teams-list">
      <h2>Teams Joined (<span id="team-count">0</span>/8)</h2>
      <ul id="teams-ul"></ul>
    </div>
    <button id="start-draft-button" style="display:none;">Start Draft</button>
  </div>

  <!-- Draft Phase View -->
  <div id="draft-view" class="view" style="display:none;">
    <div id="draft-header">
      <h1>Playoff Fantasy Draft</h1>
      <div id="current-pick-indicator"></div>
    </div>

    <div id="draft-main">
      <!-- Left sidebar: Draft order & teams -->
      <aside id="draft-sidebar">
        <div id="draft-order-section">
          <h2>Draft Order</h2>
          <div id="draft-order-list"></div>
        </div>
        <div id="teams-section">
          <h2>Teams</h2>
          <ul id="teams-roster-list"></ul>
        </div>
      </aside>

      <!-- Center: Available players -->
      <main id="players-section">
        <div id="players-header">
          <h2>Available Players</h2>
          <div id="position-filter">
            <button class="filter-btn active" data-position="ALL">All</button>
            <button class="filter-btn" data-position="QB">QB</button>
            <button class="filter-btn" data-position="RB">RB</button>
            <button class="filter-btn" data-position="WR">WR</button>
            <button class="filter-btn" data-position="TE">TE</button>
            <button class="filter-btn" data-position="K">K</button>
          </div>
          <input type="text" id="player-search" placeholder="Search players...">
        </div>
        <div id="players-grid"></div>
      </main>

      <!-- Right sidebar: Your roster & recent picks -->
      <aside id="roster-sidebar">
        <div id="your-roster-section">
          <h2>Your Roster</h2>
          <div id="your-roster"></div>
        </div>
        <div id="recent-picks-section">
          <h2>Recent Picks</h2>
          <ul id="recent-picks-list"></ul>
        </div>
      </aside>
    </div>
  </div>

  <!-- Complete Phase View -->
  <div id="complete-view" class="view" style="display:none;">
    <h1>Draft Complete!</h1>
    <div id="final-rosters"></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/app.js"></script>
</body>
</html>
```

### app.js Implementation

**State Management:**
```javascript
let socket = null;
let localState = {
  myTeamId: null,
  currentView: 'setup',
  selectedPosition: 'ALL',
  searchQuery: '',
  draftState: null
};
```

**Key Functions:**

1. **`initializeSocket()`**
   - Connect to Socket.io
   - Set up event listeners
   - Store socket in global variable

2. **`handleJoinDraft()`**
   - Get team name from input
   - Emit `join-draft` event
   - Store team ID in localStorage (for reconnection)

3. **`handleStartDraft()`**
   - Emit `start-draft` event
   - Only show button if user is first team to join

4. **`handleDraftPlayer(playerId)`**
   - Emit `draft-player` event
   - Show loading state on player card

5. **`renderSetupView(state)`**
   - Show teams list
   - Enable/disable start button based on team count

6. **`renderDraftView(state)`**
   - Render available players (filtered by position/search)
   - Render current pick indicator
   - Render draft order with current pick highlighted
   - Render your roster with position groups
   - Render recent picks (last 10)
   - Enable/disable draft buttons based on whose turn it is

7. **`renderCompleteView(state)`**
   - Show all team rosters
   - Display full draft results

8. **`filterPlayers(players, position, searchQuery)`**
   - Filter by position (if not ALL)
   - Filter by search query (match against searchText)
   - Sort by position then name

9. **`getCurrentPicker(state)`**
   - Return team object of current picker
   - Use draftOrder[currentPickIndex]

10. **`isMyTurn(state)`**
    - Check if localState.myTeamId === getCurrentPicker(state).id

11. **`canDraftPlayer(state, player)`**
    - Check if it's my turn
    - Check if I haven't filled position limit
    - Return boolean + error message if false

**Player Card Template:**
```javascript
function createPlayerCard(player, canDraft, errorMsg) {
  return `
    <div class="player-card">
      <div class="player-info">
        <div class="player-name">${player.name}</div>
        <div class="player-details">${player.position} - ${player.team}</div>
      </div>
      <button
        class="draft-btn"
        data-player-id="${player.id}"
        ${!canDraft ? 'disabled' : ''}
        title="${errorMsg || 'Draft this player'}"
      >
        Draft
      </button>
    </div>
  `;
}
```

**Roster Display Logic:**
```javascript
function renderRoster(team) {
  return `
    <div class="roster-section">
      <div class="position-group">
        <h3>QB (${team.roster.QB.length}/1)</h3>
        ${team.roster.QB.map(p => renderPlayerInRoster(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
      <div class="position-group">
        <h3>RB (${team.roster.RB.length}/2)</h3>
        ${team.roster.RB.map(p => renderPlayerInRoster(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
      <div class="position-group">
        <h3>WR/TE (${team.roster.WR_TE.length}/3)</h3>
        ${team.roster.WR_TE.map(p => renderPlayerInRoster(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
      <div class="position-group">
        <h3>K (${team.roster.K.length}/1)</h3>
        ${team.roster.K.map(p => renderPlayerInRoster(p)).join('') || '<div class="empty-slot">Empty</div>'}
      </div>
    </div>
  `;
}
```

**Socket Event Handlers:**
```javascript
socket.on('draft-state-updated', (state) => {
  localState.draftState = state;
  renderCurrentView();
});

socket.on('draft-started', (data) => {
  localState.currentView = 'drafting';
  renderDraftView(localState.draftState);
});

socket.on('player-drafted', (data) => {
  showNotification(`${data.teamName} drafted ${data.playerName}`);
});

socket.on('error', (data) => {
  alert(data.message);
});
```

### style.css Guidelines

**Design Principles:**
- Clean, functional interface
- Responsive layout (works on desktop, tablet)
- Clear visual hierarchy
- Draft buttons prominently visible but only enabled when appropriate
- Use color to indicate state:
  - Green: Your turn / Available action
  - Gray: Not your turn / Disabled
  - Blue: Your team
  - Yellow: Current pick indicator

**Key Styles Needed:**
- Grid layout for player cards (3-4 columns)
- Flexbox for main draft view (3-column: sidebar, players, roster)
- Position filter buttons (tab-like interface)
- Roster grouped by position with counts
- Current pick indicator (large, prominent banner)
- Disabled state for buttons (clear visual feedback)
- Hover effects for interactive elements
- Mobile-responsive (stack sidebars on small screens)

---

## Edge Cases & Error Handling

### Connection Issues

1. **User disconnects mid-draft**
   - Solution: Keep team in draft, allow reconnection
   - When user returns and enters same team name, reconnect to their team
   - Send full state on reconnection

2. **User refreshes page**
   - Solution: Store teamId in localStorage
   - On page load, check localStorage and auto-reconnect
   - If team doesn't exist in server state, clear localStorage

3. **Multiple tabs from same user**
   - Solution: Last tab to connect gets control
   - Update socketId when team rejoins
   - Old tab will see "Not your turn" (acceptable)

### Draft Logic Issues

4. **User tries to draft out of turn**
   - Server validation: Check socketId matches current picker
   - Client validation: Disable buttons when not your turn
   - Show clear error message

5. **Two users click same player simultaneously**
   - Server handles this with single-threaded event loop
   - First request wins
   - Second request gets error: "Player already drafted"
   - Client shows notification

6. **User tries to exceed position limit**
   - Server validation: Check roster limits before allowing pick
   - Client validation: Disable button + show tooltip explaining why
   - Error message: "You've already filled this position"

7. **User closes browser before completing roster**
   - Draft continues without them
   - When their pick comes up, other users must wait
   - Option: Add "Skip" button for commissioner (out of scope for MVP)

### Setup Phase Issues

8. **Duplicate team names**
   - Server validation: Case-insensitive name check
   - Return error: "Team name already taken"
   - Client shows error message

9. **Too many teams try to join**
   - Server validation: Max 8 teams
   - Return error: "Draft is full"

10. **User starts draft with < 2 teams**
    - Server validation: Minimum 2 teams
    - Client: Hide start button until 2+ teams

### Data Issues

11. **Player data fails to load**
    - Server startup check: Verify players.json exists and is valid JSON
    - If missing, exit with clear error message
    - Include error handling for file read

12. **Malformed player data**
    - Validate each player object has required fields
    - Skip invalid entries, log warning
    - Ensure at least 100 valid players loaded

### UI/UX Issues

13. **Very long team names**
    - CSS: Truncate with ellipsis after 20 characters
    - Show full name on hover (title attribute)

14. **Very long player names**
    - Same truncation strategy

15. **Search returns no results**
    - Show "No players found" message
    - Ensure search is case-insensitive

16. **Filter + search returns nothing**
    - Show helpful message: "No QB players match 'xyz'"

17. **User doesn't know if it's their turn**
    - Large banner at top: "YOUR TURN!" vs "Waiting for [Team Name]"
    - Color coding (green vs gray)
    - Optional: Browser notification when turn starts

---

## Testing Checklist

### Pre-Draft
- [ ] Can join draft with valid team name
- [ ] Cannot join with empty name
- [ ] Cannot join with duplicate name (case-insensitive)
- [ ] Cannot join after 8 teams
- [ ] Cannot start draft with < 2 teams
- [ ] Can start draft with 2+ teams
- [ ] Team list updates in real-time for all users

### During Draft
- [ ] Draft order is randomized
- [ ] Draft order follows snake pattern (1-8, 8-1, 1-8, etc.)
- [ ] Only current picker can draft
- [ ] Player disappears from available list after drafted
- [ ] Drafted player appears in team roster
- [ ] Pick advances to next team after successful draft
- [ ] Cannot exceed position limits (1 QB, 2 RB, 3 WR/TE, 1 K)
- [ ] WR and TE both fill WR/TE slots
- [ ] Position filter works correctly
- [ ] Search filter works correctly (case-insensitive)
- [ ] Recent picks show last 10 drafts
- [ ] All connected clients see updates instantly
- [ ] Draft completes after 56 picks (7 rounds × 8 teams)

### Post-Draft
- [ ] Draft complete screen shows all rosters
- [ ] All teams have full rosters (7 players each)
- [ ] All position requirements met for each team

### Reconnection
- [ ] User can refresh page and rejoin with same team name
- [ ] User sees current draft state after reconnection
- [ ] User can continue drafting after reconnection

### Multi-User
- [ ] 8 concurrent users can all connect
- [ ] All users see same state
- [ ] Race conditions handled (two users drafting same player)
- [ ] Test with simulated slow network (setTimeout on socket events)

---

## Deployment Instructions (README.md)

```markdown
# Playoff Fantasy Football Draft

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
node server.js
```

Server will start on port 3000 (or process.env.PORT if set).

### 3. Set Up Internet Access (ngrok)

Install ngrok:
```bash
# macOS
brew install ngrok

# Windows
choco install ngrok

# Linux
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
```

Run ngrok:
```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`) and share with all draft participants.

### 4. Draft Day Instructions
1. Start server: `node server.js`
2. Start ngrok: `ngrok http 3000`
3. Share ngrok URL with all 8 team managers
4. Everyone opens URL in browser
5. Each person enters their team name and clicks "Join Draft"
6. Once everyone has joined, first person clicks "Start Draft"
7. Draft proceeds in snake order
8. Each person drafts when it's their turn

## Roster Requirements
- 1 QB
- 2 RB
- 3 WR/TE (any combination)
- 1 K

Total picks: 7 per team × 8 teams = 56 picks

## Troubleshooting

**"Team name already taken"**
- Someone else is using that name. Choose a different name.

**Can't click Draft button**
- It's not your turn yet, or you've already filled that position.

**Accidentally closed browser**
- Reopen the URL and enter your same team name to rejoin.

**Server crashed**
- Draft state is lost (in-memory only). Restart and begin again.
- To prevent: Don't close the terminal running the server!
```

---

## Implementation Order

1. **Set up project structure**
   - Create package.json with dependencies
   - Create file structure
   - Initialize git repo

2. **Gather player data**
   - Web search for 2024-2025 NFL playoff rosters
   - Create players.json with all players
   - Validate data structure

3. **Build server.js**
   - Express setup
   - Socket.io setup
   - State management
   - Event handlers (join, start, draft)
   - Validation logic

4. **Build frontend HTML structure**
   - Create index.html with all three views
   - Set up proper IDs and classes

5. **Build frontend JavaScript**
   - Socket connection
   - Event handlers
   - Rendering functions
   - Local state management

6. **Build CSS**
   - Layout (flexbox/grid)
   - Component styles
   - Responsive design
   - Interactive states

7. **Test locally**
   - Open multiple browser tabs
   - Simulate full draft
   - Test edge cases

8. **Create README.md**
   - Setup instructions
   - Deployment guide
   - Troubleshooting

9. **Test with ngrok**
   - Start ngrok
   - Test from different devices
   - Verify internet access works

---

## Critical Success Factors

1. **Real-time sync must work perfectly**
   - All users see picks instantly
   - No race conditions on player selection
   - Use Socket.io acknowledgements if needed

2. **Turn management must be bulletproof**
   - Only current picker can draft
   - Clear visual indication of whose turn
   - Snake order must be correct

3. **Position limits must be enforced**
   - Server-side validation (critical)
   - Client-side feedback (UX)
   - WR and TE both count toward same pool

4. **User experience must be obvious**
   - No instructions needed
   - Clear what to click and when
   - ESPN-like familiar interface

5. **Reconnection must work**
   - Users can refresh without losing their spot
   - Draft state persists during draft session
   - No need to re-pick players

---

## Out of Scope (Explicitly NOT Building)

- Authentication/login system
- Database/persistence (draft ends when server stops)
- Draft timer/auto-pick
- Undo/admin controls
- Player stats/projections
- Commissioner controls (pause, reset, etc.)
- Mobile app (web-only)
- Chat feature
- Draft history/results export
- Player trades
- Multiple draft lobbies
- Defensive players/team defense
- Scoring settings (this is just for drafting)
- Email notifications
- Browser notifications (optional nice-to-have)

---

## Potential Pitfalls & Solutions

**Pitfall**: Forgetting to handle WR/TE as combined slots
**Solution**: Store in single `WR_TE` array, validate both WR and TE against this limit

**Pitfall**: Snake draft order wrong
**Solution**: Test explicitly with 8 teams, verify round 2 reverses order

**Pitfall**: Socket.io CORS issues with ngrok
**Solution**: Configure Socket.io to accept all origins in development

**Pitfall**: Multiple browsers for same team causing conflicts
**Solution**: Allow it, last connection wins, it's fine for MVP

**Pitfall**: Player search performance with 500 players
**Solution**: Client-side filtering is fine for this size, no need for server-side search

**Pitfall**: Forgetting to show current pick indicator prominently
**Solution**: Make it largest element on page, can't miss it

**Pitfall**: Draft gets stuck if someone leaves
**Solution**: Acceptable for MVP, require all 8 people to stay for duration

---

## Package.json Template

```json
{
  "name": "playoff-fantasy-draft",
  "version": "1.0.0",
  "description": "Real-time fantasy football draft for NFL playoffs",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1"
  },
  "engines": {
    "node": ">=14.0.0"
  }
}
```

---

## Final Notes for Implementing Agent

- **Prioritize functionality over aesthetics** - It needs to work perfectly, not look perfect
- **Test the snake draft logic carefully** - This is where bugs often hide
- **Make the "current pick" indicator impossible to miss** - Biggest UX pain point if unclear
- **Use web search to get actual 2024-2025 playoff rosters** - Don't make up player names
- **Include plenty of console.log statements** - Helpful for debugging during draft
- **Keep error messages user-friendly** - These are friends playing a game, not developers
- **Test with multiple browser tabs extensively** - Simulate 8-person draft locally first
- **Remember ngrok URLs expire** - Include this in README so user knows

Good luck! This is a straightforward project if you follow the plan systematically. The real-time sync is the most complex part, but Socket.io handles most of it for you.
