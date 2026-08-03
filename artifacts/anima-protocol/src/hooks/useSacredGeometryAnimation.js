import { useEffect, useRef } from 'react';

export const useSacredGeometryAnimation = (canvasRef, emotionIntensity = 5) => {
  const animationRef = useRef(null);
  const timeRef = useRef(0);
  const intensityRef = useRef(emotionIntensity);

  useEffect(() => {
    intensityRef.current = emotionIntensity;
  }, [emotionIntensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawSacredGeometry = (time) => {
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;
      const intensity = intensityRef.current;

      // Clear with dark background
      ctx.fillStyle = 'rgba(13, 27, 42, 0)';
      ctx.fillRect(0, 0, w, h);

      const centerX = w / 2;
      const centerY = h / 2;
      const pulseAmount = (Math.sin(time * 0.0005 * intensity) + 1) / 2; // 0-1 range
      const baseScale = 50 + pulseAmount * 20 * intensity;
      const baseRotation = time * 0.0001;

      // Draw multiple nested sacred geometry layers
      for (let layer = 0; layer < 3; layer++) {
        const scale = baseScale + layer * 60;
        const opacity = (0.15 - layer * 0.04) * (0.5 + pulseAmount * 0.5);
        const rotation = baseRotation * (layer + 1) + layer * Math.PI / 3;

        // Flower of Life pattern
        drawFlowerOfLife(ctx, centerX, centerY, scale, rotation, opacity);

        // Sacred geometry lines
        drawGeometricLines(ctx, centerX, centerY, scale, rotation, opacity * 0.6);
      }

      // Draw pulsing center orb
      const orbRadius = 20 + pulseAmount * 10;
      ctx.strokeStyle = `rgba(0, 229, 255, ${0.4 * (0.5 + pulseAmount * 0.5)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, orbRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner rotating lines from center
      for (let i = 0; i < 6; i++) {
        const angle = (baseRotation + (i * Math.PI / 3));
        const x1 = centerX + Math.cos(angle) * orbRadius;
        const y1 = centerY + Math.sin(angle) * orbRadius;
        const x2 = centerX + Math.cos(angle) * (orbRadius + 30 + pulseAmount * 10);
        const y2 = centerY + Math.sin(angle) * (orbRadius + 30 + pulseAmount * 10);

        ctx.strokeStyle = `rgba(0, 229, 255, ${0.3 * (0.5 + pulseAmount * 0.5)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      timeRef.current += 16; // ~60fps increment
      animationRef.current = requestAnimationFrame(drawSacredGeometry);
    };

    animationRef.current = requestAnimationFrame(drawSacredGeometry);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef]);
};

const drawFlowerOfLife = (ctx, centerX, centerY, radius, rotation, opacity) => {
  const circles = 6;
  ctx.strokeStyle = `rgba(0, 229, 255, ${opacity})`;
  ctx.lineWidth = 1.5;

  for (let i = 0; i < circles; i++) {
    const angle = rotation + (i * Math.PI * 2) / circles;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;

    ctx.beginPath();
    ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.8, 0, Math.PI * 2);
  ctx.stroke();
};

const drawGeometricLines = (ctx, centerX, centerY, radius, rotation, opacity) => {
  const sides = 6;
  const points = [];

  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * Math.PI * 2) / sides;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    points.push({ x, y });
  }

  ctx.strokeStyle = `rgba(0, 229, 255, ${opacity})`;
  ctx.lineWidth = 1;

  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    ctx.beginPath();
    ctx.moveTo(points[i].x, points[i].y);
    ctx.lineTo(points[next].x, points[next].y);
    ctx.stroke();

    // Cross-connections for more intricate pattern
    if (i < points.length - 2) {
      ctx.beginPath();
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[i + 2].x, points[i + 2].y);
      ctx.stroke();
    }
  }
};