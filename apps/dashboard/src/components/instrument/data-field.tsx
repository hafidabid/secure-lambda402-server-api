"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Engraved, FlapCell, Led } from "./panel";

const CELL = 12;
const GAP = 5;
const PITCH = CELL + GAP;
const SWEEP_MS = 4200;
const BAND = 0.14;
const SCORES = ["0.88", "0.91", "0.84"];

const BASE = [46, 46, 43];
const LIFT = [92, 90, 84];
const LIGHT = [242, 239, 232];
const SIGNAL = [232, 89, 12];

type Column = { values: number[]; offset: number; speed: number };

function mix(a: number[], b: number[], t: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function cellColor(value: number, heat: number) {
  const base = mix(BASE, LIFT, value * 0.55);
  if (heat <= 0.02) return base;
  if (value > 0.82) return mix(LIFT, SIGNAL, heat);
  return mix(value > 0.5 ? LIFT : BASE, LIGHT, heat * (0.25 + value * 0.45));
}

export function DataField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const [scoreIndex, setScoreIndex] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    const random = seededRandom(7);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let columns: Column[] = [];
    let rows = 0;
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    const sweepStart = performance.now();
    let last = sweepStart;
    let sweepCount = 0;

    const build = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(width / PITCH) + 1;
      rows = Math.ceil(height / PITCH) + 2;
      columns = Array.from({ length: cols }, () => ({
        values: Array.from({ length: rows }, () => random()),
        offset: random() * PITCH,
        speed: 6 + random() * 14,
      }));
    };

    const draw = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const sweep = reduce ? 0.5 : ((now - sweepStart) % SWEEP_MS) / SWEEP_MS;
      const completed = Math.floor((now - sweepStart) / SWEEP_MS);
      if (!reduce && completed !== sweepCount) {
        sweepCount = completed;
        setScoreIndex((i) => (i + 1) % SCORES.length);
      }
      const scanX = (sweep * 1.4 - 0.2) * width;

      ctx.clearRect(0, 0, width, height);
      columns.forEach((col, c) => {
        if (!reduce) {
          col.offset += col.speed * dt;
          while (col.offset >= PITCH) {
            col.offset -= PITCH;
            col.values.pop();
            col.values.unshift(random());
          }
        }
        const x = c * PITCH;
        const heat = Math.max(0, 1 - Math.abs(x + CELL / 2 - scanX) / (width * BAND));
        col.values.forEach((value, r) => {
          const y = r * PITCH - PITCH + col.offset;
          ctx.fillStyle = cellColor(value, reduce ? 0 : heat);
          ctx.beginPath();
          ctx.roundRect(x, y, CELL, CELL, 3);
          ctx.fill();
        });
      });

      if (!reduce) {
        const glow = ctx.createLinearGradient(scanX - width * BAND, 0, scanX + width * BAND, 0);
        glow.addColorStop(0, "rgba(232,89,12,0)");
        glow.addColorStop(0.5, "rgba(232,89,12,0.10)");
        glow.addColorStop(1, "rgba(232,89,12,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(scanX - width * BAND, 0, width * BAND * 2, height);
        ctx.fillStyle = "rgba(232,89,12,0.85)";
        ctx.fillRect(scanX - 1, 0, 2, height);
      }

      frame = visible && !reduce ? requestAnimationFrame(draw) : 0;
    };

    const start = () => {
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(draw);
      }
    };

    build();
    draw(performance.now());

    const resize = new ResizeObserver(() => {
      build();
      if (!frame) draw(performance.now());
    });
    resize.observe(host);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState === "visible";
      if (visible) start();
    });
    io.observe(host);

    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduce]);

  const score = SCORES[scoreIndex];

  return (
    <div className="relative aspect-[5/4] w-full overflow-hidden rounded-[36px] bg-display shadow-[inset_0_3px_14px_rgba(0,0,0,0.6),0_40px_70px_-40px_rgba(20,18,14,0.75)]">
      <div className="absolute inset-4 overflow-hidden rounded-[24px] [mask-image:radial-gradient(ellipse_at_center,#000_55%,transparent_100%)] sm:inset-6">
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />
      </div>
      <div className="absolute left-7 top-6 flex items-center gap-2 sm:left-9 sm:top-8">
        <Led on />
        <Engraved className="text-display-dim">Enclave · data stays inside</Engraved>
      </div>
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[18px] bg-[#161614] px-4 py-3 shadow-[0_18px_30px_-16px_rgba(0,0,0,0.8)] sm:bottom-8">
        <Engraved className="text-display-dim">Score</Engraved>
        <span className="flex gap-1" aria-label={`Example score ${score}`}>
          {score.split("").map((ch, i) => (
            <FlapCell key={`${score}-${i}`} char={ch} play delay={i * 80} />
          ))}
        </span>
      </div>
    </div>
  );
}
