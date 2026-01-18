import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8765');

ws.on('open', () => {
  console.log('✓ Connected to bridge server');

  // Simulate sending a query to codingterminal
  const query = {
    type: 'query',
    query: 'what is 2 + 2',
    content: 'what is 2 + 2'
  };

  console.log('📤 Sending test query to codingterminal:', query.query);
  ws.send(JSON.stringify(query));

  console.log('✓ Query sent! Check codingterminal to see if it appears.');

  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 2000);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
  process.exit(1);
});
