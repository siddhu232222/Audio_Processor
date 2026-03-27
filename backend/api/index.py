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
# Removed emergentintegrations
from openai import OpenAI 

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Models (Same as before)
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

# Audio Utility Functions (Logic remains identical)
def convert_to_target_frequency(audio_data, original_sr, target_sr=8000):
    if original_sr != target_sr:
        num_samples = int(len(audio_data) * target_sr / original_sr)
        audio_resampled = signal.resample(audio_data, num_samples)
    else:
        audio_resampled = audio_data
    nyquist = target_sr / 2
    low_freq = 500 / nyquist
    high_freq = min(3500, nyquist - 100) / nyquist
    b, a = signal.butter(4, [low_freq, high_freq], btype='band')
    filtered_audio = signal.filtfilt(b, a, audio_resampled)
    return filtered_audio, target_sr

def remove_background_noise(audio_data, sample_rate):
    audio_float = audio_data.astype(np.float32) if audio_data.dtype != np.float32 else audio_data
    max_val = np.max(np.abs(audio_float))
    if max_val > 1.0: audio_float /= max_val
    return nr.reduce_noise(y=audio_float, sr=sample_rate, prop_decrease=0.8, n_fft=512, hop_length=128)

def generate_spectrogram(audio_data, sample_rate):
    frequencies, times, spectrogram = signal.spectrogram(audio_data, fs=sample_rate, nperseg=256, noverlap=128, nfft=512)
    spec_db = 10 * np.log10(spectrogram + 1e-10)
    spec_min, spec_max = spec_db.min(), spec_db.max()
    norm = (spec_db - spec_min) / (spec_max - spec_min) if spec_max > spec_min else spec_db
    return norm.tolist(), frequencies.tolist(), times.tolist()

# Routes
@api_router.get("/")
async def root():
    return {"message": "Audio Processing API"}

@api_router.post("/audio/process", response_model=AudioProcessResponse)
async def process_audio(file: UploadFile = File(...)):
    try:
        content = await file.read()
        audio_id = str(uuid.uuid4())
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name
        try:
            original_sr, audio_data = wavfile.read(tmp_path)
            if len(audio_data.shape) > 1: audio_data = np.mean(audio_data, axis=1)
            if audio_data.dtype == np.int16: audio_data = audio_data.astype(np.float32) / 32768.0
            denoised = remove_background_noise(audio_data, original_sr)
            target_sr = 8000
            processed, new_sr = convert_to_target_frequency(denoised, original_sr, target_sr)
            spec_data, spec_freqs, spec_times = generate_spectrogram(processed, new_sr)
            processed_int = np.clip(processed * 32767, -32768, 32767).astype(np.int16)
            wav_buffer = io.BytesIO()
            wavfile.write(wav_buffer, new_sr, processed_int)
            wav_buffer.seek(0)
            audio_base64 = base64.b64encode(wav_buffer.read()).decode('utf-8')
            duration = len(processed) / new_sr
            doc = {"id": audio_id, "processed_audio_base64": audio_base64, "duration": duration, "created_at": datetime.now(timezone.utc).isoformat()}
            await db.processed_audio.insert_one(doc)
            return AudioProcessResponse(id=audio_id, original_sample_rate=original_sr, processed_sample_rate=new_sr, processed_audio_base64=audio_base64, spectrogram_data=spec_data, spectrogram_frequencies=spec_freqs, spectrogram_times=spec_times, duration=duration)
        finally:
            os.unlink(tmp_path)
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/audio/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(file: UploadFile = File(...)):
    """Updated to use standard OpenAI Whisper client"""
    try:
        content = await file.read()
        audio_id = str(uuid.uuid4())
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name
        try:
            # Initialize standard OpenAI client
            # Note: Ensure OPENAI_API_KEY is set in Vercel Environment Variables
            client_ai = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
            
            with open(tmp_path, "rb") as audio_file:
                # Standard Whisper transcription call
                response = client_ai.audio.transcriptions.create(
                    model="whisper-1", 
                    file=audio_file,
                    response_format="verbose_json"
                )
            
            transcription_text = response.text
            language = getattr(response, 'language', 'en')
            
            doc = {"id": audio_id, "transcription": transcription_text, "language": language, "created_at": datetime.now(timezone.utc).isoformat()}
            await db.transcriptions.insert_one(doc)
            
            return TranscriptionResponse(id=audio_id, transcription=transcription_text, language=language)
        finally:
            os.unlink(tmp_path)
    except Exception as e:
        logger.error(f"Transcription Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# Required for Vercel
app = app
