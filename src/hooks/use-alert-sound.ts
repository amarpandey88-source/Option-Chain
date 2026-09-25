"use client";
import { useCallback, useRef, useEffect } from "react";

type AlertKind = "bull" | "bear" | "neutral" | "win";

export function useAlertSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const onGesture = () => {
      if (!ctxRef.current) { try { ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch {} }
      if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
    };
    window.addEventListener("click", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    return () => { window.removeEventListener("click", onGesture); window.removeEventListener("keydown", onGesture); };
  }, [enabled]);

  const playTone = useCallback((freq: number, start: number, dur: number, vol: number, type: OscillatorType = "sine") => {
    const ctx = ctxRef.current; if (!ctx) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
    gain.gain.setValueAtTime(0, ctx.currentTime + start);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur);
  }, []);

  const play = useCallback((kind: AlertKind) => {
    if (!enabled) return;
    if (!ctxRef.current) { try { ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return; } }
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
    if (kind === "win") {
      playTone(523.25, 0, 0.14, 0.22);
      playTone(659.25, 0.12, 0.14, 0.22);
      playTone(783.99, 0.24, 0.14, 0.24);
      playTone(1046.5, 0.36, 0.42, 0.28);
    } else if (kind === "bull") { playTone(523.25, 0, 0.18, 0.25); playTone(659.25, 0.15, 0.18, 0.25); playTone(783.99, 0.3, 0.32, 0.3); }
    else if (kind === "bear") { playTone(440, 0, 0.22, 0.28, "sawtooth"); playTone(329.63, 0.2, 0.4, 0.3, "sawtooth"); }
    else playTone(600, 0, 0.25, 0.2, "triangle");
  }, [enabled, playTone]);

  const preview = useCallback(() => {
    if (!ctxRef.current) { try { ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return; } }
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
    play("bull");
  }, [play]);

  const celebrate = useCallback(() => play("win"), [play]);

  return { play, preview, celebrate };
}
