# AbhiDesk
1. Run from this folder: `npx serve .`  (getDisplayMedia needs localhost or https; file:// will not work)
2. Open on two devices, enter each other's ID, accept the request.
3. For real mouse/keyboard control, on the *shared* computer run the agent (see agent/agent.js header).
4. Before going live: set Firestore rules (see chat) and add a TURN server in js/config.js.
