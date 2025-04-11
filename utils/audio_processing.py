import os
import tempfile
import logging
import subprocess
import torch
import whisper  # OpenAI's Whisper model for speech recognition
os.environ["PATH"] += os.pathsep + r"D:\ffmpeg-7.1-full_build\ffmpeg-7.1-full_build\bin"

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Cache for loaded models to avoid reloading for each request
_whisper_model = None

def get_whisper_model():
    """
    Load the Whisper model (lazy loading to save memory)
    
    Returns:
        The loaded Whisper model
    """
    global _whisper_model
    if _whisper_model is None:
        logger.info("Loading Whisper model...")
        # Using the tiny model for fastest download and great compatibility
        # Options: "tiny", "base", "small", "medium", "large"
        logger.info("Downloading the tiny model (75MB) - extremely fast download...")
        
        try:
            _whisper_model = whisper.load_model("large")
            logger.info("Whisper model loaded successfully")
        except Exception as e:
            logger.error(f"Error loading whisper model: {str(e)}")
            raise
    return _whisper_model

def check_ffmpeg():
    """Check if FFmpeg is installed"""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.SubprocessError, FileNotFoundError):
        logger.warning("FFmpeg is not installed or not in PATH. Audio preprocessing may fail.")
        return False

def preprocess_audio(file_path):
    """
    Preprocess audio file to ensure compatibility with Whisper model
    
    Args:
        file_path: Path to the audio file
        
    Returns:
        Path to the processed audio file
    """
    # Check if FFmpeg is available
    if not check_ffmpeg():
        logger.warning("FFmpeg not available. Skipping preprocessing.")
        return file_path
        
    try:
        # Create a temporary file for the processed audio
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_file:
            output_path = tmp_file.name
        
        # Convert audio to WAV format, 16kHz mono
        cmd = [
            'ffmpeg',
            '-i', file_path,
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',      # mono channel
            '-c:a', 'pcm_s16le',  # 16-bit PCM encoding
            '-y',            # Overwrite output file if it exists
            output_path
        ]
        
        # Run FFmpeg command with a timeout to prevent hanging
        process = subprocess.run(
            cmd, 
            check=False,  # Don't raise exception on non-zero exit
            capture_output=True,
            timeout=60    # Set timeout to 60 seconds
        )
        
        # Check if process was successful
        if process.returncode != 0:
            logger.error(f"FFmpeg error: {process.stderr.decode('utf-8', errors='replace')}")
            return file_path

        logger.debug(f"Audio preprocessing complete: {output_path}")
        return output_path
    
    except subprocess.TimeoutExpired:
        logger.error("FFmpeg process timed out after 60 seconds")
        return file_path  # Return the original file if preprocessing times out
    
    except subprocess.SubprocessError as e:
        logger.error(f"FFmpeg preprocessing failed: {str(e)}")
        return file_path  # Return the original file if preprocessing fails
    
    except Exception as e:
        logger.error(f"Error during audio preprocessing: {str(e)}")
        # Check if output_path was defined before the error occurred
        output_path_var = locals().get('output_path')
        if output_path_var and os.path.exists(output_path_var):
            os.remove(output_path_var)
        return file_path

def transcribe_with_whisper(audio_file_path):
    """
    Transcribe audio using the locally installed Whisper model
    
    Args:
        audio_file_path: Path to the preprocessed audio file
        
    Returns:
        Transcribed text
    """
    try:
        # Get the Whisper model
        model = get_whisper_model()
        
        logger.info(f"Transcribing audio file: {audio_file_path}")
        # Transcribe the audio file
        result = model.transcribe(audio_file_path)
        
        logger.info("Transcription complete")
        return result["text"]
    
    except Exception as e:
        logger.error(f"Error during Whisper transcription: {str(e)}")
        raise
