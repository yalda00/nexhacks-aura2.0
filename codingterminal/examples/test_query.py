#!/usr/bin/env python3
"""
Simple script to test sending a query to Claude Code via WebSocket.
Run this while aura.sh is running to inject a test query.
"""

import asyncio
import websockets
import json
import sys

WS_URL = "ws://localhost:8765"

async def send_query(query):
    """Send a single query to Claude Code"""
    try:
        async with websockets.connect(WS_URL) as websocket:
            message = json.dumps({
                "type": "query",
                "query": query
            })

            await websocket.send(message)
            print(f"✓ Query sent: {query}")

            # Wait a moment for any response
            await asyncio.sleep(1)

    except ConnectionRefusedError:
        print("❌ Could not connect to WebSocket server")
        print("   Make sure the WebSocket server is running at ws://localhost:8765")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Default test query
        query = "What is the current working directory?"
    else:
        # Use provided query
        query = " ".join(sys.argv[1:])

    print(f"Sending test query to Claude Code...")
    asyncio.run(send_query(query))
