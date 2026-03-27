from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import io
import base64
import tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile
import noisereduce as nr
from emergentintegrations.llm.openai import OpenAISpeechToText

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

class AudioProcessResponse(BaseModel):
    id: str
    original_sample_rate: int
    processed_sample_rate: int
    processed_audio_base64: str
    spectrogram_data: List[List[float]]
    spectrogram_frequencies: List[float]
    spectrogram_times: List[float]
    duration: float

class TranscriptionResponse(BaseModel):
    id: str
    transcription: str
    language: Optional[str] = None

# Audio processing functions
def convert_to_target_frequency(audio_data: np.ndarray, original_sr: int, target_sr: int = 8000) -> tuple:
    """Convert audio to target sample rate and apply bandpass filter for 5-8KHz"""
    # Resample to target sample rate if needed
    if original_sr != target_sr:
        num_samples = int(len(audio_data) * target_sr / original_sr)
        audio_resampled = signal.resample(audio_data, num_samples)
    else:
        audio_resampled = audio_data
    
    # Apply bandpass filter (500Hz to 4000Hz for voice clarity at 8kHz sample rate)
    # Nyquist frequency is half the sample rate
    nyquist = target_sr / 2
    low_freq = 500 / nyquist  # Normalized frequency
    high_freq = min(3500, nyquist - 100) / nyquist  # Stay below Nyquist
    
    # Design bandpass filter
    b, a = signal.butter(4, [low_freq, high_freq], btype='band')
    filtered_audio = signal.filtfilt(b, a, audio_resampled)
    
    return filtered_audio, target_sr

def remove_background_noise(audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
    """Remove background noise using noisereduce library"""
    # Ensure audio is float type for processing
    if audio_data.dtype != np.float32:
        audio_float = audio_data.astype(np.float32)
    else:
        audio_float = audio_data
    
    # Normalize to -1 to 1 range if needed
    max_val = np.max(np.abs(audio_float))
    if max_val > 1.0:
        audio_float = audio_float / max_val
    
    # Apply noise reduction
    reduced_noise = nr.reduce_noise(
        y=audio_float, 
        sr=sample_rate,
        prop_decrease=0.8,
        n_fft=512,
        hop_length=128
    )
    
    return reduced_noise

def generate_spectrogram(audio_data: np.ndarray, sample_rate: int) -> tuple:
    """Generate spectrogram data for visualization"""
    # Compute spectrogram
    frequencies, times, spectrogram = signal.spectrogram(
        audio_data, 
        fs=sample_rate,
        nperseg=256,
        noverlap=128,
        nfft=512
    )
    
    # Convert to dB scale for better visualization
    spectrogram_db = 10 * np.log10(spectrogram + 1e-10)
    
    # Normalize to 0-1 range
    spec_min = spectrogram_db.min()
    spec_max = spectrogram_db.max()
    if spec_max - spec_min > 0:
        spectrogram_normalized = (spectrogram_db - spec_min) / (spec_max - spec_min)
    else:
        spectrogram_normalized = spectrogram_db
    
    return spectrogram_normalized.tolist(), frequencies.tolist(), times.tolist()

# Routes
@api_router.get("/")
async def root():
    return {"message": "Audio Processing API"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    return status_checks

@api_router.post("/audio/process", response_model=AudioProcessResponse)
async def process_audio(file: UploadFile = File(...)):
    """Process uploaded audio: convert frequency, remove noise, generate spectrogram"""
    try:
        # Read the uploaded file
        content = await file.read()
        audio_id = str(uuid.uuid4())
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        try:
            # Read the audio file
            original_sr, audio_data = wavfile.read(tmp_path)
            
            # Convert to mono if stereo
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)
            
            # Convert to float
            if audio_data.dtype == np.int16:
                audio_data = audio_data.astype(np.float32) / 32768.0
            elif audio_data.dtype == np.int32:
                audio_data = audio_data.astype(np.float32) / 2147483648.0
            
            # Remove background noise first (at original sample rate for better quality)
            denoised_audio = remove_background_noise(audio_data, original_sr)
            
            # Convert to target frequency (8kHz)
            target_sr = 8000
            processed_audio, new_sr = convert_to_target_frequency(denoised_audio, original_sr, target_sr)
            
            # Generate spectrogram
            spec_data, spec_freqs, spec_times = generate_spectrogram(processed_audio, new_sr)
            
            # Convert processed audio to bytes
            processed_audio_int = np.clip(processed_audio * 32767, -32768, 32767).astype(np.int16)
            
            # Create WAV bytes
            wav_buffer = io.BytesIO()
            wavfile.write(wav_buffer, new_sr, processed_audio_int)
            wav_buffer.seek(0)
            
            # Encode to base64
            audio_base64 = base64.b64encode(wav_buffer.read()).decode('utf-8')
            
            # Calculate duration
            duration = len(processed_audio) / new_sr
            
            # Store in database
            doc = {
                "id": audio_id,
                "original_sample_rate": original_sr,
                "processed_sample_rate": new_sr,
                "processed_audio_base64": audio_base64,
                "duration": duration,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.processed_audio.insert_one(doc)
            
            return AudioProcessResponse(
                id=audio_id,
                original_sample_rate=original_sr,
                processed_sample_rate=new_sr,
                processed_audio_base64=audio_base64,
                spectrogram_data=spec_data,
                spectrogram_frequencies=spec_freqs,
                spectrogram_times=spec_times,
                duration=duration
            )
        finally:
            # Clean up temp file
            os.unlink(tmp_path)
            
    except Exception as e:
        logger.error(f"Error processing audio: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing audio: {str(e)}")

@api_router.post("/audio/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcribe audio using OpenAI Whisper"""
    try:
        content = await file.read()
        audio_id = str(uuid.uuid4())
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        try:
            # Initialize Whisper STT
            api_key = os.environ.get('EMERGENT_LLM_KEY')
            if not api_key:
                raise HTTPException(status_code=500, detail="Transcription API key not configured")
            
            stt = OpenAISpeechToText(api_key=api_key)
            
            # Transcribe
            with open(tmp_path, "rb") as audio_file:
                response = await stt.transcribe(
                    file=audio_file,
                    model="whisper-1",
                    response_format="verbose_json",
                    language="en"
                )
            
            transcription_text = response.text if hasattr(response, 'text') else str(response)
            language = response.language if hasattr(response, 'language') else "en"
            
            # Store in database
            doc = {
                "id": audio_id,
                "transcription": transcription_text,
                "language": language,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.transcriptions.insert_one(doc)
            
            return TranscriptionResponse(
                id=audio_id,
                transcription=transcription_text,
                language=language
            )
        finally:
            os.unlink(tmp_path)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error transcribing audio: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error transcribing audio: {str(e)}")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
app = app
