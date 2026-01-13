// Terminal - Retro Terminal for Rabbit R1
// Supports text, voice (PTT), and camera input

// State management
const state = {
    isRecording: false,
    isCameraOpen: false,
    mediaRecorder: null,
    audioChunks: [],
    cameraStream: null,
    capturedImage: null,
    isProcessing: false
};

// DOM Elements
let terminalOutput, textInput, sendBtn, cameraBtn, voiceIndicator;
let cameraOverlay, cameraPreview, captureBtn, closeCameraBtn, captureCanvas;
let clockEl, batteryEl;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    initializeClock();
    initializeHardwareListeners();
    initializeEventListeners();
    
    // Log environment
    if (typeof PluginMessageHandler !== 'undefined') {
        addSystemMessage('Connected to R1 system');
    } else {
        addSystemMessage('Running in browser mode');
    }
    
    // Show PTT hint after a moment
    setTimeout(() => {
        addSystemMessage('Hold PTT button to speak, tap 📷 for vision');
    }, 1000);
});

// Initialize DOM element references
function initializeElements() {
    terminalOutput = document.getElementById('terminal-output');
    textInput = document.getElementById('text-input');
    sendBtn = document.getElementById('send-btn');
    cameraBtn = document.getElementById('camera-btn');
    voiceIndicator = document.getElementById('voice-indicator');
    cameraOverlay = document.getElementById('camera-overlay');
    cameraPreview = document.getElementById('camera-preview');
    captureBtn = document.getElementById('capture-btn');
    closeCameraBtn = document.getElementById('close-camera-btn');
    captureCanvas = document.getElementById('capture-canvas');
    clockEl = document.getElementById('clock');
    batteryEl = document.getElementById('battery');
}

// Clock update
function initializeClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    const displayHours = hours % 12 || 12;
    clockEl.textContent = `${displayHours}:${minutes}${ampm}`;
    
    // Try to get battery status
    if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
            const level = Math.round(battery.level * 100);
            batteryEl.textContent = `batt ${level}%`;
        });
    }
}

// Hardware event listeners (R1 specific)
function initializeHardwareListeners() {
    // PTT Long press for voice recording
    window.addEventListener('longPressStart', () => {
        startVoiceRecording();
    });
    
    window.addEventListener('longPressEnd', () => {
        stopVoiceRecording();
    });
    
    // Side click - could be used for quick actions
    window.addEventListener('sideClick', () => {
        // Single click could toggle something or send current input
        if (textInput.value.trim()) {
            sendMessage();
        }
    });
    
    // Scroll wheel for terminal scrolling
    window.addEventListener('scrollUp', () => {
        terminalOutput.scrollTop -= 40;
    });
    
    window.addEventListener('scrollDown', () => {
        terminalOutput.scrollTop += 40;
    });
}

// Event listeners for UI
function initializeEventListeners() {
    // Send button
    sendBtn.addEventListener('click', sendMessage);
    
    // Text input enter key
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Camera button
    cameraBtn.addEventListener('click', openCamera);
    
    // Camera capture
    captureBtn.addEventListener('click', captureImage);
    
    // Close camera
    closeCameraBtn.addEventListener('click', closeCamera);
}

// Send text message to AI
function sendMessage() {
    const text = textInput.value.trim();
    
    if (!text && !state.capturedImage) {
        return;
    }
    
    if (state.isProcessing) {
        addSystemMessage('Please wait...');
        return;
    }
    
    // Display user input
    if (state.capturedImage) {
        addUserMessageWithImage(text || '[Image sent]', state.capturedImage);
    } else {
        addUserMessage(text);
    }
    
    // Clear input
    textInput.value = '';
    
    // Send to AI
    sendToAI(text, state.capturedImage);
    
    // Clear captured image
    state.capturedImage = null;
}

// Send message to R1 AI
function sendToAI(text, imageBase64 = null) {
    state.isProcessing = true;
    showTypingIndicator();
    
    if (typeof PluginMessageHandler !== 'undefined') {
        const payload = {
            message: text || 'Describe what you see in this image',
            useLLM: true,
            wantsR1Response: false
        };
        
        // If we have an image, include it in the message
        if (imageBase64) {
            payload.message = text 
                ? `[Image attached] ${text}` 
                : 'Please describe what you see in this image';
            payload.imageData = imageBase64;
        }
        
        PluginMessageHandler.postMessage(JSON.stringify(payload));
    } else {
        // Browser simulation
        setTimeout(() => {
            const simulatedResponse = imageBase64 
                ? 'I can see you\'ve sent an image. In the actual R1 device, I would analyze and describe what I see.'
                : `Processing: "${text}". This is a simulated response in browser mode.`;
            handleAIResponse({ message: simulatedResponse });
        }, 1500);
    }
}

// Handle AI response
window.onPluginMessage = function(data) {
    console.log('Received AI response:', data);
    handleAIResponse(data);
};

