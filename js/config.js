// Paste your own Firebase web config here (Firebase console > Project settings).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDVPnpv5SIIT9gmYdiuDDFGbIt37PWx4vc",
  authDomain: "abhidesk-d26d0.firebaseapp.com",
  projectId: "abhidesk-d26d0",
  storageBucket: "abhidesk-d26d0.appspot.com",
  messagingSenderId: "924205685340",
  appId: "1:924205685340:web:b33b4dfa2be1da2696a499"
};
// Add a TURN server so it works behind strict NATs / mobile networks.
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  // { urls: "turn:YOUR_TURN_HOST:3478", username: "user", credential: "pass" }
];
const AGENT_URL = "ws://127.0.0.1:8765";
