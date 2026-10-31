import { useMemo } from "react";

const NUM_BARS = 36;
const RADIUS = 96; // px radius from center

export default function WaveVisualizer({ audioLevel = 0, phase = "idle" }) {
  const isActive = phase === "listening" || phase === "speaking";

  const bars = useMemo(() => {
    return Array.from({ length: NUM_BARS }).map((_, i) => {
      const angle = (i / NUM_BARS) * 2 * Math.PI - Math.PI / 2;
      return { angle, index: i };
    });
  }, []);

  const color =
    phase === "listening"
      ? "#00c9ff"
      : phase === "speaking"
      ? "#10b981"
      : phase === "thinking"
      ? "#a855f7"
      : "#4285f4";

  return (
    <svg className="voice-wave-svg" viewBox="0 0 240 240" aria-hidden="true">
      <g transform="translate(120, 120)">
        {bars.map(({ angle, index }) => {
          const waveFactor = isActive
            ? Math.abs(Math.sin((index / NUM_BARS) * Math.PI * 4 + (audioLevel / 100) * 4))
            : 0.1;
          const barHeight = 4 + waveFactor * (isActive ? 22 : 4);

          const x1 = Math.cos(angle) * RADIUS;
          const y1 = Math.sin(angle) * RADIUS;
          const x2 = Math.cos(angle) * (RADIUS + barHeight);
          const y2 = Math.sin(angle) * (RADIUS + barHeight);

          return (
            <line
              key={index}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={2.4}
              strokeLinecap="round"
              opacity={isActive ? 0.8 : 0.2}
              style={{ transition: "all 0.08s ease" }}
            />
          );
        })}
      </g>
    </svg>
  );
}
