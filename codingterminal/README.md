# Claude Code Aura

Bidirectional WebSocket integration for Claude Code - capture responses and inject queries.

## Features

- 📤 **Outgoing**: Sends Claude Code responses to WebSocket server
- 📥 **Incoming**: Receives queries from WebSocket and injects them into active Claude session
- 🔄 **Real-time**: Uses tmux to simulate typing into the live session
- 📝 **Logging**: All interactions saved to `logs/claude_session.log` and `logs/responses.json`

## Quick Start

1. **Install requirements:**
   ```bash
   brew install tmux
   pip3 install -r requirements.txt
   ```

2. **Terminal 1** - Start WebSocket server:
   ```bash
   python3 examples/websocket_server.py
   ```

3. **Terminal 2** - Start Claude Code with parser:
   ```bash
   ./aura.sh
   ```

4. **Terminal 3** - Send test query:
   ```bash
   python3 examples/test_query.py
   ```

Query appears automatically in Claude Code!

## Project Structure

```
claudecodeaura/
├── aura.sh                 # Main launcher (starts Claude + parser)
├── parser.py               # Bidirectional bridge (watches logs + receives queries)
├── requirements.txt        # Python dependencies
├── docs/                   # Documentation
│   ├── QUICKSTART.md       # Step-by-step testing guide
│   ├── USAGE.md            # Detailed usage documentation
│   └── TEST.md             # Testing procedures
├── examples/               # Example servers and test scripts
│   ├── websocket_server.py # Interactive WebSocket server
│   ├── test_query.py       # CLI tool to send test queries
│   ├── server.py           # Alternative WebSocket server
│   ├── fastapi_ws.py       # FastAPI WebSocket example
│   └── [test scripts...]   # Various test clients
├── logs/                   # All log files and output
│   ├── claude_session.log  # Claude Code session transcript
│   ├── responses.json      # Parsed Claude responses
│   ├── parser.log          # Parser debug logs
│   └── [other logs...]     # Runtime logs
└── archive/                # Old/unused files
```

## Message Format

### Outgoing (Parser → WebSocket)

**Response:**
```json
{
  "type": "response",
  "content": {
    "text": "Claude's response text",
    "options": ["Option 1", "Option 2"]
  }
}
```

### Incoming (WebSocket → Parser)

**Query Injection:**
```json
{
  "type": "query",
  "query": "Your question or command here"
}
```

## Architecture

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│  Claude Code    │ stdout  │  parser.py   │ webskt  │ WebSocket Server│
│  (in tmux)      │────────>│              │<───────>│  (your app)     │
│                 │<────────│  tmux inject │         │                 │
└─────────────────┘ stdin   └──────────────┘         └─────────────────┘
```

## Configuration

Edit `parser.py` to change:
- `WS_URL = "ws://localhost:8765"` - WebSocket server address
- `TMUX_SESSION = "claude_aura"` - Tmux session name

## Use Cases

1. **Voice Control**: Send queries from voice assistant → Claude Code
2. **Remote Control**: Control Claude from web interface
3. **Automation**: Trigger Claude actions from external events
4. **Monitoring**: Capture and analyze Claude's responses
5. **Multi-Agent**: Orchestrate Claude with other AI agents

## Documentation

- **[QUICKSTART.md](docs/QUICKSTART.md)** - Quick testing guide
- **[USAGE.md](docs/USAGE.md)** - Detailed usage instructions
- **[TEST.md](docs/TEST.md)** - Testing procedures and troubleshooting

## Troubleshooting

**Common issues:**
- `tmux not found` → `brew install tmux`
- `websockets module not found` → `pip3 install -r requirements.txt`
- Query doesn't inject → Check tmux session: `tmux ls`
- Port 8765 in use → Kill old process: `lsof -i :8765`

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for detailed troubleshooting.
