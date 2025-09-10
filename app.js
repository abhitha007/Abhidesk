// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDVPnpv5SIIT9gmYdiuDDFGbIt37PWx4vc",
    authDomain: "abhidesk-d26d0.firebaseapp.com",
    projectId: "abhidesk-d26d0",
    storageBucket: "abhidesk-d26d0.appspot.com",
    messagingSenderId: "924205685340",
    appId: "1:924205685340:web:b33b4dfa2be1da2696a499",
    measurementId: "G-ML9D0LTM0D"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// UI Elements
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const userIdDisplay = document.getElementById('userIdDisplay');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');
const sessionIdInput = document.getElementById('sessionIdInput');
const joinButton = document.getElementById('joinButton');
const leaveButton = document.getElementById('leaveButton');
const colorPicker = document.getElementById('colorPicker');
const brushSizeSlider = document.getElementById('brushSize');
const eraserButton = document.getElementById('eraserButton');
const clearButton = document.getElementById('clearButton');

// Global state
const userId = Math.random().toString(36).substring(2, 8);
userIdDisplay.innerText = userId;
let currentSessionId = null;
let drawing = false;
let lastPosition = { x: 0, y: 0 };
let unsubscribe = null;
let allStrokes = []; // This will hold the local cache of all strokes

// Drawing context settings
ctx.lineWidth = brushSizeSlider.value;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.strokeStyle = colorPicker.value;

// Resize canvas to fit container
function resizeCanvas() {
    const container = document.getElementById('canvasContainer');
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    if (currentSessionId) {
        renderStrokesFromCache();
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Helper to get mouse/touch position
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches ? e.touches[0].clientX : null);
    const clientY = e.clientY || (e.touches ? e.touches[0].clientY : null);
    if (clientX === null || clientY === null) return null;
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

// Drawing logic
canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    lastPosition = getPos(e);
});
canvas.addEventListener('touchstart', (e) => {
    drawing = true;
    lastPosition = getPos(e);
});

canvas.addEventListener('mousemove', (e) => {
    if (!drawing || !currentSessionId) return;
    const newPosition = getPos(e);
    if (!newPosition) return;
    
    // Create the stroke data
    const stroke = {
        startX: lastPosition.x,
        startY: lastPosition.y,
        endX: newPosition.x,
        endY: newPosition.y,
        color: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Add stroke to Firestore
    db.collection("sessions").doc(currentSessionId).collection("strokes").add(stroke);
    
    // Update lastPosition for the next point
    lastPosition = newPosition;
});

canvas.addEventListener('touchmove', (e) => {
    if (!drawing || !currentSessionId) return;
    e.preventDefault();
    const newPosition = getPos(e);
    if (!newPosition) return;

    const stroke = {
        startX: lastPosition.x,
        startY: lastPosition.y,
        endX: newPosition.x,
        endY: newPosition.y,
        color: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Add stroke to Firestore
    db.collection("sessions").doc(currentSessionId).collection("strokes").add(stroke);
    
    // Update lastPosition for the next point
    lastPosition = newPosition;
}, { passive: false });

window.addEventListener('mouseup', () => { drawing = false; });
window.addEventListener('touchend', () => { drawing = false; });

// Render all strokes from the local cache
function renderStrokesFromCache() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    allStrokes.forEach(stroke => {
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.lineWidth;
        ctx.moveTo(stroke.startX, stroke.startY);
        ctx.lineTo(stroke.endX, stroke.endY);
        ctx.stroke();
    });
}

// Firebase Session Management
async function joinSession(sessionId) {
    if (unsubscribe) unsubscribe();
    currentSessionId = sessionId;
    allStrokes = []; // Clear the local cache for the new session
    renderStrokesFromCache(); // Clear the canvas

    const sessionRef = db.collection("sessions").doc(sessionId);
    const doc = await sessionRef.get();
    if (!doc.exists) {
        await sessionRef.set({ created: firebase.firestore.FieldValue.serverTimestamp() });
    }

    // Set up a real-time listener for all changes
    unsubscribe = sessionRef.collection("strokes")
        .orderBy("timestamp")
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                const strokeData = change.doc.data();
                if (change.type === "added") {
                    allStrokes.push(strokeData);
                } else if (change.type === "removed") {
                    allStrokes = allStrokes.filter(stroke => stroke.timestamp.isEqual(strokeData.timestamp) === false);
                }
            });
            renderStrokesFromCache();
        }, error => {
            console.error("Error listening for strokes:", error);
            alert("Error joining session. Please check your network and try again.");
            leaveSession();
        });

    currentRoomDisplay.innerText = sessionId;
    sessionIdInput.disabled = true;
    joinButton.style.display = 'none';
    leaveButton.style.display = 'block';
}

function leaveSession() {
    if (unsubscribe) unsubscribe();
    currentSessionId = null;
    allStrokes = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentRoomDisplay.innerText = 'Not joined';
    sessionIdInput.disabled = false;
    sessionIdInput.value = '';
    joinButton.style.display = 'block';
    leaveButton.style.display = 'none';
}

// Event Listeners for UI
joinButton.addEventListener('click', () => {
    const sessionId = sessionIdInput.value.trim();
    if (sessionId) {
        joinSession(sessionId);
    } else {
        alert("Please enter a room ID.");
    }
});

leaveButton.addEventListener('click', leaveSession);

colorPicker.addEventListener('change', (e) => {
    ctx.strokeStyle = e.target.value;
});

brushSizeSlider.addEventListener('input', (e) => {
    ctx.lineWidth = e.target.value;
});

eraserButton.addEventListener('click', () => {
    ctx.strokeStyle = '#FFFFFF'; // Eraser color
    ctx.lineWidth = 20; // Eraser size
});

clearButton.addEventListener('click', async () => {
    if (!currentSessionId) {
        alert("Please join a room first.");
        return;
    }
    if (!confirm('Are you sure you want to clear the entire canvas for everyone?')) return;

    const strokesRef = db.collection("sessions").doc(currentSessionId).collection("strokes");
    const snapshot = await strokesRef.get();
    
    // Use a batch to perform multiple deletions atomically
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });
    await batch.commit();
});