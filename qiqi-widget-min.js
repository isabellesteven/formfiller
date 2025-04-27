// qiqi-widget.js
(function () {
    'use strict';

    class QiqiWidget {
        constructor(config) {
            // Configuration defaults
            this.formId = config.formId; // Store FormId as instance property
            this.config = Object.assign({
                formId: null,
                role: 'standalone',
                sessionId: null,
                websocketUrl: "wss://ksamuwry9l.execute-api.us-east-1.amazonaws.com/production/",
                apiGatewayUploadUrl: "https://3c8t1k5p92.execute-api.us-east-1.amazonaws.com/stage/upload",
                tokenEndpoint: "https://q19mkers91.execute-api.us-east-1.amazonaws.com/dev/widget/token"
            }, config);

            this.widgetConfig = {
                hideRoleSelector: true,       // ⬅️ Toggle to `false` to show
                hideInstructions: true,        // ⬅️ Toggle to `false` to show
                hideBelowMicSection: true
            };

            this.injectStyles();

            // Audio processing constants
            this.MAX_BUFFER_SIZE = 10;
            this.DROP_PERCENT_THRESHOLD = 0.5;
            this.SILENCE_THRESHOLD = 12.0;
            this.SILENCE_TIMEOUT = 1500;

            // State variables
            this.energyBuffer = [];
            this.audioChunks = [];
            this.selectedDeviceId = null;
            this.sessionId = this.config.sessionId || this.generateSessionId();
            this.isRecording = false;
            this.hasStoppedRecording = false;
            this.uploadComplete = false;
            this.websocketReady = false;
            this.audioContext = null;
            this.analyser = null;
            this.source = null;
            this.silenceTimeout = null;
            this.scriptProcessor = null;
            this.mediaRecorder = null;
            this.ws = null;

            // Initialize the widget
            this.init();
        }

        init() {
            this.createDOM();
            this.setupEventListeners();
            this.getMicrophones();
            this.handleRoleChange({ skipWebSocket: true });
            this.applyVisibilitySettings();
        }

        applyVisibilitySettings() {
            if (this.widgetConfig.hideRoleSelector) {
                const roleSection = this.container.querySelector("#qiqiRoleSection");
                if (roleSection) roleSection.style.display = "none";
            }

            if (this.widgetConfig.hideInstructions) {
                const instructions = this.container.querySelector("#qiqiNonReceiverSection");
                if (instructions) instructions.style.display = "none";
            }

            if (this.widgetConfig.hideBelowMicSection) {
                const instructions = this.container.querySelector("#qiqibelowMicSection");
                if (instructions) instructions.style.display = "none";
            }
        }

        showSpinner() {
            const spinner = this.container.querySelector("#qiqiSpinner");
            if (spinner) spinner.style.display = "inline-block";
        }

        hideSpinner() {
            const spinner = this.container.querySelector("#qiqiSpinner");
            if (spinner) spinner.style.display = "none";
        }

        createDOM() {
            this.container = document.createElement('div');
            this.container.className = 'qiqi-widget-container';
            this.container.innerHTML = `
                <style>
                    .qiqi-widget-container {
                        font-family: Arial, sans-serif;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                        border: 1px solid #ddd;
                        border-radius: 8px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    .qiqi-widget-container h1 {
                        font-size: 1.5em;
                        margin-top: 0;
                        color: #333;
                    }
                    .qiqi-widget-container label {
                        display: block;
                        margin: 10px 0 5px;
                        font-weight: bold;
                    }
                    .qiqi-widget-container select, 
                    .qiqi-widget-container input[type="text"] {
                        width: 100%;
                        padding: 8px;
                        margin-bottom: 10px;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                    }
                    .qiqi-widget-container button {
                        background-color: #4CAF50;
                        color: white;
                        padding: 10px 15px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 1em;
                        margin: 10px 0;
                    }
                    .qiqi-widget-container button:hover {
                        background-color: #45a049;
                    }
                    .qiqi-widget-container button:disabled {
                        background-color: #cccccc;
                        cursor: not-allowed;
                    }
                    #qiqiStatus {
                        margin: 15px 0;
                        padding: 10px;
                        background-color: #f8f8f8;
                        border-radius: 4px;
                    }
                    #qiqiTranscriptionResult {
                        margin: 15px 0;
                    }
                    #qiqiDynamicForm label {
                        display: block;
                        margin-top: 15px;
                    }
                    #qiqiDynamicForm input, 
                    #qiqiDynamicForm textarea {
                        width: 100%;
                        padding: 8px;
                        margin-top: 5px;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                        box-sizing: border-box;
                    }
                    #qiqiDynamicForm textarea {
                        min-height: 60px;
                        resize: vertical;
                    }
                    .hidden {
                        display: none !important;
                    }
                    .session-display {
                        background-color: #f0f0f0;
                        padding: 10px;
                        border-radius: 4px;
                        margin: 10px 0;
                    }
                    .session-input-wrapper {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                        margin-top: 10px;
                    }
                    .session-input-wrapper input {
                        flex-grow: 1;
                    }
                </style>
                 
                <div id="qiqiRoleSection">
                    <label for="qiqiRoleSelect">Choose Application Role:</label>
                    <select id="qiqiRoleSelect">
                        <option value="standalone">Stand Alone</option>
                        <option value="recorder">Recorder</option>
                        <option value="receiver">Receiver</option>
                    </select>
                </div>

                <div id="qiqiNonReceiverSection">

                </div>
                <div style="display: flex; align-items: flex-start; gap: 10px;">
                <img
                    id="qiqiRecordButton"
                    src="https://voxfields.net/widgets/mic-icon-red.png"
                    alt="Record"
                    style="cursor:pointer; width:30px; height:auto;"
                />

                    <div style="display: flex; flex-direction: column; align-items: flex-start;">
                        <label for="qiqiMicrophoneSelect" style="font-size: 0.85em;">Select Microphone:</label>
                        <select id="qiqiMicrophoneSelect"></select>
                        <span style="font-size: 0.75em; font-style: italic; color: #666;">
                            Powered by <a href="https://voxfields.com" target="_blank" style="color: #666; text-decoration: underline;">Voxfields</a>
                        </span>
                    </div>
                </div>

             
                <div id="qiqiSpinner" style="display:none; margin-left:10px;">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        style="margin:auto; background:none; display:block;"
                        width="24px"
                        height="24px"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="xMidYMid"
                    >
                        <circle
                        cx="50"
                        cy="50"
                        fill="none"
                        stroke="#e60023"
                        stroke-width="10"
                        r="35"
                        stroke-dasharray="164.93361431346415 56.97787143782138"
                        >
                        <animateTransform
                            attributeName="transform"
                            type="rotate"
                            repeatCount="indefinite"
                            dur="1s"
                            values="0 50 50;360 50 50"
                            keyTimes="0;1"
                        />
                        </circle>
                    </svg>
                    </div>

                <div id = "qiqibelowMicSection">
                    <p id="qiqiSessionDisplay" class="hidden session-display"></p>

                    <div id="qiqiSessionInputWrapper" class="hidden">
                        <label for="qiqiSessionInput">Enter Session ID:</label>
                        <div class="session-input-wrapper">
                            <input type="text" id="qiqiSessionInput" placeholder="e.g. A7HW34" />
                            <button id="qiqiSessionSubmitButton">Enter</button>
                        </div>
                    </div>

                    <p id="qiqiStatus">Press the button to start Recording...</p>

                    <div id="qiqiTranscriptionResult"></div>

                    <u>Transcription Status</u>

                    <form id="qiqiDynamicForm"></form>
                </div>


            `;


            // Append to document body or specified target
            const target = document.querySelector(`script[data-formid="${this.config.formId}"]`) || document.body;
            target.parentNode.insertBefore(this.container, target.nextSibling);
        }

        injectStyles() {
            const style = document.createElement("style");
            style.textContent = `
            .qiqi-widget-container {
            font-family: Arial, sans-serif;
            max-width: 100%;
            padding: 16px;
            margin: 0;
            text-align: left;
            box-sizing: border-box;
            }

            .qiqi-widget-container * {
            box-sizing: border-box;
            }

            .qiqi-widget-container label {
            font-weight: bold;
            margin-top: 1rem;
            display: block;
            font-size: 0.95em;
            }

            .qiqi-widget-container input,
            .qiqi-widget-container select,
            .qiqi-widget-container textarea {
            width: 100%;
            max-width: 100%;
            padding: 8px;
            margin-bottom: 12px;
            font-size: 1em;
            border: 1px solid #ccc;
            border-radius: 4px;
            }

            .qiqi-widget-container .mic-row {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            flex-wrap: wrap;
            }

            .qiqi-widget-container .mic-controls {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            }

            .qiqi-widget-container .powered-by {
            font-size: 0.75em;
            font-style: italic;
            color: #666;
            }

            #qiqiRecordButton {
            cursor: pointer;
            width: 30px;
            height: auto;
            transition: transform 0.2s, filter 0.2s;
            }

            #qiqiRecordButton:hover {
            filter: brightness(1.2);
            transform: scale(1.05);
            }

            #qiqiRecordButton.pulsing {
            animation: pulse 1s infinite;
            }

            @keyframes pulse {
            0% { transform: scale(1); filter: brightness(1); }
            50% { transform: scale(1.1); filter: brightness(1.4); }
            100% { transform: scale(1); filter: brightness(1); }
            }
        `;
            document.head.appendChild(style);
        }

        setupEventListeners() {

            const recordButton = this.container.querySelector('#qiqiRecordButton');

            recordButton.addEventListener('click', () => {
                if (this.isRecording) {
                    console.log("🛑 Manually stopping recording");
                    this.stopRecording();  // ✅ stop actual recording
                    recordButton.classList.remove('pulsing');
                    // this.isRecording is already set to false inside stopRecording
                } else {
                    console.log("🎙️ Starting monitoring");
                    recordButton.classList.add('pulsing');
                    this.startMonitoring();  // ✅ this sets isRecording = true internally
                }
            });

//            this.container.querySelector('#qiqiRecordButton').addEventListener('click', () => this.startMonitoring());

            this.container.querySelector('#qiqiRoleSelect').addEventListener('change', () => this.handleRoleChange());

            this.container.querySelector('#qiqiSessionSubmitButton').addEventListener('click', () => {
                const input = this.container.querySelector('#qiqiSessionInput').value.trim();
                if (!/^\d{6}$/.test(input)) {
                    alert("Please enter a valid 6-digit Session ID (e.g., 482193)");
                    return;
                }
                this.sessionId = input;
                console.log("Receiver session ID committed:", this.sessionId);
                this.container.querySelector('#qiqiStatus').innerText = "Connected. Waiting for data...";
                this.connectWebSocket();
            });

            // Set initial role if configured
            if (this.config.role) {
                this.container.querySelector('#qiqiRoleSelect').value = this.config.role;
                this.handleRoleChange({ skipWebSocket: true });
            }
        }

        async getMicrophones() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const devices = await navigator.mediaDevices.enumerateDevices();
                const microphoneSelect = this.container.querySelector('#qiqiMicrophoneSelect');
                microphoneSelect.innerHTML = '';

                devices.forEach(device => {
                    if (device.kind === 'audioinput') {
                        const option = document.createElement('option');
                        option.value = device.deviceId;
                        option.textContent = device.label || `Microphone ${microphoneSelect.length + 1}`;
                        microphoneSelect.appendChild(option);
                    }
                });

                microphoneSelect.addEventListener('change', () => {
                    this.selectedDeviceId = microphoneSelect.value;
                });

                if (microphoneSelect.options.length > 0) {
                    this.selectedDeviceId = microphoneSelect.options[0].value;
                }
            } catch (error) {
                console.error("Error fetching microphone devices:", error);
            }
        }

        generateSessionId() {
            return Math.floor(100000 + Math.random() * 900000); // 100000 to 999999
        }

        async startMonitoring() {

            if (this.isRecording) return;

            // 🟢 Fetch microphones *only now* if not already fetched
            //const micSelect = this.container.querySelector('#qiqiMicrophoneSelect');
            //if (!micSelect.options.length) {
            //    await this.getMicrophones();
            //}


            this.isRecording = true;
            this.hasStoppedRecording = false;
            this.uploadComplete = false;

            if (!this.sessionId) {
                this.sessionId = this.generateSessionId();
            }

            if (!this.selectedDeviceId) {
                console.error("No microphone selected. Please select a microphone first.");
                return;
            }

            const constraints = {
                audio: { deviceId: { exact: this.selectedDeviceId } }
            };

            this.connectWebSocket();

            try {
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");

                this.audioContext = isFirefox
                    ? new AudioContext()
                    : new AudioContext({ sampleRate: 16000 });

                this.source = this.audioContext.createMediaStreamSource(stream);
                this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 2, 1);
                this.source.connect(this.scriptProcessor);
                this.scriptProcessor.connect(this.audioContext.destination);

                this.analyser = this.audioContext.createAnalyser();
                this.source.connect(this.analyser);
                this.analyser.fftSize = 512;
                const dataArray = new Uint8Array(this.analyser.fftSize);

                let mediaRecorderOptions = { mimeType: "audio/webm" };

                if (!MediaRecorder.isTypeSupported(mediaRecorderOptions.mimeType)) {
                    mediaRecorderOptions.mimeType = "audio/mp4";
                    if (!MediaRecorder.isTypeSupported(mediaRecorderOptions.mimeType)) {
                        mediaRecorderOptions = {};
                    }
                }

                this.mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions);
                this.audioChunks = [];

                const checkSilence = () => {
                    this.analyser.getByteFrequencyData(dataArray);
                    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

                    this.energyBuffer.push(average);
                    if (this.energyBuffer.length > this.MAX_BUFFER_SIZE) this.energyBuffer.shift();

                    const maxEnergy = Math.max(...this.energyBuffer);
                    const currentEnergy = average;
                    const dropRatio = currentEnergy / maxEnergy;

                    const speechDetected = currentEnergy >= this.SILENCE_THRESHOLD;
                    const sharpDropDetected = dropRatio < this.DROP_PERCENT_THRESHOLD && maxEnergy > this.SILENCE_THRESHOLD;

                    if (speechDetected || sharpDropDetected) {
                        if (this.mediaRecorder.state === "inactive") {
                            this.startRecording();
                        }

                        if (this.silenceTimeout) {
                            clearTimeout(this.silenceTimeout);
                            this.silenceTimeout = null;
                        }
                    } else {
                        if (this.mediaRecorder.state === "recording" && !this.silenceTimeout) {
                            this.silenceTimeout = setTimeout(() => {
                                if (!this.hasStoppedRecording) {
                                    this.stopRecording();
                                }
                            }, this.SILENCE_TIMEOUT);
                        }
                    }

                    requestAnimationFrame(checkSilence);
                };

                checkSilence();
            } catch (error) {
                console.error("Error accessing the selected microphone:", error);
            }
        }

        startRecording() {
            this.mediaRecorder.start();
            this.container.querySelector('#qiqiStatus').innerText = "Recording... Speak now!";

            this.mediaRecorder.ondataavailable = event => {
                this.audioChunks.push(event.data);
            };
        }

        async stopRecording() {
            if (this.hasStoppedRecording) return;
            this.hasStoppedRecording = true;
            this.isRecording = false;  // ✅ Make sure this gets set to false here
            this.container.querySelector('#qiqiStatus').innerText = "Recording Stopped!";

            this.showSpinner();

            this.mediaRecorder.stop();

            this.mediaRecorder.onstop = async () => {
                let audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });

                if (this.audioContext) {
                    this.audioContext.close();
                    this.audioContext = null;
                }
                if (this.scriptProcessor) {
                    this.scriptProcessor.disconnect();
                }
                if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
                    this.mediaRecorder.stop();
                }
                if (this.source && this.source.mediaStream) {
                    this.source.mediaStream.getTracks().forEach(track => track.stop());
                }

                audioBlob = await this.processAudio(audioBlob);
                this.uploadAudioToApiGateway(audioBlob);
            };
        }

        async getAudioProperties(audioBlob) {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decodedData = await audioCtx.decodeAudioData(arrayBuffer);

            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            const isChromeIOS = /CriOS/.test(navigator.userAgent);
            const is32BitFloat = decodedData.getChannelData(0).constructor === Float32Array;
            const is44kHz32BitFloat = decodedData.sampleRate === 44100 && is32BitFloat;
            const is48kHz32BitFloat = decodedData.sampleRate === 48000 && is32BitFloat;

            return {
                sampleRate: decodedData.sampleRate,
                bitDepth: is32BitFloat ? 32 : 24,
                is16kHz24Bit: decodedData.sampleRate === 16000 && !is32BitFloat,
                needsFixing: isIOS && (is44kHz32BitFloat || is48kHz32BitFloat)
            };
        }

        async processAudio(audioBlob) {
            const { sampleRate, is16kHz24Bit, needsFixing } = await this.getAudioProperties(audioBlob);

            if (is16kHz24Bit) {
                return audioBlob;
            }

            if (!needsFixing) {
                return audioBlob;
            }

            const processedBuffer = await this.resampleAudio(audioBlob, 16000);
            return this.encodeWAV(processedBuffer, 16000);
        }

        convertFloat32ToPCM16(float32Array) {
            const int16Array = new Int16Array(float32Array.length);

            for (let i = 0; i < float32Array.length; i++) {
                let sample = float32Array[i];
                if (isNaN(sample)) sample = 0;
                int16Array[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
            }

            return int16Array;
        }

        async resampleAudio(audioBlob, targetSampleRate) {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            const offlineContext = new OfflineAudioContext(
                1,
                Math.floor(audioBuffer.duration * targetSampleRate),
                targetSampleRate
            );

            const bufferSource = offlineContext.createBufferSource();
            bufferSource.buffer = audioBuffer;
            bufferSource.connect(offlineContext.destination);
            bufferSource.start();

            const renderedBuffer = await offlineContext.startRendering();
            return this.convertFloat32ToPCM16(renderedBuffer.getChannelData(0));
        }

        encodeWAV(samples, sampleRate) {
            const numOfChannels = 1;
            const numSamples = samples.length;
            let buffer = new ArrayBuffer(44 + numSamples * 2);
            let view = new DataView(buffer);

            const writeString = (view, offset, string) => {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            };

            writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + numSamples * 2, true);
            writeString(view, 8, 'WAVE');
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, numOfChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numOfChannels * 2, true);
            view.setUint16(32, numOfChannels * 2, true);
            view.setUint16(34, 16, true);
            writeString(view, 36, 'data');
            view.setUint32(40, numSamples * 2, true);

            let offset = 44;
            for (let i = 0; i < numSamples; i++) {
                view.setInt16(offset, samples[i], true);
                offset += 2;
            }

            return new Blob([view], { type: 'audio/wav' });
        }

        async fetchTokenForForm(formId) {
            const response = await fetch(`${this.config.tokenEndpoint}?formId=${formId}`);
            console.log(${this.config.tokenEndpoint}?formId=${formId})
            if (!response.ok) {
                throw new Error("Unable to fetch token");
            }
            const data = await response.json();
            return data.token;
        }

        async uploadAudioToApiGateway(audioBlob) {

            const recordButton = this.container.querySelector('#qiqiRecordButton');
            recordButton.classList.remove('pressed');
            recordButton.classList.remove('pulsing');

            if (!this.formId) {
                console.error('No FormId configured');
                this.updateStatus("System error - missing form configuration");
            }
            const token = await this.fetchTokenForForm(this.formId);

            if (!token) {
                alert("Token is Empty!");
                return;
            }

            const filename = `${this.sessionId}.wav`;
            const metadataFilename = `${this.sessionId}.json`;

            const metadata = {
                app_template: " ",
                formId: this.formId,
                param3: "parameter3"
            };

            const queryParams = new URLSearchParams({
                sessionId: this.sessionId,
                wav_filename: filename,
                metadata_filename: metadataFilename,
                metadata_content: btoa(JSON.stringify(metadata))
            });

            try {
                console.log('About to print URL', this.config, queryParams);
                console.log(`${this.config.apiGatewayUploadUrl}?${queryParams.toString()}`);
                const response = await fetch(`${this.config.apiGatewayUploadUrl}?${queryParams.toString()}`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "audio/wav"
                    },
                    body: audioBlob
                });

                if (response.ok) {
                    //this.notifyWebSocket(filename);
                    console.log("File Uploaded!");
                } else {
                    const errorData = await response.json();
                    console.error("Upload failed:", errorData.error || "Unknown error");
                    alert(`Upload failed: ${errorData.error || "Unknown error"}`);
                }
            } catch (error) {
                console.error("Error uploading file:", error);
            }
        }

        connectWebSocket() {
            const role = this.container.querySelector('#qiqiRoleSelect').value;

            if (this.ws) {
                return;
            }

            if (role === "receiver") {
                const sessionInput = this.container.querySelector('#qiqiSessionInput').value.trim();
                if (!/^\d{6}$/.test(sessionInput)) {
                    return;
                }
                this.sessionId = sessionInput;
            }

            this.ws = new WebSocket(`${this.config.websocketUrl}?sessionId=${this.sessionId}&role=${role}`);

            this.ws.onopen = () => {
                this.websocketReady = true;
            };

            this.ws.onmessage = (event) => {
                this.handleWebSocketMessage(event.data);
            };

            this.ws.onerror = (err) => {
                console.error("WebSocket error:", err);
            };

            this.ws.onclose = () => {
                this.ws = null;
                this.websocketReady = false;
            };
        }

        notifyWebSocket(filename) {
            this.container.querySelector('#qiqiStatus').innerText = "Transcribing and Analyzing...";
            console.log("in notifyWebSocket");
            if (!this.websocketReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                setTimeout(() => this.notifyWebSocket(filename), 500);
                return;
            }

            const s3Uri = `s3://qiqi-audio-uploads/uploaded-audio/${filename}`;
            const payload = {
                action: "stream_audio",
                s3_uri: s3Uri,
                sessionId: this.sessionId
            };

            this.ws.send(JSON.stringify(payload));
        }

        handleWebSocketMessage(data) {
            if (!data || typeof data !== "string" || data.trim().length === 0) {
                return;
            }
            this.hideSpinner();
            try {
                const response = JSON.parse(data);
                console.log("Parsed WebSocket response:", response);

                if (response.error) {
                    this.container.querySelector('#qiqiStatus').innerText = "Error: " + response.error;
                } else {
                    this.isRecording = false;
                    this.container.querySelector('#qiqiRecordButton').disabled = false;
                    this.generateDynamicForm(response);
                    this.container.querySelector('#qiqiStatus').innerText = "Job Completing...";
                }
            } catch (err) {
                console.error("Error parsing WebSocket message:", err.message);
            }
        }

        generateDynamicForm(data) {
            const excludedKeys = ["sessionId", "app_template"];

            Object.entries(data).forEach(([key, value]) => {
                if (excludedKeys.includes(key)) return;

                const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, "_");

                // Try finding a direct input match by id
                let input = document.getElementById(key) || document.getElementById(normalizedKey);

                if (input) {
                    // Special case: is this a radio button?
                    if (input.type === "radio") {
                        // Handle as radio group by name
                        const radios = document.querySelectorAll(`input[type="radio"][name="${input.name}"]`);
                        let matched = false;
                        radios.forEach(radio => {
                            if (radio.value === value) {
                                radio.checked = true;
                                matched = true;
                                console.log(`🔘 Selected radio "${value}" for "${key}"`);
                            }
                        });
                        if (!matched) {
                            console.warn(`⚠️ No radio option matched value "${value}" for "${key}"`);
                        }
                    } else {
                        input.value = value || "";
                        console.log(`✅ Filled "${key}" into #${input.id}`);
                    }
                } else {
                    // Check if this is a radio group not found by id
                    const radios = document.querySelectorAll(`input[type="radio"][name="${key}"]`);
                    if (radios.length > 0) {
                        let matched = false;
                        radios.forEach(radio => {
                            if (radio.value === value) {
                                radio.checked = true;
                                matched = true;
                                console.log(`🔘 Selected radio "${value}" for "${key}"`);
                            }
                        });
                        if (!matched) {
                            console.warn(`⚠️ No radio option matched value "${value}" for "${key}"`);
                        }
                    } else {
                        console.warn(`🔍 Field not found in DOM for key: "${key}"`);
                    }
                }
            });
        }
        autoResize(textarea) {
            textarea.style.height = "auto";
            textarea.style.height = textarea.scrollHeight + "px";
        }

        handleRoleChange({ skipWebSocket = false } = {}) {
            const role = this.container.querySelector('#qiqiRoleSelect').value;
            const section = this.container.querySelector('#qiqiNonReceiverSection');
            const status = this.container.querySelector('#qiqiStatus');
            const sessionDisplay = this.container.querySelector('#qiqiSessionDisplay');
            const sessionInputWrapper = this.container.querySelector('#qiqiSessionInputWrapper');

            if (role === "receiver") {
                section.classList.add('hidden');
                sessionDisplay.classList.add('hidden');
                sessionInputWrapper.classList.remove('hidden');
                status.innerText = "Waiting for messages...";
            } else {
                sessionInputWrapper.classList.add('hidden');
                section.classList.remove('hidden');

                if (role === "recorder") {
                    sessionDisplay.innerText = `🔗 Share this Session ID with the Receiver: ${this.sessionId}`;
                    sessionDisplay.classList.remove('hidden');
                } else {
                    sessionDisplay.classList.add('hidden');
                }

                status.innerText = "Click Microphone to start Recording";

                if (!skipWebSocket) {
                    this.connectWebSocket();
                }
            }
        }
    }

    // Initialization function
    function initWidget() {
        // Find the script element by src or data attribute
        const scripts = document.querySelectorAll('script[src*="qiqi-widget-min.js"]');
        let scriptElement = scripts[scripts.length - 1]; // Get the last matching script

        // Fallback to currentScript if available
        if (!scriptElement && document.currentScript) {
            scriptElement = document.currentScript;
        }

        if (!scriptElement) {
            console.error('Qiqi Widget: Could not find script element');
            return;
        }

        const formId = scriptElement.getAttribute('data-formid');
        if (!formId) {
            console.error('Qiqi Widget: data-formid attribute is required');
            return;
        }

        new QiqiWidget({
            formId: formId
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        initWidget();
    }
})();
