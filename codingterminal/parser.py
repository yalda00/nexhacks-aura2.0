import re
import json
import asyncio
import websockets
import subprocess

# Paths
SCRIPT_FILE = "logs/claude_session.log"
JSON_FILE = "logs/responses.json"
WS_URL = "ws://localhost:8765"
TMUX_SESSION = "claude_aura"

# Regex to remove ANSI escape codes
ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

# Noise prefixes to ignore (but NOT ❯ since that's used for options)
ignore_prefixes = ("WRITE", "READ", "✽", "g)")

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
print("Watching for new responses only...\n")

def process_line(line, current_capture, collecting_options, responses):
    """Process a single line and update state"""
    line = clean_line(line)
    if not line or line.startswith(ignore_prefixes):
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

async def send_to_websocket(websocket, response_data):
    """Send new response to websocket server"""
    try:
        payload = json.dumps({"type": "response", "content": response_data})
        await websocket.send(payload)
        print(f"📤 Sent to websocket")
    except Exception as e:
        print(f"❌ Failed to send to websocket: {e}")

def inject_query_to_claude(query):
    """Inject a query into the Claude tmux session by simulating typing"""
    try:
        # Send the query text to the tmux session
        subprocess.run(
            ["tmux", "send-keys", "-t", TMUX_SESSION, query, "Enter"],
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

async def listen_for_queries(websocket):
    """Listen for incoming query messages from websocket"""
    try:
        async for message in websocket:
            try:
                data = json.loads(message)

                # Handle query injection
                if data.get("type") == "query":
                    query = data.get("query") or data.get("content")
                    if query:
                        print(f"📥 Received query from websocket")
                        inject_query_to_claude(query)
                    else:
                        print(f"⚠ Received query message but no query content found")

            except json.JSONDecodeError:
                print(f"⚠ Received non-JSON message: {message[:50]}")
            except Exception as e:
                print(f"❌ Error processing message: {e}")

    except websockets.exceptions.ConnectionClosed:
        print("⚠ WebSocket connection closed")
    except Exception as e:
        print(f"❌ Error in query listener: {e}")

async def parse_log_file(websocket):
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
                            await send_to_websocket(websocket, completed_response)
                        except:
                            pass

            # Flush to JSON with current capture
            if current_capture:
                full_list = responses + [current_capture]
                with open(JSON_FILE, "w", encoding="utf-8") as jf:
                    json.dump(full_list, jf, ensure_ascii=False, indent=2)

async def main():
    websocket = None

    # Try to connect to websocket server
    try:
        websocket = await websockets.connect(WS_URL)
        print(f"✓ Connected to websocket server at {WS_URL}")
        print(f"✓ Bidirectional mode: sending responses AND receiving queries")
    except Exception as e:
        print(f"⚠ Could not connect to websocket server: {e}")
        print("  Parser will continue without websocket broadcasting")

    # Run both tasks concurrently
    if websocket:
        await asyncio.gather(
            parse_log_file(websocket),
            listen_for_queries(websocket)
        )
    else:
        # If no websocket, just parse logs
        await parse_log_file(None)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nParser stopped.")
