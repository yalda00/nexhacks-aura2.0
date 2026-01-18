import WebSocket from 'ws';

// Connect to the bridge WebSocket server
const ws = new WebSocket('ws://localhost:8765');

ws.on('open', () => {
  console.log('✓ Connected to bridge server');
  console.log('');
  console.log('This simulates backend sending a transcript with "aura"');
  console.log('Check your web browser to see if it displays and highlights correctly.');
  console.log('');

  // Simulate transcript with wake phrase
  const transcript = {
    type: 'transcript',
    content: 'Hey Aura, what is the weather today?'
  };

  console.log('📤 Sending transcript:', transcript.content);
  ws.send(JSON.stringify(transcript));

  setTimeout(() => {
    const transcript2 = {
      type: 'transcript',
      content: 'Bye Aura, thank you!'
    };
    console.log('📤 Sending transcript:', transcript2.content);
    ws.send(JSON.stringify(transcript2));

    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 1000);
  }, 1000);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
  console.log('');
  console.log('Make sure backend is running: npm run dev');
  process.exit(1);
});
