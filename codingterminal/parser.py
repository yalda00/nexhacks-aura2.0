import re
import json
import asyncio
import websockets
import subprocess
import os
import sys

# Paths
SCRIPT_FILE = "logs/claude_session.log"
JSON_FILE = "logs/responses.json"
TMUX_SESSION = "claude_aura"

# WebSocket URL - can be configured via:
# 1. Command line argument: python parser.py ws://your-ngrok-url
# 2. Environment variable: BRIDGE_WS_URL=ws://your-ngrok-url python parser.py
# 3. Default: ws://localhost:8765
if len(sys.argv) > 1:
    WS_URL = sys.argv[1]
else:
    WS_URL = os.environ.get("BRIDGE_WS_URL", "ws://localhost:8765")

# Regex to remove ANSI escape codes
ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

# Noise prefixes to ignore (but NOT ❯ since that's used for options)
ignore_prefixes = ("WRITE", "READ", "✽", "g)")

# Lines to completely ignore (terminal UI noise)
noise_patterns = [
    "? for shortcuts",
    "ctrl+c to interrupt",
    "Esc to",
    "thought for",
    "Flibbertigibbeting",
    "Prestidigitating",
    "Cascading",
    "\x07",  # Bell character
    "0;",    # ANSI escape sequences
]

def is_separator(line):
    """Check if line is a separator (made of ─ or ╌ characters)"""
    return line and (line.replace('─', '') == '' or line.replace('╌', '') == '')

def clean_line(line):
    return ansi_escape.sub('', line).strip()

# Clear responses.json on every start
responses = []
with open(JSON_FILE, "w", encoding="utf-8") as f:
    json.dump(responses, f, ensure_ascii=False, indent=2)

print("Live parser running. Starting fresh.")
print(f"WebSocket URL: {WS_URL}")
print("Watching for new responses only...\n")

def process_line(line, current_capture, collecting_options, responses):
    """Process a single line and update state"""
    line = clean_line(line)
    if not line or line.startswith(ignore_prefixes):
        return current_capture, collecting_options

    # Skip lines containing terminal UI noise
    if any(pattern in line for pattern in noise_patterns):
        return current_capture, collecting_options

    # New ⏺ line → save previous capture and start new
    if line.startswith("⏺"):
        if current_capture:
            responses.append(current_capture)
            print(f"✓ Captured response: {current_capture['text'][:60]}{'...' if len(current_capture['text']) > 60 else ''}")
        current_capture = {'text': line[1:].strip(), 'options': []}
        collecting_options = False  # Don't assume options yet
        print(f"⏺ New response started: {current_capture['text'][:60]}")
    else:
        # Check for ❯ symbol AND question mark - indicates actual choices (not just a list)
        if line.startswith("❯") and current_capture and '?' in current_capture['text']:
            # This is the start of actual choices
            collecting_options = True
            # Try to parse the option
            option_match = re.match(r'^❯\s*(\d+)\.\s*(.*)', line)
            if option_match:
                option_text = option_match.group(2).strip()
                if not (option_text.startswith('(') and option_text.endswith(')')):
                    current_capture['options'].append(option_text)
                    print(f"  + Option {option_match.group(1)}: {option_text[:50]}")
            return current_capture, collecting_options
        # If we see ❯ but no question mark, it's not a choice - reset collecting
        elif line.startswith("❯"):
            collecting_options = False
            return current_capture, collecting_options

        # If we're currently collecting options (started with ❯)
        if collecting_options:
            # Match continuation of numbered options: "2. Option text"
            option_match = re.match(r'^\s*(\d+)\.\s*(.*)', line)
            if option_match:
                option_text = option_match.group(2).strip()
                # Skip if it's just a hint in parentheses
                if not (option_text.startswith('(') and option_text.endswith(')')):
                    current_capture['options'].append(option_text)
                    print(f"  + Option {option_match.group(1)}: {option_text[:50]}")
                return current_capture, collecting_options
            # If line is a hint or instructions, skip but keep collecting
            elif line.startswith('(') or 'Esc to cancel' in line or 'Tab to' in line:
                return current_capture, collecting_options
            # If line doesn't match option format and isn't a separator, stop collecting
            elif line and not is_separator(line):
                collecting_options = False

        # Otherwise, append as continuation of text (skip separators)
        if current_capture and line and not is_separator(line):
            current_capture['text'] += " " + line

    return current_capture, collecting_options

async def send_to_websocket(websocket, response_data, last_response_with_options):
    """Send new response to websocket server"""
    try:
        payload = json.dumps({"type": "response", "content": response_data})
        await websocket.send(payload)
        print(f"📤 Sent to websocket")

        # Track if this response has options
        if response_data.get('options'):
            last_response_with_options['data'] = response_data

    except Exception as e:
        print(f"❌ Failed to send to websocket: {e}")

def inject_query_to_claude(query):
    """Inject a query into the Claude tmux session by simulating typing"""
    import time
    try:
        # Send the query text
        subprocess.run(
            ["tmux", "send-keys", "-t", TMUX_SESSION, query],
            check=True,
            capture_output=True
        )
        # Small delay
        time.sleep(0.1)
        # Send Escape then Enter to submit
        subprocess.run(
            ["tmux", "send-keys", "-t", TMUX_SESSION, "Escape"],
            check=True,
            capture_output=True
        )
        time.sleep(0.05)
        subprocess.run(
            ["tmux", "send-keys", "-t", TMUX_SESSION, "Enter"],
            check=True,
            capture_output=True
        )
        print(f"⌨️  Injected query: {query[:60]}{'...' if len(query) > 60 else ''}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to inject query: {e}")
        return False
    except FileNotFoundError:
        print(f"❌ tmux not found. Please install tmux.")
        return False

