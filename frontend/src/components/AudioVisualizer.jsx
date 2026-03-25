import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";

export const AudioVisualizer = ({ audioUrl, isRecording, color = "#007AFF" }) => {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  
  // Recording visualization
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);

  // Initialize WaveSurfer for playback
  useEffect(() => {
    if (!containerRef.current || isRecording) return;

    // Create WaveSurfer instance
    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: `${color}88`,
      cursorColor: "#FFFFFF",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 80,
      normalize: true,
      backend: "WebAudio",
      responsive: true,
    });

    wavesurferRef.current = wavesurfer;

    wavesurfer.on("ready", () => {
      setIsReady(true);
    });

    return () => {
      wavesurfer.destroy();
      wavesurferRef.current = null;
    };
  }, [color, isRecording]);

  // Load audio URL
  useEffect(() => {
    if (wavesurferRef.current && audioUrl && !isRecording) {
      wavesurferRef.current.load(audioUrl);
    }
  }, [audioUrl, isRecording]);

  // Recording visualization with canvas
  useEffect(() => {
    if (!isRecording || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    // Set canvas size
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();

    // Get microphone stream
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        analyserRef.current = audioContextRef.current.createAnalyser();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(analyserRef.current);
        
        analyserRef.current.fftSize = 256;
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
          if (!isRecording) return;
          
          animationRef.current = requestAnimationFrame(draw);
          analyserRef.current.getByteFrequencyData(dataArray);

          ctx.fillStyle = "#0D0D0F";
          ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

          const barWidth = (canvas.offsetWidth / bufferLength) * 2.5;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.offsetHeight;
            
            ctx.fillStyle = `${color}`;
            ctx.fillRect(
              x,
              canvas.offsetHeight - barHeight,
              barWidth,
              barHeight
            );
            
            x += barWidth + 1;
          }
        };

        draw();
      })
      .catch(err => console.error("Error accessing microphone:", err));

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [isRecording, color]);

  // Empty state
  if (!audioUrl && !isRecording) {
    return (
      <div 
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
        data-testid="audio-visualizer-empty"
      >
        <div className="text-center">
          <div className="w-full h-16 flex items-end justify-center gap-1 opacity-30">
            {[...Array(32)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-white/20 rounded-sm"
                style={{ height: `${Math.random() * 60 + 10}%` }}
              />
            ))}
          </div>
          <p className="text-xs text-[#A1A1AA] mt-2">No audio</p>
        </div>
      </div>
    );
  }

  // Recording state
  if (isRecording) {
    return (
      <div className="w-full h-full relative">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full"
          data-testid="audio-visualizer-recording"
        />
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <div className="w-2 h-2 bg-[#FF3B30] rounded-full animate-pulse" />
          <span className="text-xs text-[#FF3B30] font-mono">REC</span>
        </div>
      </div>
    );
  }

  // Playback state with WaveSurfer
  return (
    <div 
      ref={containerRef} 
      className="w-full h-full"
      data-testid="audio-visualizer-waveform"
    />
  );
};