function handleAIResponse(data) {
    state.isProcessing = false;
    removeTypingIndicator();
    
    let responseText = '';
    let responseImage = null;
    
    // Parse response
    if (data.data) {
        try {
            const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
            
            // Check for image in response
            if (parsed.image || parsed.imageUrl || parsed.image_url) {
                responseImage = parsed.image || parsed.imageUrl || parsed.image_url;
            }
            
            // Get text content
            if (parsed.text || parsed.message || parsed.response) {
                responseText = parsed.text || parsed.message || parsed.response;
            } else if (typeof parsed === 'string') {
                responseText = parsed;
            } else {
                responseText = JSON.stringify(parsed);
            }
        } catch (e) {
            responseText = data.data;
        }
    }
    
    if (data.message && !responseText) {
        responseText = data.message;
    }
    
    // Display response
    if (responseImage) {
        addAIResponseWithImage(responseText, responseImage);
    } else if (responseText) {
        addAIResponse(responseText);
    } else {
        addSystemMessage('Received empty response');
    }
    
    scrollToBottom();
}

// Voice recording functions
async function startVoiceRecording() {
    if (state.isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.mediaRecorder = new MediaRecorder(stream);
        state.audioChunks = [];
        
        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                state.audioChunks.push(event.data);
            }
        };
        
        state.mediaRecorder.onstop = () => {
            processVoiceRecording();
            stream.getTracks().forEach(track => track.stop());
        };
        
        state.mediaRecorder.start();
        state.isRecording = true;
        voiceIndicator.classList.remove('hidden');
        
        addSystemMessage('Recording started...');
    } catch (err) {
        console.error('Microphone access error:', err);
        addSystemMessage('Microphone access denied');
    }
}

function stopVoiceRecording() {
    if (!state.isRecording || !state.mediaRecorder) return;
    
    state.mediaRecorder.stop();
    state.isRecording = false;
    voiceIndicator.classList.add('hidden');
}

async function processVoiceRecording() {
    if (state.audioChunks.length === 0) {
        addSystemMessage('No audio recorded');
        return;
    }
    
    const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
    
    // Convert to base64 for sending
    const reader = new FileReader();
    reader.onloadend = () => {
        const base64Audio = reader.result.split(',')[1];
        
        addUserMessage('[Voice message]');
        
        // Send voice to AI
        if (typeof PluginMessageHandler !== 'undefined') {
            state.isProcessing = true;
            showTypingIndicator();
            
            PluginMessageHandler.postMessage(JSON.stringify({
                message: 'Process this voice message',
                useLLM: true,
                audioData: base64Audio,
                wantsR1Response: true
            }));
        } else {
            addSystemMessage('Voice processing not available in browser mode');
        }
    };
    reader.readAsDataURL(audioBlob);
}

// Camera functions
async function openCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 282 },
                height: { ideal: 200 }
            } 
        });
        
        state.cameraStream = stream;
        cameraPreview.srcObject = stream;
        cameraOverlay.classList.remove('hidden');
        state.isCameraOpen = true;
        
    } catch (err) {
        console.error('Camera access error:', err);
        addSystemMessage('Camera access denied');
    }
}

function captureImage() {
    if (!state.cameraStream) return;
    
    const video = cameraPreview;
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    // Convert to base64
    state.capturedImage = captureCanvas.toDataURL('image/jpeg', 0.8);
    
    // Show preview indicator
    addSystemMessage('Image captured! Type a question or send directly.');
    
    closeCamera();
    
    // Focus on text input for optional question
    textInput.placeholder = 'ask about the image...';
    textInput.focus();
}

function closeCamera() {
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.cameraStream = null;
    }
    
    cameraOverlay.classList.add('hidden');
    state.isCameraOpen = false;
}

// Terminal output functions
function addUserMessage(text) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.innerHTML = `<span class="prompt">&gt;</span> <span class="user-input">${escapeHtml(text)}</span>`;
    terminalOutput.appendChild(line);
    scrollToBottom();
}

function addUserMessageWithImage(text, imageBase64) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.innerHTML = `
        <span class="prompt">&gt;</span> <span class="user-input">${escapeHtml(text)}</span>
        <div class="image-container">
            <img src="${imageBase64}" class="response-image user-image-preview" alt="User image">
        </div>
    `;
    terminalOutput.appendChild(line);
    scrollToBottom();
}

function addAIResponse(text) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.innerHTML = `<div class="ai-response">${escapeHtml(text)}</div>`;
    terminalOutput.appendChild(line);
    scrollToBottom();
}

function addAIResponseWithImage(text, imageUrl) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    
    // Handle both base64 and URL images
    const imgSrc = imageUrl.startsWith('data:') ? imageUrl : imageUrl;
    
    line.innerHTML = `
        <div class="ai-response">
            ${text ? escapeHtml(text) : ''}
            <div class="image-container">
                <img src="${imgSrc}" class="response-image" alt="AI generated image" onerror="this.style.display='none'">
            </div>
        </div>
    `;
    terminalOutput.appendChild(line);
    scrollToBottom();
}

function addSystemMessage(text) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.innerHTML = `<span class="system-msg">[sys] ${escapeHtml(text)}</span>`;
    terminalOutput.appendChild(line);
    scrollToBottom();
}

function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'terminal-line typing-line';
    indicator.innerHTML = `
        <div class="ai-response">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    terminalOutput.appendChild(indicator);
    scrollToBottom();
}

function removeTypingIndicator() {
    const typingLine = terminalOutput.querySelector('.typing-line');
    if (typingLine) {
        typingLine.remove();
    }
}

function scrollToBottom() {
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Utility: escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Clear terminal
function clearTerminal() {
    terminalOutput.innerHTML = '';
    addSystemMessage('Terminal cleared');
}

// Export for debugging
window.terminalApp = {
    state,
    clearTerminal,
    sendToAI
};
