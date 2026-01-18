import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8765');

ws.on('open', () => {
  console.log('✓ Connected to bridge server');
  console.log('');
  console.log('Sending test response in 2 seconds...');
  console.log('Watch your backend logs for:');
  console.log('  - [bridge] Claude response received');
  console.log('  - [TTS] Speaking Claude response');
  console.log('  - [TTS] Finished speaking');
  console.log('');

  setTimeout(() => {
    const testResponse = {
      type: 'response',
      content: {
        text: 'Testing one two three. Can you hear me now?',
        options: []
      }
    };

    console.log('📤 Sending:', testResponse);
    ws.send(JSON.stringify(testResponse));
    console.log('');
    console.log('✓ Sent! Check your backend terminal for TTS logs.');
    console.log('');
    console.log('If you see "[TTS] Speaking..." but no audio:');
    console.log('  1. Check browser console for "Track subscribed" message');
    console.log('  2. Verify web client is connected to room: demo-chat1');
    console.log('  3. Check backend .env has PUBLISH_TTS_AUDIO_TRACK=true');
    console.log('');

    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 3000);
  }, 2000);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
  console.log('');
  console.log('Make sure backend is running: npm run dev');
  process.exit(1);
});
