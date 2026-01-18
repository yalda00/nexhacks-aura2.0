# Quick Start - Testing Guide

## Easiest Way to Test

Use the **simple server** (no interactive input needed):

### Terminal 1 - Start Simple Server
```bash
python3 websocket_server_simple.py
```

Should show:
```
WebSocket Server (Simple Mode)
Listening on: ws://localhost:8765
Status: Waiting for parser to connect...
```

### Terminal 2 - Start Claude Code
```bash
./aura.sh
```

Wait for parser to show:
```
✓ Connected to websocket server at ws://localhost:8765
✓ Bidirectional mode: sending responses AND receiving queries
```

### Terminal 3 - Send Test Query
```bash
python3 test_query.py
```

**Watch Terminal 2** - You should see the query appear in Claude Code automatically!

## Send Custom Queries

```bash
python3 test_query.py "List Python files in this directory"
```

## What Should Happen

1. **Terminal 3**: You run `test_query.py` → sends query via WebSocket
2. **Parser** (background): Receives query → injects into tmux session
3. **Terminal 2**: Query appears in Claude Code → Claude responds
4. **Terminal 1**: Shows Claude's response

## Verification

Check these in order:

1. **Server running?**
   ```bash
   lsof -i :8765
   ```
   Should show Python listening on port 8765

2. **Parser connected?**
   Look for "✓ Connected to websocket server" in Terminal 2

3. **Tmux session exists?**
   ```bash
   tmux ls
   ```
   Should show: `claude_aura: 1 windows`

4. **Test direct injection:**
   ```bash
   tmux send-keys -t claude_aura "Test message" Enter
   ```
   Should appear immediately in Claude Code

## If websocket_server.py Doesn't Work

Use `websocket_server_simple.py` instead - it's more reliable and doesn't require interactive input.

## Troubleshooting

### "Module websockets not found"
```bash
pip3 install websockets
```

### "tmux not found"
```bash
brew install tmux
```

### Port 8765 already in use
```bash
lsof -i :8765
kill <PID>
```

### Query doesn't appear in Claude
- Check parser is running: `ps aux | grep parser.py`
- Check tmux session: `tmux attach -t claude_aura` (Ctrl+B then D to detach)
- Look for errors in parser output

## Expected Output

**Terminal 1 (Server):**
```
✓ Client connected (123456789)
📥 Received from Claude:
   Text: [Claude's response text]...
```

**Terminal 2 (Parser background output):**
```
📥 Received query from websocket
⌨️  Injected query: What is the current working directory?
⏺ New response started: The current working directory is...
✓ Captured response: The current working directory is...
📤 Sent to websocket
```

**Terminal 2 (Claude Code visible):**
```
> What is the current working directory?

The current working directory is /Users/swan/Desktop/claudecodeaura
```
