# Playoff Fantasy Football Draft

A real-time web application for conducting a fantasy football draft for NFL playoff teams. 8 teams can draft players remotely over the internet with instant updates for all participants.

## Features

- Real-time draft updates via WebSocket
- Snake draft format (1-8, then 8-1, repeat)
- Position limits enforced (1 QB, 2 RB, 3 WR/TE, 1 K)
- Search and filter players by position
- Reconnect support if you refresh or lose connection
- Clean, responsive UI that works on desktop and tablet

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Server

```bash
npm start
```

Server will start on port 3000 (or use `PORT` environment variable).

### 3. Set Up Internet Access (ngrok)

Install ngrok if you haven't already:

```bash
# macOS
brew install ngrok

# Windows
choco install ngrok

# Or download from https://ngrok.com/download
```

Run ngrok to expose your local server:

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`) and share with all draft participants.

**Note:** Free ngrok URLs expire after a few hours. You may need to restart ngrok and share a new URL if your session expires.

## Draft Day Instructions

1. Start the server: `npm start`
2. Start ngrok: `ngrok http 3000`
3. Share the ngrok HTTPS URL with all 8 team managers
4. Everyone opens the URL in their browser
5. Each person enters their team name and clicks "Join Draft"
6. Once everyone has joined, anyone can click "Start Draft"
7. Draft proceeds in snake order
8. Each person drafts when it's their turn

## Roster Requirements

Each team must draft:
- **1 QB** (Quarterback)
- **2 RB** (Running Back)
- **3 WR/TE** (Wide Receiver or Tight End - any combination)
- **1 K** (Kicker)

**Total picks:** 7 per team = 56 picks for 8 teams

## Troubleshooting

### "Team name already taken"
Someone else is using that name. Choose a different name, or if it's your team, enter the same name to reconnect.

### Can't click Draft button
- It's not your turn yet (wait for your pick)
- You've already filled that position slot

### Accidentally closed browser
Reopen the URL and enter your **exact same team name** to rejoin the draft.

### Server crashed
Draft state is stored in memory only. If the server stops, the draft is lost and you'll need to start over. Don't close the terminal running the server!

### Not seeing updates
Check your internet connection. The app uses WebSocket for real-time updates.

## Technical Details

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** Vanilla JavaScript (no frameworks)
- **State:** In-memory (no database)
- **Player Data:** Mock data for 14 NFL playoff teams

## Player Pool

Players from the 2024-2025 NFL Playoff teams:

**AFC:** Chiefs, Bills, Ravens, Texans, Chargers, Steelers, Broncos

**NFC:** Lions, Eagles, Buccaneers, Rams, Commanders, Vikings, Packers
