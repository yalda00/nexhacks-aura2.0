from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import asyncio
import json

app = FastAPI()
connected = set()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected.add(websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            print("Received from client:", msg)
    except WebSocketDisconnect:
        pass
    finally:
        connected.remove(websocket)

async def broadcast_new_data(new_data):
    if connected:
        payload = json.dumps({"type": "response", "content": [new_data]})
        await asyncio.gather(*(ws.send_text(payload) for ws in connected))

async def simulate_data():
    counter = 1
    while True:
        new_data = {"id": counter, "message": f"Hello {counter}"}
        await broadcast_new_data(new_data)
        counter += 1
        await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(simulate_data())

if __name__ == "__main__":
    uvicorn.run("fastapi_ws:app", host="0.0.0.0", port=8000)
