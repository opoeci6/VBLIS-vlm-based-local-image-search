import { useEffect, useRef } from 'react';
import { VBLIS_ASCII_POINTS } from '../../utils/asciiLogoPoints';

export const AsciiLogo = () => {
  const outputRef = useRef(null);
  const stageRef = useRef(null);
  const particleCanvasRef = useRef(null);

  useEffect(() => {
    const columns = 86;
    const rows = 22;
    const luminance = '.,:;irsXA253hMHGS#9B&@';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frameId;
    let scatterFrameId;
    let angle = -0.45;
    let isScattered = false;
    let latestCharacters = [];
    let particles = [];
    let canvasWidth = window.innerWidth;
    let canvasHeight = window.innerHeight;

    const resizeCanvas = () => {
      const canvas = particleCanvasRef.current;
      if (!canvas) return;

      const previousWidth = canvasWidth;
      const previousHeight = canvasHeight;
      canvasWidth = window.innerWidth;
      canvasHeight = window.innerHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvasWidth * pixelRatio);
      canvas.height = Math.round(canvasHeight * pixelRatio);
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;

      if (isScattered && previousWidth > 0 && previousHeight > 0) {
        const scaleX = canvasWidth / previousWidth;
        const scaleY = canvasHeight / previousHeight;
        particles.forEach(particle => {
          particle.x *= scaleX;
          particle.y *= scaleY;
          particle.startX *= scaleX;
          particle.startY *= scaleY;
          particle.targetX *= scaleX;
          particle.targetY *= scaleY;
        });
      }
    };

    const drawParticles = () => {
      const canvas = particleCanvasRef.current;
      const output = outputRef.current;
      if (!canvas || !output) return;

      const context = canvas.getContext('2d');
      const pixelRatio = window.devicePixelRatio || 1;
      const outputStyle = window.getComputedStyle(output);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      context.fillStyle = outputStyle.color;
      context.font = `${outputStyle.fontWeight} ${outputStyle.fontSize} ${outputStyle.fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      particles.forEach(particle => {
        context.fillText(particle.character, particle.x, particle.y);
      });
    };

    const getProtectedRectangles = () => {
      const selectors = [
        'header',
        'button',
        'input',
        'select',
        'h1',
        'h2',
        'h3',
        'p',
        'label',
        '[data-ascii-protected="true"]'
      ];

      return Array.from(document.querySelectorAll(selectors.join(',')))
        .map(element => element.getBoundingClientRect())
        .filter(rectangle => rectangle.width > 0 && rectangle.height > 0)
        .map(rectangle => ({
          left: rectangle.left - 14,
          right: rectangle.right + 14,
          top: rectangle.top - 10,
          bottom: rectangle.bottom + 10
        }));
    };

    const startScatter = () => {
      const output = outputRef.current;
      if (!output || isScattered || latestCharacters.length === 0) return;

      isScattered = true;
      window.clearTimeout(frameId);
      resizeCanvas();

      const outputRectangle = output.getBoundingClientRect();
      const outputStyle = window.getComputedStyle(output);
      const lineHeight = parseFloat(outputStyle.lineHeight) || parseFloat(outputStyle.fontSize);
      const cellWidth = outputRectangle.width / columns;
      const centerX = outputRectangle.left + outputRectangle.width / 2;
      const centerY = outputRectangle.top + outputRectangle.height / 2;
      const protectedRectangles = getProtectedRectangles();
      const occupiedDestinations = new Set();
      const minimumDistance = Math.min(canvasWidth, canvasHeight) * 0.2;

      const isSafeDestination = (x, y) => {
        if (x < 12 || x > canvasWidth - 12 || y < 42 || y > canvasHeight - 12) return false;
        if (Math.hypot(x - centerX, y - centerY) < minimumDistance) return false;
        if (protectedRectangles.some(rectangle => (
          x >= rectangle.left
          && x <= rectangle.right
          && y >= rectangle.top
          && y <= rectangle.bottom
        ))) return false;

        const destinationKey = `${Math.round(x / 11)}:${Math.round(y / 14)}`;
        if (occupiedDestinations.has(destinationKey)) return false;
        occupiedDestinations.add(destinationKey);
        return true;
      };

      particles = latestCharacters.map((item, index) => {
        const startX = outputRectangle.left + (item.column + 0.5) * cellWidth;
        const startY = outputRectangle.top + (item.row + 0.5) * lineHeight;
        let targetX = startX;
        let targetY = startY;

        for (let attempt = 0; attempt < 120; attempt += 1) {
          const candidateX = 12 + Math.random() * Math.max(1, canvasWidth - 24);
          const candidateY = 42 + Math.random() * Math.max(1, canvasHeight - 54);
          if (isSafeDestination(candidateX, candidateY)) {
            targetX = candidateX;
            targetY = candidateY;
            break;
          }
        }

        return {
          character: item.character,
          column: item.column,
          row: item.row,
          startX,
          startY,
          targetX,
          targetY,
          x: startX,
          y: startY,
          delay: (index % 13) * 12,
          duration: 1050 + Math.random() * 650
        };
      });

      output.style.visibility = 'hidden';
      const animationStart = performance.now();

      const animateScatter = currentTime => {
        let animationComplete = true;

        particles.forEach(particle => {
          const elapsed = currentTime - animationStart - particle.delay;
          const progress = Math.max(0, Math.min(1, elapsed / particle.duration));
          const easedProgress = 1 - Math.pow(1 - progress, 3);
          particle.x = particle.startX + (particle.targetX - particle.startX) * easedProgress;
          particle.y = particle.startY + (particle.targetY - particle.startY) * easedProgress;
          if (progress < 1) animationComplete = false;
        });

        drawParticles();
        if (!animationComplete && !reduceMotion) {
          scatterFrameId = window.requestAnimationFrame(animateScatter);
        } else if (reduceMotion) {
          particles.forEach(particle => {
            particle.x = particle.targetX;
            particle.y = particle.targetY;
          });
          drawParticles();
        }
      };

      scatterFrameId = window.requestAnimationFrame(animateScatter);
    };

    const returnScatter = () => {
      const output = outputRef.current;
      const canvas = particleCanvasRef.current;
      if (!output || !canvas || !isScattered || particles.length === 0) return;

      window.cancelAnimationFrame(scatterFrameId);
      const outputRectangle = output.getBoundingClientRect();
      const outputStyle = window.getComputedStyle(output);
      const lineHeight = parseFloat(outputStyle.lineHeight) || parseFloat(outputStyle.fontSize);
      const cellWidth = outputRectangle.width / columns;
      const animationStart = performance.now();

      particles.forEach((particle, index) => {
        particle.returnStartX = particle.x;
        particle.returnStartY = particle.y;
        particle.homeX = outputRectangle.left + (particle.column + 0.5) * cellWidth;
        particle.homeY = outputRectangle.top + (particle.row + 0.5) * lineHeight;
        particle.returnDelay = ((particles.length - index) % 11) * 8;
        particle.returnDuration = 780 + Math.random() * 320;
      });

      const finishReturn = () => {
        const context = canvas.getContext('2d');
        const pixelRatio = window.devicePixelRatio || 1;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        output.style.visibility = 'visible';
        isScattered = false;
        particles = [];

        if (reduceMotion) {
          renderFrame();
        } else {
          animate();
        }

        if (stageRef.current?.matches(':hover')) {
          startScatter();
        }
      };

      const animateReturn = currentTime => {
        let animationComplete = true;

        particles.forEach(particle => {
          const elapsed = currentTime - animationStart - particle.returnDelay;
          const progress = Math.max(0, Math.min(1, elapsed / particle.returnDuration));
          const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          particle.x = particle.returnStartX + (particle.homeX - particle.returnStartX) * easedProgress;
          particle.y = particle.returnStartY + (particle.homeY - particle.returnStartY) * easedProgress;
          if (progress < 1) animationComplete = false;
        });

        drawParticles();
        if (!animationComplete && !reduceMotion) {
          scatterFrameId = window.requestAnimationFrame(animateReturn);
        } else {
          particles.forEach(particle => {
            particle.x = particle.homeX;
            particle.y = particle.homeY;
          });
          drawParticles();
          finishReturn();
        }
      };

      if (reduceMotion) {
        finishReturn();
      } else {
        scatterFrameId = window.requestAnimationFrame(animateReturn);
      }
    };

    const renderFrame = () => {
      const characters = Array(columns * rows).fill(' ');
      const depthBuffer = Array(columns * rows).fill(-Infinity);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const tilt = -0.12;
      const tiltCosine = Math.cos(tilt);
      const tiltSine = Math.sin(tilt);

      VBLIS_ASCII_POINTS.forEach(point => {
        const rotatedX = point.x * cosine + point.z * sine;
        const rotatedZ = -point.x * sine + point.z * cosine;
        const rotatedY = point.y * tiltCosine - rotatedZ * tiltSine;
        const finalZ = point.y * tiltSine + rotatedZ * tiltCosine;
        const perspective = 34 / (34 - finalZ);
        const screenX = Math.round(columns / 2 + rotatedX * 2.15 * perspective);
        const screenY = Math.round(rows / 2 + rotatedY * 1.65 * perspective);

        if (screenX < 0 || screenX >= columns || screenY < 0 || screenY >= rows) return;

        const index = screenY * columns + screenX;
        if (finalZ <= depthBuffer[index]) return;

        const shade = Math.max(0, Math.min(1, (finalZ + 17) / 34));
        characters[index] = luminance[Math.round(shade * (luminance.length - 1))];
        depthBuffer[index] = finalZ;
      });

      if (outputRef.current) {
        latestCharacters = characters.reduce((visibleCharacters, character, index) => {
          if (character !== ' ') {
            visibleCharacters.push({
              character,
              column: index % columns,
              row: Math.floor(index / columns)
            });
          }
          return visibleCharacters;
        }, []);
        outputRef.current.textContent = Array.from({ length: rows }, (_, row) =>
          characters.slice(row * columns, (row + 1) * columns).join('').trimEnd()
        ).join('\n');
      }
    };

    const animate = () => {
      if (isScattered) return;
      renderFrame();
      angle += 0.035;
      frameId = window.setTimeout(animate, 70);
    };

    if (reduceMotion) {
      renderFrame();
    } else {
      animate();
    }

    resizeCanvas();
    const stage = stageRef.current;
    stage?.addEventListener('mouseenter', startScatter);
    stage?.addEventListener('mouseleave', returnScatter);
    window.addEventListener('resize', resizeCanvas);

    const themeObserver = new MutationObserver(() => {
      if (isScattered) drawParticles();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      window.clearTimeout(frameId);
      window.cancelAnimationFrame(scatterFrameId);
      stage?.removeEventListener('mouseenter', startScatter);
      stage?.removeEventListener('mouseleave', returnScatter);
      window.removeEventListener('resize', resizeCanvas);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <>
      <canvas ref={particleCanvasRef} className="ascii-particle-layer" aria-hidden="true" />
      <div ref={stageRef} className="vblis-ascii-stage" role="img" aria-label="VBLIS rotating 3D ASCII logo">
        <pre ref={outputRef} className="vblis-ascii-output" aria-hidden="true" />
      </div>
    </>
  );
};
