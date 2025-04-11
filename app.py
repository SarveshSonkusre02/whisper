import os
import logging
import tempfile
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
from utils.audio_processing import preprocess_audio, transcribe_with_whisper
from flask_socketio import SocketIO, emit
import speech_recognition as sr
import io
import wave

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET")

# Set up SocketIO (after app is created)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Configure upload settings
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'm4a', 'ogg', 'flac'}
MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25MB
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['TIMEOUT'] = 300  # 5 minutes

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    if 'audioFile' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['audioFile']

    if file.filename == '':
        file_ext = 'wav'
    else:
        if not allowed_file(file.filename):
            return jsonify({'error': f'File type not supported. Allowed types: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
        file_ext = file.filename.split('.')[-1]

    tmp_file_path = None
    processed_file_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_ext}") as tmp_file:
            file.save(tmp_file.name)
            tmp_file_path = tmp_file.name

        logger.debug(f"Audio file saved to temporary location: {tmp_file_path}")

        processed_file_path = preprocess_audio(tmp_file_path)
        logger.debug(f"Audio preprocessing complete, processed file: {processed_file_path}")

        logger.debug("Starting transcription with local Whisper model...")
        transcription = transcribe_with_whisper(processed_file_path)
        logger.info(f"[FINAL] {transcription}")  # Log final result
        logger.debug("Transcription complete with local Whisper model")

        return jsonify({'transcription': transcription})

    except Exception as e:
        logger.error(f"Error during transcription: {str(e)}")
        return jsonify({'error': f'Error during transcription: {str(e)}'}), 500

    finally:
        try:
            if tmp_file_path and os.path.exists(tmp_file_path):
                os.remove(tmp_file_path)
                logger.debug(f"Removed temporary file: {tmp_file_path}")
            if processed_file_path and processed_file_path != tmp_file_path and os.path.exists(processed_file_path):
                os.remove(processed_file_path)
                logger.debug(f"Removed processed file: {processed_file_path}")
        except Exception as e:
            logger.error(f"Error cleaning up temporary files: {str(e)}")


# ---------------------
# Realtime mic handler
# ---------------------
@socketio.on('mic_audio_chunk')
def handle_mic_audio_chunk(data):
    """Receive raw mic audio in chunks, transcribe, and emit interim result"""
    logger.debug("Received audio chunk from client")

    try:
        audio_bytes = data.get('audio')
        if not audio_bytes:
            logger.warning("No audio data received")
            return

        logger.debug(f"Audio chunk size: {len(audio_bytes)} bytes")

        audio_stream = io.BytesIO(audio_bytes)
        with wave.open(audio_stream, 'rb') as wf:
            sample_rate = wf.getframerate()
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            raw_data = wf.readframes(wf.getnframes())

        recognizer = sr.Recognizer()
        audio_data = sr.AudioData(raw_data, sample_rate, sample_width)

        try:
            text = recognizer.recognize_google(audio_data)
            logger.info(f"[INTERIM] {text}")  # ✅ Log interim result
            emit('interim_transcription', {'text': text})
        except sr.UnknownValueError:
            logger.info("[INTERIM] Silence or unclear speech")
            emit('interim_transcription', {'text': ''})
        except sr.RequestError as e:
            logger.error(f"Google SR error: {e}")
            emit('interim_transcription', {'error': 'Speech recognition error'})

    except Exception as e:
        logger.error(f"Error handling mic audio: {str(e)}")
        emit('interim_transcription', {'error': 'Internal server error'})


# ---------------------
# Final transcription trigger (simulated)
# ---------------------
@socketio.on('get_final_transcription')
def handle_get_final_transcription():
    logger.info("[FINAL] Transcription requested by client")

    # You should replace this with actual full text from session or buffer
    final_text = "This is the full transcription result (placeholder)"
    logger.info(f"[FINAL] {final_text}")

    emit('final_transcription', {'text': final_text})


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=10000, debug=False)
