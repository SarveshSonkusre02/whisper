document.addEventListener('DOMContentLoaded', function () {
    const uploadForm = document.getElementById('uploadForm');
    const audioFileInput = document.getElementById('audioFile');
    const uploadTranscribeBtn = document.getElementById('uploadTranscribeBtn');
    const progressContainer = document.getElementById('progressContainer');
    const resultsCard = document.getElementById('resultsCard');
    const transcriptionText = document.getElementById('transcriptionText');
    const copyBtn = document.getElementById('copyBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const errorAlert = document.getElementById('errorAlert');
    const errorMessage = document.getElementById('errorMessage');

    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const cancelButton = document.getElementById('cancelButton');
    const recordingStatus = document.getElementById('recordingStatus');
    const recordingTime = document.getElementById('recordingTime');
    const recordedAudio = document.getElementById('recordedAudio');
    const recordTranscribeBtn = document.getElementById('recordTranscribeBtn');
    const interimTranscription = document.getElementById('interimTranscription');

    let mediaRecorder;
    let audioChunks = [];
    let recordingStartTime;
    let recordingTimer;
    let audioBlob;
    let recognition;

    uploadForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!audioFileInput.files.length) {
            showError('Please select an audio file to transcribe.');
            return;
        }

        const file = audioFileInput.files[0];
        if (file.size > 25 * 1024 * 1024) {
            showError('File size exceeds the 25MB limit.');
            return;
        }

        const formData = new FormData();
        formData.append('audioFile', file);

        progressContainer.classList.remove('d-none');
        resultsCard.classList.add('d-none');
        errorAlert.classList.add('d-none');
        uploadTranscribeBtn.disabled = true;

        sendAudioForTranscription(formData, uploadTranscribeBtn);
    });

    recordButton.addEventListener('click', function () {
        resetRecordingState();

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                mediaRecorder = new MediaRecorder(stream);
                mediaRecorder.start();
                startRecording();

                mediaRecorder.addEventListener("dataavailable", event => {
                    audioChunks.push(event.data);
                });

                mediaRecorder.addEventListener("stop", () => {
                    audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    // recordedAudio.src = URL.createObjectURL(audioBlob);
                    // recordedAudio.classList.remove('d-none');
                    recordTranscribeBtn.classList.remove('d-none');
                    stream.getTracks().forEach(track => track.stop());
                });

                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (SpeechRecognition) {
                    recognition = new SpeechRecognition();
                    recognition.continuous = true;
                    recognition.interimResults = true;
                    recognition.lang = 'en-US';

                    recognition.onresult = event => {
                        let interimText = '';
                        for (let i = event.resultIndex; i < event.results.length; i++) {
                            const transcript = event.results[i][0].transcript;
                            if (!event.results[i].isFinal) {
                                interimText += transcript;
                            }
                        }
                        interimTranscription.innerHTML = `<em>${interimText}</em>`;
                    };

                    recognition.onerror = event => {
                        console.warn("Recognition error:", event.error);
                    };

                    recognition.start();
                }
            })
            .catch(error => {
                showError('Microphone access denied: ' + error.message);
            });
    });

    stopButton.addEventListener('click', function () {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            stopRecording();
            recordingStatus.textContent = "Recording complete";
        }
        if (recognition) {
            recognition.stop();
            recognition = null;
            interimTranscription.textContent = '';
        }
    });

    cancelButton.addEventListener('click', function () {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (recognition) {
            recognition.stop();
            recognition = null;
            interimTranscription.textContent = '';
        }
        audioChunks = [];
        resetRecordingState();
        recordingStatus.textContent = "Recording cancelled";
    });

    recordTranscribeBtn.addEventListener('click', function () {
        if (!audioBlob) {
            showError('No recorded audio to transcribe.');
            return;
        }

        const formData = new FormData();
        formData.append('audioFile', audioBlob, 'recording.wav');

        progressContainer.classList.remove('d-none');
        resultsCard.classList.add('d-none');
        errorAlert.classList.add('d-none');
        recordTranscribeBtn.disabled = true;

        sendAudioForTranscription(formData, recordTranscribeBtn);
    });

    function sendAudioForTranscription(formData, buttonToEnable) {
        const timeoutDuration = 5 * 60 * 1000;

        const progressMessage = document.createElement('div');
        progressMessage.className = 'text-center text-info mt-3';
        progressMessage.innerHTML = '<small>First-time model loading may take a bit. Please wait...</small>';
        progressContainer.appendChild(progressMessage);

        const downloadProgress = document.createElement('div');
        downloadProgress.className = 'text-center text-primary mt-2 fw-bold';
        downloadProgress.innerHTML = '<small>The tiny model loads in under 30 seconds typically.</small>';
        progressContainer.appendChild(downloadProgress);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

        fetch('/transcribe', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        })
            .then(response => {
                clearTimeout(timeoutId);
                if (!response.ok) {
                    return response.json().then(data => {
                        throw new Error(data.error || 'Transcription failed.');
                    });
                }
                return response.json();
            })
            .then(data => {
                transcriptionText.textContent = data.transcription;
                resultsCard.classList.remove('d-none');
                scrollToResults();
            })
            .catch(error => {
                if (error.name === 'AbortError') {
                    showError('The transcription timed out. Try again.');
                } else {
                    showError(error.message);
                }
            })
            .finally(() => {
                progressContainer.classList.add('d-none');
                buttonToEnable.disabled = false;
                progressContainer.removeChild(progressMessage);
                progressContainer.removeChild(downloadProgress);
            });
    }

    function startRecording() {
        recordButton.classList.add('recording');
        recordButton.disabled = true;
        stopButton.classList.remove('d-none');
        cancelButton.classList.remove('d-none');
        recordingStatus.textContent = "Recording...";
        recordingTime.classList.remove('d-none');
        recordingStartTime = Date.now();
        updateRecordingTime();
        recordingTimer = setInterval(updateRecordingTime, 1000);
    }

    function stopRecording() {
        recordButton.classList.remove('recording');
        recordButton.disabled = false;
        stopButton.classList.add('d-none');
        cancelButton.classList.add('d-none');
        clearInterval(recordingTimer);
    }

    function updateRecordingTime() {
        const elapsedTime = Date.now() - recordingStartTime;
        const seconds = Math.floor(elapsedTime / 1000) % 60;
        const minutes = Math.floor(elapsedTime / (1000 * 60));
        recordingTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function resetRecordingState() {
        audioChunks = [];
        audioBlob = null;
        recordButton.classList.remove('recording');
        recordButton.disabled = false;
        stopButton.classList.add('d-none');
        cancelButton.classList.add('d-none');
        recordingTime.classList.add('d-none');
        recordedAudio.classList.add('d-none');
        recordTranscribeBtn.classList.add('d-none');
        recordingStatus.textContent = "Click to start recording";
        interimTranscription.textContent = '';
        clearInterval(recordingTimer);
        recordingTimer = null;
    }

    copyBtn.addEventListener('click', function () {
        if (!transcriptionText.textContent.trim()) return;
        navigator.clipboard.writeText(transcriptionText.textContent)
            .then(() => {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check me-2"></i>Copied!';
                setTimeout(() => copyBtn.innerHTML = originalText, 2000);
            })
            .catch(err => showError('Failed to copy: ' + err));
    });

    downloadBtn.addEventListener('click', function () {
        if (!transcriptionText.textContent.trim()) return;
        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(transcriptionText.textContent));
        element.setAttribute('download', 'transcription.txt');
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    });

    audioFileInput.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;
        const validExtensions = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];
        const ext = file.name.split('.').pop().toLowerCase();
        if (!validExtensions.includes(ext)) {
            this.value = '';
            showError(`Invalid file type. Use: ${validExtensions.join(', ')}`);
        } else {
            errorAlert.classList.add('d-none');
        }
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorAlert.classList.remove('d-none');
        errorAlert.scrollIntoView({ behavior: 'smooth' });
    }

    function scrollToResults() {
        resultsCard.scrollIntoView({ behavior: 'smooth' });
    }
});
