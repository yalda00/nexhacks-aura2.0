#!/bin/bash

# -----------------------------
# Live Claude + Parser Launcher
# -----------------------------

# Log file for 'script' command
LOG_FILE="logs/claude_session.log"

# Python parser script
PARSER="parser.py"

# Tmux session name
TMUX_SESSION="claude_aura"

# Function to clean up on exit
cleanup() {
    echo "Stopping..."
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null
    pkill -P $$ 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

# Start the parser in the background
echo "Starting parser..."
python3 "$PARSER" &
PARSER_PID=$!

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed. Please install it with: brew install tmux"
    exit 1
fi

# Kill existing session if it exists
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null

# Start Claude in a tmux session with script logging
echo "Starting Claude session in tmux..."
tmux new-session -d -s "$TMUX_SESSION" "script -q $LOG_FILE claude"

# Attach to the tmux session (blocks until user exits)
tmux attach-session -t "$TMUX_SESSION"

# When claude exits, clean up
echo "Claude session ended."
kill $PARSER_PID 2>/dev/null
