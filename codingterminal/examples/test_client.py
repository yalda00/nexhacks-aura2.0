#!/usr/bin/env python3
import asyncio
import websockets
import json

async def listen():
    uri = "ws://localhost:8765"
    print(f"Connecting to {uri}...")

    async with websockets.connect(uri) as websocket:
        print("✓ Connected! Waiting for messages...")
        print("(Press Ctrl+C to stop)\n")

        async for message in websocket:
            try:
                data = json.loads(message)
                print(f"\n📨 Received message:")
                print(f"   Type: {data.get('type')}")
                if 'content' in data:
                    content = data['content']
                    if isinstance(content, dict):
                        print(f"   Text: {content.get('text', '')[:100]}...")
                        if content.get('options'):
                            print(f"   Options: {content.get('options')}")
                    else:
                        print(f"   Content: {content}")
                print()
            except json.JSONDecodeError:
                print(f"Received: {message}")

if __name__ == "__main__":
    try:
        asyncio.run(listen())
    except KeyboardInterrupt:
        print("\n\nDisconnected.")