def inject_action_to_claude(action_number):
    """Inject an action selection (number) into the Claude tmux session by navigating with arrow keys"""
    import time
    try:
        # Navigate down (action_number - 1) times
        # Option 1 = 0 downs, Option 2 = 1 down, Option 3 = 2 downs, etc.
        down_presses = action_number - 1

        for i in range(down_presses):
            subprocess.run(
                ["tmux", "send-keys", "-t", TMUX_SESSION, "Down"],
                check=True,
                capture_output=True
            )
            time.sleep(0.05)  # Small delay between presses

        # Send Enter to confirm selection
        time.sleep(0.05)
        subprocess.run(
            ["tmux", "send-keys", "-t", TMUX_SESSION, "Enter"],
            check=True,
            capture_output=True
        )
        print(f"✓ Selected action {action_number} (pressed Down {down_presses} times)")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to inject action: {e}")
        return False
    except FileNotFoundError:
        print(f"❌ tmux not found. Please install tmux.")
        return False

def parse_number(content):
    """Parse a number from content (handles digits and spelled-out numbers)"""
    # Mapping of spelled-out numbers
    word_to_num = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
        'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
        'ten': 10
    }

    content = str(content).strip().lower()

    # Try to parse as digit
    if content.isdigit():
        return int(content)

    # Try to parse as spelled-out number
    if content in word_to_num:
        return word_to_num[content]

    return None

async def listen_for_queries(websocket, last_response_with_options):
    """Listen for incoming query messages from websocket"""
    try:
        async for message in websocket:
            print(f"📨 Raw message received: {message[:100]}")
            try:
                data = json.loads(message)
                print(f"📋 Parsed message type: {data.get('type')}")

                # Handle query injection
                if data.get("type") == "query":
                    query = data.get("query") or data.get("content")
                    if query:
                        print(f"📥 Received query from websocket")
                        inject_query_to_claude(query)
                    else:
                        print(f"⚠ Received query message but no query content found")

                # Handle action selection
                elif data.get("type") == "action":
                    content = data.get("content")
                    if content:
                        print(f"📥 Received action from websocket: {content}")
                        action_num = parse_number(content)

                        if action_num is not None:
                            success = inject_action_to_claude(action_num)
                            if success:
                                # Send confirmation back
                                confirm_msg = json.dumps({
                                    "type": "confirmation",
                                    "content": "Action received"
                                })
                                await websocket.send(confirm_msg)
                                print(f"📤 Sent confirmation: Action received")
                        else:
                            print(f"⚠ Could not parse '{content}' as a number")
                            # Resend the last response with options, but with error text
                            if last_response_with_options.get('data'):
                                retry_response = {
                                    'text': f"Please provide a number for your choice (you entered '{content}' which is not valid). Choose from the options below:",
                                    'options': last_response_with_options['data']['options']
                                }
                                retry_msg = json.dumps({
                                    "type": "response",
                                    "content": retry_response
                                })
                                await websocket.send(retry_msg)
                                print(f"📤 Sent retry request with same options")
                            else:
                                # No previous options to resend
                                error_msg = json.dumps({
                                    "type": "error",
                                    "content": "Please provide a valid number"
                                })
                                await websocket.send(error_msg)
                    else:
                        print(f"⚠ Received action message but no content found")

            except json.JSONDecodeError:
                print(f"⚠ Received non-JSON message: {message[:50]}")
            except Exception as e:
                print(f"❌ Error processing message: {e}")

    except websockets.exceptions.ConnectionClosed:
        print("⚠ WebSocket connection closed")
    except Exception as e:
        print(f"❌ Error in query listener: {e}")

async def parse_log_file(websocket, last_response_with_options):
    """Parse the log file and send responses to websocket"""
    with open(SCRIPT_FILE, "r", encoding="utf-8", errors="ignore") as f:
        # Skip to end of file (only watch for new content)
        f.seek(0, 2)

        current_capture = None
        collecting_options = False

        while True:
            line = f.readline()
            if not line:
                await asyncio.sleep(0.1)
                continue

            old_capture_id = id(current_capture) if current_capture else None
            current_capture, collecting_options = process_line(
                line, current_capture, collecting_options, responses
            )
            new_capture_id = id(current_capture) if current_capture else None

            # If the capture object changed (new response started), old one is complete
            if old_capture_id and new_capture_id and old_capture_id != new_capture_id:
                # The previous response was just completed
                if responses:
                    completed_response = responses[-1]
                    if websocket:
                        try:
                            await send_to_websocket(websocket, completed_response, last_response_with_options)
                        except:
                            pass

            # Flush to JSON with current capture
            if current_capture:
                full_list = responses + [current_capture]
                with open(JSON_FILE, "w", encoding="utf-8") as jf:
                    json.dump(full_list, jf, ensure_ascii=False, indent=2)

async def main():
    # Shared dictionary to track the last response with options
    last_response_with_options = {}

    while True:
        websocket = None
        try:
            # Try to connect to websocket server with keepalive
            websocket = await websockets.connect(
                WS_URL,
                ping_interval=20,  # Send ping every 20 seconds
                ping_timeout=10    # Wait 10 seconds for pong response
            )
            print(f"✓ Connected to websocket server at {WS_URL}")
            print(f"✓ Bidirectional mode: sending responses AND receiving queries")

            # Run both tasks concurrently
            await asyncio.gather(
                parse_log_file(websocket, last_response_with_options),
                listen_for_queries(websocket, last_response_with_options)
            )
        except websockets.exceptions.ConnectionClosed:
            print("⚠ WebSocket connection closed. Reconnecting in 3 seconds...")
            await asyncio.sleep(3)
        except Exception as e:
            print(f"⚠ WebSocket error: {e}. Reconnecting in 3 seconds...")
            await asyncio.sleep(3)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nParser stopped.")
