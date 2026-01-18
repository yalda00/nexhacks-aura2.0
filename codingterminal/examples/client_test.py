import asyncio
import websockets

async def run_client():
    uri = "ws://localhost:8765/"
    try:
        async with websockets.connect(uri) as ws:
            print("Connected to server, waiting for one message...")
            msg = await ws.recv()
            print("Received:", msg)
    except Exception as e:
        print("Client error:", e)

if __name__ == "__main__":
    asyncio.run(run_client())
