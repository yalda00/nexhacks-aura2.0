# Claude Code Aura - Bidirectional WebSocket Setup

This setup allows you to:
1. Send Claude Code responses to a WebSocket server
2. Receive queries from the WebSocket and inject them into the active Claude Code session

## Prerequisites

Install tmux if not already installed:
```bash
brew install tmux
```

## How It Works

1. **aura.sh** - Launches Claude Code in a tmux session named `claude_aura` and starts the parser
2. **parser.py** - Watches Claude Code output AND listens for incoming queries from WebSocket
3. **websocket_server.py** - Example WebSocket server that can send queries back to Claude Code

## Architecture

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│  Claude Code    │ stdout  │  parser.py   │ webskt  │ WebSocket Server│
│  (in tmux)      │────────>│              │<───────>│  (your app)     │
│                 │<────────│  tmux inject │         │                 │
└─────────────────┘ stdin   └──────────────┘         └─────────────────┘
```

## Usage

### 1. Start the WebSocket Server (Terminal 1)
```bash
python3 websocket_server.py
```

### 2. Start Claude Code with Parser (Terminal 2)
```bash
./aura.sh
```

This will:
- Start the parser in the background
- Launch Claude Code inside a tmux session
- Parser connects to WebSocket server at `ws://localhost:8765`
- Parser monitors Claude output and listens for incoming queries

### 3. Send Queries to Claude Code

From your WebSocket server, send JSON messages with this format:

```json
{
  "type": "query",
  "query": "What files are in this directory?"
}
```

or

```json
{
  "type": "query",
  "content": "Help me debug this error"
}
```

The parser will inject the query into the active Claude Code session using `tmux send-keys`, simulating typing.

### Example: Send Query from WebSocket Server

If using the example `websocket_server.py`, just type your query in the terminal and press Enter:

```
Send query > What is the current working directory?
```

The query will be injected into Claude Code automatically.

## Message Format

### From Parser to WebSocket (Responses)
```json
{
  "type": "response",
  "content": {
    "text": "Claude's response text",
    "options": ["Option 1", "Option 2"]
  }
}
```

### From WebSocket to Parser (Queries)
```json
{
  "type": "query",
  "query": "Your question or command here"
}
```

## Configuration

Edit these values in the files if needed:

**parser.py:**
- `WS_URL = "ws://localhost:8765"` - WebSocket server address
- `TMUX_SESSION = "claude_aura"` - Tmux session name

**websocket_server.py:**
- `port = 8765` - WebSocket server port

## Troubleshooting

**Query not being injected:**
- Ensure tmux is installed: `brew install tmux`
- Check that the tmux session exists: `tmux ls | grep claude_aura`
- Verify the parser is running and connected to WebSocket

**Parser can't connect to WebSocket:**
- Make sure the WebSocket server is running first
- Check the URL matches: `ws://localhost:8765`
- Parser will continue without WebSocket if connection fails

**Multiple queries being sent:**
- There's a slight delay between injection and execution
- Wait for Claude to respond before sending the next query

## Customizing Your WebSocket Server

Replace `websocket_server.py` with your own server implementation. Key points:

1. Listen on `ws://localhost:8765` (or update `parser.py`)
2. Accept connections from the parser
3. Receive `{"type": "response", ...}` messages with Claude's output
4. Send `{"type": "query", "query": "..."}` messages to inject queries

## Detaching from Tmux

If you need to detach from the Claude session without closing it:
- Press `Ctrl+B` then `D`
- Reattach with: `tmux attach -t claude_aura`
