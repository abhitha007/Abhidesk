// Local helper so the browser app can move the real mouse/keyboard. Run it on the computer being controlled.
// Setup: cd agent && npm init -y && npm i ws @nut-tree-fork/nut-js && node agent.js
const { WebSocketServer } = require('ws');
const { mouse, keyboard, Key, Button, screen, Point } = require('@nut-tree-fork/nut-js');
mouse.config.mouseSpeed = 5000; keyboard.config.autoDelayMs = 0;
const wss = new WebSocketServer({ host: '127.0.0.1', port: 8765 });
const ALLOWED = ['http://localhost', 'https://localhost', 'http://127.0.0.1']; // add your hosted https domain here
const SPECIAL = { Enter: Key.Enter, Backspace: Key.Backspace, Tab: Key.Tab, Escape: Key.Escape, Delete: Key.Delete,
  ArrowLeft: Key.Left, ArrowRight: Key.Right, ArrowUp: Key.Up, ArrowDown: Key.Down, Home: Key.Home, End: Key.End };
const BTN = [Button.LEFT, Button.MIDDLE, Button.RIGHT];
wss.on('connection', (ws, req) => {
  if (!ALLOWED.some(a => (req.headers.origin || '').startsWith(a))) return ws.close();
  console.log('Browser connected');
  ws.on('message', async raw => {
    const m = JSON.parse(raw);
    try {
      if (m.t === 'mm' || m.t === 'md') {
        const w = await screen.width(), h = await screen.height();
        await mouse.setPosition(new Point(Math.round(m.x * w), Math.round(m.y * h)));
        if (m.t === 'md') await mouse.pressButton(BTN[m.b] ?? Button.LEFT);
      } else if (m.t === 'mu') await mouse.releaseButton(BTN[m.b] ?? Button.LEFT);
      else if (m.t === 'wh') m.dy > 0 ? await mouse.scrollDown(m.dy) : await mouse.scrollUp(-m.dy);
      else if (m.t === 'kd') { if (SPECIAL[m.key]) await keyboard.type(SPECIAL[m.key]); else if (m.key.length === 1) await keyboard.type(m.key); }
    } catch (e) { console.error(e.message); }
  });
});
console.log('AbhiDesk agent listening on ws://127.0.0.1:8765');
