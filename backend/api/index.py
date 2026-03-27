from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from openai import OpenAI
import os, uuid, tempfile, io, base64, numpy as np
from scipy import signal
from scipy.io import wavfile
import noisereduce as nr
from datetime import datetime, timezone

# Database Setup
client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ... (Include your conversion, noise reduction, and spectrogram functions here)

@api_router.post("/audio/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        # Use standard OpenAI client
        ai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        with open(tmp_path, "rb") as f:
            response = ai_client.audio.transcriptions.create(
                model="whisper-1", file=f
            )
        return {"transcription": response.text}
    finally:
        os.unlink(tmp_path)

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app = app # Crucial for Vercel
