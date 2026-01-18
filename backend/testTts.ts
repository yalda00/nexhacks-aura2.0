import WebSocket from 'ws';

// Connect to the bridge WebSocket server
const ws = new WebSocket('ws://localhost:8765');

ws.on('open', () => {
  console.log('Connected to bridge server');

  // Send a test Claude response
  const testResponse = {
    type: 'response',
    content: {
      text: 'Hello! This is a test of the text to speech system. If you can hear this, the TTS pipeline is working correctly.',
      options: []
    }
  };

  console.log('Sending test response:', testResponse);
  ws.send(JSON.stringify(testResponse));

  console.log('Test response sent! You should hear audio through LiveKit.');

  // Close after a delay
  setTimeout(() => {
    console.log('Test complete. Closing connection.');
    ws.close();
    process.exit(0);
  }, 2000);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
  process.exit(1);
});

ws.on('close', () => {
  console.log('Disconnected from bridge server');
});
