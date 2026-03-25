import { useEffect, useRef } from "react";

export const SpectrogramView = ({ data }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    const { data: spectrogramData, frequencies, times } = data;
    
    if (!spectrogramData || spectrogramData.length === 0) return;

    // Set canvas size
    const containerWidth = canvas.parentElement.offsetWidth;
    const containerHeight = canvas.parentElement.offsetHeight;
    
    canvas.width = containerWidth * window.devicePixelRatio;
    canvas.height = containerHeight * window.devicePixelRatio;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerHeight}px`;
    
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Draw spectrogram
    const numFreqs = spectrogramData.length;
    const numTimes = spectrogramData[0]?.length || 0;
    
    if (numFreqs === 0 || numTimes === 0) return;

    const pixelWidth = containerWidth / numTimes;
    const pixelHeight = containerHeight / numFreqs;

    // Color map function (viridis-inspired)
    const getColor = (value) => {
      // Clamp value between 0 and 1
      const v = Math.max(0, Math.min(1, value));
      
      // Viridis-like color map
      const r = Math.round(68 + v * (253 - 68));
      const g = Math.round(1 + v * (231 - 1));
      const b = Math.round(84 + v * (37 - 84));
      
      return `rgb(${r}, ${g}, ${b})`;
    };

    // Clear canvas
    ctx.fillStyle = "#0D0D0F";
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    // Draw each pixel
    for (let f = 0; f < numFreqs; f++) {
      for (let t = 0; t < numTimes; t++) {
        const value = spectrogramData[f][t];
        ctx.fillStyle = getColor(value);
        ctx.fillRect(
          t * pixelWidth,
          containerHeight - (f + 1) * pixelHeight, // Flip Y axis
          pixelWidth + 1,
          pixelHeight + 1
        );
      }
    }

    // Draw frequency axis labels
    ctx.fillStyle = "#A1A1AA";
    ctx.font = "10px JetBrains Mono";
    ctx.textAlign = "left";
    
    const maxFreq = frequencies[frequencies.length - 1] || 4000;
    const freqLabels = [0, maxFreq * 0.25, maxFreq * 0.5, maxFreq * 0.75, maxFreq];
    
    freqLabels.forEach((freq, i) => {
      const y = containerHeight - (i / (freqLabels.length - 1)) * containerHeight;
      ctx.fillText(`${Math.round(freq)}Hz`, 4, y + 4);
    });

  }, [data]);

  // Empty state
  if (!data) {
    return (
      <div 
        className="w-full h-full flex items-center justify-center bg-[#0D0D0F]"
        data-testid="spectrogram-empty"
      >
        <div className="text-center">
          <div className="grid grid-cols-16 gap-px opacity-30 mb-2">
            {[...Array(64)].map((_, i) => (
              <div
                key={i}
                className="w-2 h-2"
                style={{ 
                  backgroundColor: `hsl(${200 + Math.random() * 60}, 70%, ${20 + Math.random() * 30}%)`
                }}
              />
            ))}
          </div>
          <p className="text-xs text-[#A1A1AA]">Process audio to see spectrogram</p>
        </div>
      </div>
    );
  }

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full spectrogram-canvas"
      data-testid="spectrogram-canvas"
    />
  );
};
