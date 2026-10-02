"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

export type OrbMode = "idle" | "connecting" | "listening" | "speaking" | "muted";

// A flat, two-colour voice indicator: a ring that breathes with the audio level
// and a waveform line across it. Jane speaking is deep blue, the caller is teal.
export function VoiceOrb({ mode, level }: { mode: OrbMode; level: MutableRefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const colors = {
      ring: color("--border-strong", "#cfd4dc"),
      fill: color("--blue-50", "#eef2f8"),
      jane: color("--blue-800", "#12305f"),
      caller: color("--teal-600", "#0e7c86"),
      quiet: color("--border-strong", "#cfd4dc"),
    };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frame = 0;
    let smoothed = 0;
    let phase = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const size = canvas.clientWidth;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const size = canvas.clientWidth;
      const c = size / 2;
      const m = modeRef.current;
      const active = m === "listening" || m === "speaking";
      const target = active && !reduceMotion ? Math.min(1, level.current * 3) : m === "connecting" && !reduceMotion ? 0.15 : 0;
      smoothed += (target - smoothed) * 0.18;
      phase += reduceMotion ? 0 : 0.07 + smoothed * 0.12;

      ctx.clearRect(0, 0, size, size);

      ctx.beginPath();
      ctx.arc(c, c, size * 0.44, 0, Math.PI * 2);
      ctx.strokeStyle = colors.ring;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(c, c, size * (0.33 + smoothed * 0.06), 0, Math.PI * 2);
      ctx.fillStyle = colors.fill;
      ctx.fill();

      const lineColor = m === "speaking" ? colors.jane : m === "listening" ? colors.caller : colors.quiet;
      const amplitude = size * 0.11 * smoothed;
      const left = size * 0.1;
      const width = size * 0.8;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const envelope = Math.sin(Math.PI * t);
        const wave = Math.sin(t * 14 + phase) * 0.6 + Math.sin(t * 31 - phase * 1.6) * 0.4;
        const x = left + t * width;
        const y = c + wave * amplitude * envelope;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.stroke();

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [level]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ width: "100%", maxWidth: 280, aspectRatio: "1 / 1", display: "block" }} />;
}
