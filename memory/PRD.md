# Audio Processor App - PRD

## Original Problem Statement
Create a website that records audio and that audio is converted to 5 to 8Khz, and remove the background noises, and that cleared audio should able to be downloaded with transcription. The spectrogram of the audio should be visible.

## User Personas
- Podcasters needing quick audio cleanup
- Content creators requiring noise removal
- Researchers transcribing audio recordings
- General users needing audio frequency conversion

## Core Requirements (Static)
1. Audio recording via microphone
2. Audio frequency conversion to 5-8KHz range
3. Background noise removal
4. Spectrogram visualization
5. Audio download (processed)
6. Transcription with download

## What's Been Implemented (Jan 2026)
- [x] Audio recording with MediaRecorder API
- [x] Real-time waveform visualization during recording
- [x] Server-side audio processing (scipy, noisereduce)
- [x] 8KHz sample rate conversion with bandpass filter (500Hz-3500Hz)
- [x] Background noise removal using noisereduce library
- [x] Spectrogram generation and visualization (canvas-based)
- [x] Before/after audio comparison
- [x] WAV download for processed audio
- [x] Transcription using OpenAI Whisper (via Emergent LLM key)
- [x] Transcription text download

## Architecture
- **Frontend**: React + Tailwind CSS + wavesurfer.js
- **Backend**: FastAPI + MongoDB
- **Audio Processing**: scipy, noisereduce
- **Transcription**: OpenAI Whisper via emergentintegrations

## Tech Stack
- Frontend: React 19, Tailwind CSS, wavesurfer.js, Shadcn UI
- Backend: FastAPI, scipy, pydub, noisereduce
- Database: MongoDB (for storing processed audio metadata)
- AI: OpenAI Whisper for speech-to-text

## Prioritized Backlog
### P0 (Critical) - COMPLETE
- Audio recording ✓
- Audio processing (8KHz, noise removal) ✓
- Spectrogram display ✓
- Download processed audio ✓
- Transcription ✓

### P1 (Important) - Future
- MP3 download format option
- Audio file upload (not just recording)
- Adjustable noise reduction intensity
- Multiple language transcription support

### P2 (Nice to Have) - Future
- Real-time spectrogram during recording
- Audio trimming/editing
- Batch processing multiple files
- Share transcription directly to clipboard

## Next Action Items
1. Add MP3 download format conversion
2. Add file upload option (not just microphone recording)
3. Add adjustable noise reduction slider
4. Add real-time spectrogram during recording
