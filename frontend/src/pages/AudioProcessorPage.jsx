import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { 
  Mic, 
  Square, 
  Play, 
  Pause, 
  Download, 
  Loader2, 
  FileText,
  Waves,
  AudioWaveform,
  RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AudioVisualizer } from "@/components/AudioVisualizer";
import { SpectrogramView } from "@/components/SpectrogramView";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function AudioProcessorPage() {
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [processedAudioUrl, setProcessedAudioUrl] = useState(null);
  const [processedAudioBlob, setProcessedAudioBlob] = useState(null);
  
  // Transcription state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription] = useState("");
  
  // Spectrogram data
  const [spectrogramData, setSpectrogramData] = useState(null);
  
  // Audio playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingProcessed, setPlayingProcessed] = useState(false);
  
  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const processedAudioRef = useRef(null);
  const streamRef = useRef(null);

  // Status
  const getStatus = () => {
    if (isRecording) return "recording";
    if (isProcessing || isTranscribing) return "processing";
    if (processedAudioUrl) return "success";
    return "idle";
  };

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus"
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      };
      
      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      toast.success("Recording started");
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error("Could not access microphone. Please check permissions.");
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      toast.success("Recording stopped");
    }
  };

  // Convert webm to wav for processing
  const convertToWav = async (webmBlob) => {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const reader = new FileReader();
      
      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Create wav file
          const wavBuffer = audioBufferToWav(audioBuffer);
          const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
          resolve(wavBlob);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = reject;
      reader.readAsArrayBuffer(webmBlob);
    });
  };

  // Convert AudioBuffer to WAV
  const audioBufferToWav = (buffer) => {
    const numChannels = 1; // Mono
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    // Get mono channel data
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length * (bitDepth / 8);
    const headerLength = 44;
    const totalLength = headerLength + dataLength;
    
    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);
    
    // Write WAV header
    writeString(view, 0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);
    
    // Write audio data
    const offset = 44;
    for (let i = 0; i < channelData.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    }
    
    return arrayBuffer;
  };

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // Process audio
  const processAudio = async () => {
    if (!audioBlob) {
      toast.error("No audio to process");
      return;
    }
    
    setIsProcessing(true);
    setProcessProgress(10);
    
    try {
      // Convert to WAV
      setProcessProgress(20);
      toast.info("Converting audio format...");
      const wavBlob = await convertToWav(audioBlob);
      
      setProcessProgress(40);
      toast.info("Processing audio (removing noise, converting frequency)...");
      
      // Send to backend for processing
      const formData = new FormData();
      formData.append("file", wavBlob, "audio.wav");
      
      const response = await axios.post(`${API}/audio/process`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      setProcessProgress(80);
      
      const { processed_audio_base64, spectrogram_data, spectrogram_frequencies, spectrogram_times } = response.data;
      
      // Convert base64 to blob
      const byteCharacters = atob(processed_audio_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const processedBlob = new Blob([byteArray], { type: "audio/wav" });
      
      setProcessedAudioBlob(processedBlob);
      setProcessedAudioUrl(URL.createObjectURL(processedBlob));
      setSpectrogramData({
        data: spectrogram_data,
        frequencies: spectrogram_frequencies,
        times: spectrogram_times
      });
      
      setProcessProgress(100);
      toast.success("Audio processed successfully!");
      
    } catch (error) {
      console.error("Error processing audio:", error);
      toast.error("Error processing audio. Please try again.");
    } finally {
      setIsProcessing(false);
      setProcessProgress(0);
    }
  };

  // Transcribe audio
  const transcribeAudio = async () => {
    if (!processedAudioBlob) {
      toast.error("Please process the audio first");
      return;
    }
    
    setIsTranscribing(true);
    
    try {
      toast.info("Transcribing audio...");
      
      const formData = new FormData();
      formData.append("file", processedAudioBlob, "audio.wav");
      
      const response = await axios.post(`${API}/audio/transcribe`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      setTranscription(response.data.transcription);
      toast.success("Transcription complete!");
      
    } catch (error) {
      console.error("Error transcribing audio:", error);
      toast.error("Error transcribing audio. Please try again.");
    } finally {
      setIsTranscribing(false);
    }
  };

  // Download processed audio
  const downloadAudio = (format = "wav") => {
    if (!processedAudioBlob) return;
    
    const link = document.createElement("a");
    link.href = processedAudioUrl;
    link.download = `processed_audio_8khz.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success(`Audio downloaded as ${format.toUpperCase()}`);
  };

  // Download transcription
  const downloadTranscription = () => {
    if (!transcription) return;
    
    const blob = new Blob([transcription], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transcription.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success("Transcription downloaded");
  };

  // Play/pause original audio
  const togglePlayOriginal = () => {
    if (!audioRef.current) return;
    
    if (isPlaying && !playingProcessed) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (processedAudioRef.current) processedAudioRef.current.pause();
      audioRef.current.play();
      setIsPlaying(true);
      setPlayingProcessed(false);
    }
  };

  // Play/pause processed audio
  const togglePlayProcessed = () => {
    if (!processedAudioRef.current) return;
    
    if (isPlaying && playingProcessed) {
      processedAudioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (audioRef.current) audioRef.current.pause();
      processedAudioRef.current.play();
      setIsPlaying(true);
      setPlayingProcessed(true);
    }
  };

  // Reset all
  const resetAll = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setProcessedAudioUrl(null);
    setProcessedAudioBlob(null);
    setTranscription("");
    setSpectrogramData(null);
    setRecordingTime(0);
    setIsPlaying(false);
    toast.info("Reset complete");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (processedAudioUrl) URL.revokeObjectURL(processedAudioUrl);
    };
  }, []);

  // Handle audio ended
  useEffect(() => {
    const handleEnded = () => setIsPlaying(false);
    
    if (audioRef.current) {
      audioRef.current.addEventListener("ended", handleEnded);
    }
    if (processedAudioRef.current) {
      processedAudioRef.current.addEventListener("ended", handleEnded);
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener("ended", handleEnded);
      }
      if (processedAudioRef.current) {
        processedAudioRef.current.removeEventListener("ended", handleEnded);
      }
    };
  }, [audioUrl, processedAudioUrl]);

  const status = getStatus();

  return (
    <div className="min-h-screen bg-[#09090B] p-4 md:p-6 lg:p-8" data-testid="audio-processor-page">
      {/* Header */}
      <header className="mb-8" data-testid="header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <AudioWaveform className="w-8 h-8 text-[#007AFF]" />
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight font-['Manrope']">
                Audio Processor
              </h1>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#121214] border border-white/10 rounded-sm">
              <div className={`status-dot ${status}`} data-testid="status-indicator" />
              <span className="text-xs text-[#A1A1AA] uppercase tracking-wider">
                {status}
              </span>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={resetAll}
            className="border-white/10 hover:bg-white/5"
            data-testid="reset-button"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset
          </Button>
        </div>
        <p className="mt-2 text-sm text-[#A1A1AA]">
          Record audio, remove background noise, convert to 5-8KHz, and get transcription
        </p>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left Panel - Controls */}
        <div className="md:col-span-3 space-y-4">
          {/* Recording Controls */}
          <div className="panel p-4" data-testid="recording-controls">
            <h2 className="text-sm font-semibold text-white mb-4 font-['Manrope'] uppercase tracking-wider">
              Recording
            </h2>
            
            {/* Timer */}
            <div className="text-center mb-4">
              <div className="timer-display" data-testid="recording-timer">
                {formatTime(recordingTime)}
              </div>
            </div>
            
            {/* Record Button */}
            <div className="flex justify-center mb-4">
              {!isRecording ? (
                <Button
                  onClick={startRecording}
                  className="btn-record w-16 h-16 rounded-full flex items-center justify-center"
                  disabled={isProcessing || isTranscribing}
                  data-testid="record-button"
                >
                  <Mic className="w-6 h-6 text-white" />
                </Button>
              ) : (
                <Button
                  onClick={stopRecording}
                  className="bg-[#FF3B30] hover:bg-[#FF5147] w-16 h-16 rounded-full flex items-center justify-center recording-pulse"
                  data-testid="stop-record-button"
                >
                  <Square className="w-6 h-6 text-white" />
                </Button>
              )}
            </div>
            
            <p className="text-xs text-center text-[#A1A1AA]">
              {isRecording ? "Click to stop" : "Click to record"}
            </p>
          </div>

          {/* Processing Controls */}
          <div className="panel p-4" data-testid="processing-controls">
            <h2 className="text-sm font-semibold text-white mb-4 font-['Manrope'] uppercase tracking-wider">
              Processing
            </h2>
            
            <Button
              onClick={processAudio}
              disabled={!audioBlob || isProcessing || isRecording}
              className="btn-process w-full mb-3"
              data-testid="process-button"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 spinner" />
                  Processing...
                </>
              ) : (
                <>
                  <Waves className="w-4 h-4 mr-2" />
                  Process Audio
                </>
              )}
            </Button>
            
            {isProcessing && (
              <Progress value={processProgress} className="h-1" data-testid="process-progress" />
            )}
            
            <p className="text-xs text-[#A1A1AA] mt-2">
              Removes noise & converts to 8KHz
            </p>
          </div>

          {/* Transcription Controls */}
          <div className="panel p-4" data-testid="transcription-controls">
            <h2 className="text-sm font-semibold text-white mb-4 font-['Manrope'] uppercase tracking-wider">
              Transcription
            </h2>
            
            <Button
              onClick={transcribeAudio}
              disabled={!processedAudioBlob || isTranscribing || isProcessing}
              className="w-full bg-[#06B6D4] hover:bg-[#22D3EE]"
              data-testid="transcribe-button"
            >
              {isTranscribing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 spinner" />
                  Transcribing...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Transcribe
                </>
              )}
            </Button>
            
            <p className="text-xs text-[#A1A1AA] mt-2">
              Uses AI to convert speech to text
            </p>
          </div>

          {/* Download Controls */}
          <div className="panel p-4" data-testid="download-controls">
            <h2 className="text-sm font-semibold text-white mb-4 font-['Manrope'] uppercase tracking-wider">
              Downloads
            </h2>
            
            <div className="space-y-2">
              <Button
                onClick={() => downloadAudio("wav")}
                disabled={!processedAudioBlob}
                className="btn-download w-full"
                data-testid="download-wav-button"
              >
                <Download className="w-4 h-4 mr-2" />
                Download WAV
              </Button>
              
              <Button
                onClick={downloadTranscription}
                disabled={!transcription}
                variant="outline"
                className="w-full border-white/10 hover:bg-white/5"
                data-testid="download-transcription-button"
              >
                <FileText className="w-4 h-4 mr-2" />
                Download Text
              </Button>
            </div>
          </div>
        </div>

        {/* Right Panel - Visualizations */}
        <div className="md:col-span-9 space-y-4">
          {/* Audio Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Original Audio */}
            <div className="panel p-4" data-testid="original-audio-panel">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white font-['Manrope'] uppercase tracking-wider">
                  Original Audio
                </h2>
                {audioUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={togglePlayOriginal}
                    className="hover:bg-white/5"
                    data-testid="play-original-button"
                  >
                    {isPlaying && !playingProcessed ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
              
              <div className="waveform-wrapper h-24 rounded-sm">
                <AudioVisualizer 
                  audioUrl={audioUrl} 
                  isRecording={isRecording}
                  color="#007AFF"
                />
              </div>
              
              {audioUrl && (
                <audio ref={audioRef} src={audioUrl} className="hidden" />
              )}
            </div>

            {/* Processed Audio */}
            <div className="panel p-4" data-testid="processed-audio-panel">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white font-['Manrope'] uppercase tracking-wider">
                  Processed Audio (8KHz)
                </h2>
                {processedAudioUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={togglePlayProcessed}
                    className="hover:bg-white/5"
                    data-testid="play-processed-button"
                  >
                    {isPlaying && playingProcessed ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
              
              <div className="waveform-wrapper h-24 rounded-sm">
                <AudioVisualizer 
                  audioUrl={processedAudioUrl}
                  color="#10B981"
                />
              </div>
              
              {processedAudioUrl && (
                <audio ref={processedAudioRef} src={processedAudioUrl} className="hidden" />
              )}
            </div>
          </div>

          {/* Spectrogram */}
          <div className="panel p-4" data-testid="spectrogram-panel">
            <h2 className="text-sm font-semibold text-white mb-3 font-['Manrope'] uppercase tracking-wider">
              Spectrogram
            </h2>
            
            <div className="spectrogram-wrapper h-48 rounded-sm">
              <SpectrogramView data={spectrogramData} />
            </div>
            
            <div className="flex justify-between mt-2 text-xs text-[#A1A1AA]">
              <span>0 Hz</span>
              <span>Frequency Range: 0 - 4000 Hz (at 8KHz sample rate)</span>
              <span>4000 Hz</span>
            </div>
          </div>

          {/* Transcription */}
          <div className="panel p-4" data-testid="transcription-panel">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white font-['Manrope'] uppercase tracking-wider">
                Transcription
              </h2>
              {transcription && (
                <span className="text-xs text-[#A1A1AA]">
                  {transcription.split(" ").length} words
                </span>
              )}
            </div>
            
            <div 
              className={`transcription-area ${transcription ? "has-content" : ""}`}
              data-testid="transcription-text"
            >
              {transcription || (
                <span className="text-[#A1A1AA] italic">
                  Transcription will appear here after processing...
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-white/10">
        <p className="text-xs text-[#A1A1AA] text-center">
          Audio Processor • Noise Removal • 5-8KHz Conversion • AI Transcription
        </p>
      </footer>
    </div>
  );
}
