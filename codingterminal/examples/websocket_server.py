#!/usr/bin/env python3
"""
Simple WebSocket server that receives Claude responses and can send queries back.
This is an example server for testing the bidirectional communication.
"""

import asyncio
import websockets
import json

# Connected clients
clients = set()

async def handler(websocket, path):
    """Handle WebSocket connections"""
    clients.add(websocket)
    client_id = id(websocket)
    print(f"✓ Client connected ({client_id})")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)

                # Handle responses from Claude parser
                if data.get("type") == "response":
                    content = data.get("content", {})
                    text = content.get("text", "")[:100]
                    options = content.get("options", [])

                    print(f"\n📥 Received from Claude:")
                    print(f"   Text: {text}{'...' if len(content.get('text', '')) > 100 else ''}")
                    if options:
                        print(f"   Options: {len(options)}")
                        for i, opt in enumerate(options, 1):
                            print(f"      {i}. {opt[:50]}")

            except json.JSONDecodeError:
                print(f"⚠ Received non-JSON: {message[:50]}")
            except Exception as e:
                print(f"❌ Error handling message: {e}")

    except websockets.exceptions.ConnectionClosed:
        print(f"✗ Client disconnected ({client_id})")
    finally:
        clients.remove(websocket)

async def send_query_example():
    """Example: Send a query to Claude after 5 seconds"""
    await asyncio.sleep(5)

    if clients:
        query = "What files are in this directory?"
        print(f"\n📤 Sending example query to Claude: {query}")

        message = json.dumps({
            "type": "query",
            "query": query
        })

        # Send to all connected clients (parser)
        await asyncio.gather(
            *[client.send(message) for client in clients],
            return_exceptions=True
        )

async def interactive_input():
    """Handle interactive input for sending queries"""
    loop = asyncio.get_event_loop()

    while True:
        try:
            query = await loop.run_in_executor(None, input, "\nSend query > ")

            if query.strip():
                if clients:
                    message = json.dumps({
                        "type": "query",
                        "query": query
                    })

                    print(f"📤 Sending to Claude: {query[:60]}...")
                    await asyncio.gather(
                        *[client.send(message) for client in clients],
                        return_exceptions=True
                    )
                else:
                    print("⚠ No clients connected yet")

        except (EOFError, KeyboardInterrupt):
            break
        except Exception as e:
            print(f"Error: {e}")

async def main():
    print("WebSocket server starting on ws://localhost:8765")
    print("Waiting for parser to connect...")
    print("\nMode: Listening for connections")
    print("  - Receives Claude responses automatically")
    print("  - Type queries and press Enter to send them to Claude")
    print("  - Use test_query.py to send queries programmatically")
    print("  - Press Ctrl+C to stop\n")

    # Start the WebSocket server
    async with websockets.serve(handler, "localhost", 8765):
        # Run interactive input (this will block and handle queries)
        try:
            await interactive_input()
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nServer stopped.")
