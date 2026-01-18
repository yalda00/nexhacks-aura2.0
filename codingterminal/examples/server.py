import asyncio
import json
import websockets

# Store all connected clients
connected_clients = set()

async def handler(websocket):
    # Add new client
    connected_clients.add(websocket)
    print(f"Client connected (total: {len(connected_clients)})")

    try:
        async for message in websocket:
            print("Received from client:", message)
            # Broadcast to all OTHER clients (not the sender)
            other_clients = connected_clients - {websocket}
            if other_clients:
                await asyncio.gather(
                    *(client.send(message) for client in other_clients),
                    return_exceptions=True
                )
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)
        print(f"Client disconnected (total: {len(connected_clients)})")

async def broadcast_new_data(new_data):
    if connected_clients:  # Only broadcast if there are clients
        payload = json.dumps({"type": "response", "content": [new_data]})
        await asyncio.gather(*(client.send(payload) for client in connected_clients))

import asyncio
import json
import websockets
import psutil
import time
import os

# Store all connected clients
connected_clients = set()


def find_claude_tty(process_name="claude"):
    """Try to find the TTY device path for a running 'claude' process.
    Returns a path like '/dev/ttys000' or None if not found.
    """
    for p in psutil.process_iter(["name", "cmdline", "terminal"]):
        try:
            name = p.info.get("name") or ""
            cmdline = " ".join(p.info.get("cmdline") or [])
            terminal = p.info.get("terminal")
            if process_name in name or process_name in cmdline:
                if terminal:
                    # psutil may return '/dev/ttys000' or 'ttys000'
                    if terminal.startswith("/dev/"):
                        return terminal
                    return os.path.join("/dev", terminal)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


def simulate_typing_to_tty(tty_path, text, char_delay=0.02):
    """Open the TTY and write the text with small delays to simulate typing.
    Appends a newline at the end.
    """
    try:
        # Open in binary mode and unbuffered
        with open(tty_path, "wb", buffering=0) as f:
            for ch in text:
                f.write(ch.encode())
                f.flush()
                time.sleep(char_delay)
            # send newline (Enter)
            f.write(b"\n")
            f.flush()
        print(f"Typed to {tty_path}: {text}")
        return True
    except Exception as e:
        print(f"Failed to type to {tty_path}: {e}")
        return False


async def handler(websocket, path):
    # Add new client
    connected_clients.add(websocket)
    print("Client connected")

    try:
        async for message in websocket:
            print("Received from client:", message)
            # Try to parse JSON and handle typing commands
            try:
                payload = json.loads(message)
            except Exception:
                payload = None

            if isinstance(payload, dict):
                # Accept different keys that might carry user queries
                text = None
                if payload.get("type") in ("input", "type", "query"):
                    text = payload.get("content") or payload.get("text") or payload.get("query")
                # Allow shorthand: {"query": "..."}
                if not text:
                    text = payload.get("query") or payload.get("content")

                if text:
                    tty = find_claude_tty()
                    if tty:
                        # simulate typing into the claude session
                        simulate_typing_to_tty(tty, str(text))
                    else:
                        print("No claude tty found; cannot type into session.")
            # otherwise ignore or log
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)
        print("Client disconnected")


async def broadcast_new_data(new_data):
    if connected_clients:  # Only broadcast if there are clients
        payload = json.dumps({"type": "response", "content": [new_data]})
        await asyncio.gather(*(client.send(payload) for client in connected_clients))


async def simulate_data():
    # Example: simulate new JSON data every 5 seconds
    counter = 1
    while True:
        new_data = {"id": counter, "message": f"Hello {counter}"}
        await broadcast_new_data(new_data)
        counter += 1
        await asyncio.sleep(5)


async def main():
    async with websockets.serve(handler, "localhost", 8765):
        print("WebSocket server running on ws://localhost:8765")
        await simulate_data()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Server shutting down")
