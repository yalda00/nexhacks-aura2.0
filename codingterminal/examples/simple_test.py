import asyncio
import websockets
import json

async def test_receive():
    async with websockets.connect("ws://localhost:8765") as ws:
        print("✓ Connected, waiting for messages...")
        try:
            async for message in websocket:
                data = json.loads(message)
                print(f"\n📨 Received: {data['content']['text'][:80]}")
                if data['content'].get('options'):
                    print(f"   Options: {data['content']['options']}")
        except asyncio.TimeoutError:
            print("No more messages")

asyncio.run(test_receive())
