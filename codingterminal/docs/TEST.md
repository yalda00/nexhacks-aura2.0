# Testing Bidirectional WebSocket Communication

This guide will help you test that queries can be sent to Claude Code via WebSocket.

## Quick Test (Easiest Method)

### Step 1: Start the WebSocket server
Open **Terminal 1**:
```bash
cd /Users/swan/Desktop/claudecodeaura
python3 websocket_server.py
```

You should see:
```
WebSocket server starting on ws://localhost:8765
Waiting for parser to connect...
```

### Step 2: Start Claude Code with the parser
Open **Terminal 2**:
```bash
cd /Users/swan/Desktop/claudecodeaura
./aura.sh
```

You should see:
```
Starting parser...
Starting Claude session in tmux...
```

The parser terminal should show:
```
✓ Connected to websocket server at ws://localhost:8765
✓ Bidirectional mode: sending responses AND receiving queries
```

Claude Code should launch normally.

### Step 3: Send a test query
Open **Terminal 3**:
```bash
cd /Users/swan/Desktop/claudecodeaura
python3 test_query.py
```

This sends a default test query: "What is the current working directory?"

### Step 4: Watch it appear in Claude Code
In **Terminal 2** (where Claude Code is running), you should see:
1. The query automatically typed into the prompt
2. Claude Code processing and responding to it

The parser output should show:
```
📥 Received query from websocket
⌨️  Injected query: What is the current working directory?
```

## Alternative: Manual Query from WebSocket Server

Instead of Step 3 above, you can type directly in **Terminal 1** (WebSocket server):

```
Send query > List all files in this directory
```

Press Enter, and the query will be injected into Claude Code.

## Testing Custom Queries

Send any custom query:

```bash
python3 test_query.py "Explain what aura.sh does"
```

or

```bash
python3 test_query.py "What Python version am I using?"
```

## Verification Checklist

✓ Parser connects to WebSocket server
✓ Query appears in Claude Code prompt
✓ Claude Code responds to the query
✓ Response is captured and sent back to WebSocket server

## Troubleshooting

### "Could not connect to WebSocket server"
- Make sure Terminal 1 is running `websocket_server.py`
- Check that port 8765 is not in use: `lsof -i :8765`

### Query doesn't appear in Claude Code
- Check that `aura.sh` is running in a tmux session: `tmux ls`
- Should see: `claude_aura: 1 windows`
- Check parser output for error messages

### "tmux not found"
Install tmux:
```bash
brew install tmux
```

### Query appears but isn't executed
- This is expected - the query is typed but Enter is pressed automatically
- Claude Code should process it immediately

### Want to see the tmux session directly
Attach to the session:
```bash
tmux attach -t claude_aura
```

Detach with: `Ctrl+B` then `D`

## Advanced Testing: Direct Tmux Injection

You can test the tmux injection directly without WebSocket:

```bash
# Send a query directly to the tmux session
tmux send-keys -t claude_aura "Hello Claude" Enter
```

This should inject "Hello Claude" into the Claude Code session.

## Expected Flow

```
You (Terminal 3)
    |
    | python3 test_query.py "your query"
    v
WebSocket Server (Terminal 1)
    |
    | {"type": "query", "query": "..."}
    v
Parser (Background)
    |
    | tmux send-keys -t claude_aura "..." Enter
    v
Claude Code (Terminal 2)
    |
    | [Processes query and responds]
    v
Parser captures response
    |
    | {"type": "response", "content": {...}}
    v
WebSocket Server (Terminal 1)
```

## Success Indicators

When everything works, you'll see:

**Terminal 1 (WebSocket Server):**
```
✓ Client connected
📥 Received from Claude:
   Text: [Claude's response]...
```

**Parser Output:**
```
📥 Received query from websocket
⌨️  Injected query: What is the current working directory?
✓ Captured response: [response text]
📤 Sent to websocket
```

**Terminal 2 (Claude Code):**
```
> What is the current working directory?
[Claude's response]
```
