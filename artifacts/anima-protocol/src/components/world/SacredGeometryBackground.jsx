import { useRef, useEffect } from 'react';
import { useSacredGeometryAnimation } from '@/hooks/useSacredGeometryAnimation';

export default function SacredGeometryBackground({ 
  emotionIntensity = 5, 
  isActive = true, 
  className = '' 
}) {
  const canvasRef = useRef(null);
  useSacredGeometryAnimation(canvasRef, emotionIntensity);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${
        isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
      } ${className}`}
      style={{ mixBlendMode: 'screen' }}
    />
  );
}