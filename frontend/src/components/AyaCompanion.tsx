import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AyaState } from "../hooks/useAyaState";

const ALL_SIGNUP_SPRITES = [
  "neutral", "calm", "smile", "thinking", "happy", "laughing",
  "wink_left", "wink_right", "love_shy", "smirk", "frustrated", "angry"
];

const SIGNIN_SPRITES = [
  "neutral", "calm", "thinking", "wink_left", "smirk", "frustrated", "angry", "happy"
];

type AyaMode = "signup" | "signin";

interface AyaCompanionProps {
  mode: AyaMode;
  state: AyaState;
  sprite: string;
  bubble: string;
  reacting: boolean;
}

export const AyaCompanion: React.FC<AyaCompanionProps> = ({ mode, state, sprite, bubble, reacting }) => {
  const loadedRef = useRef<Set<string>>(new Set());
  const [terminalLine, setTerminalLine] = useState<string>(() => String(bubble || "").trim());

  const spriteSet = useMemo(() => {
    return mode === "signin" ? SIGNIN_SPRITES : ALL_SIGNUP_SPRITES;
  }, [mode]);

  const preloadSprite = (name: string): void => {
    const clean = String(name || "").trim();
    if (!clean || loadedRef.current.has(clean)) return;
    loadedRef.current.add(clean);
    const image = new Image();
    image.src = `/assets/aya/${clean}.png`;
  };

  useEffect(() => {
    preloadSprite(sprite);
    const rest = spriteSet.filter((item) => item !== sprite);
    
    // Use requestIdleCallback if available, otherwise setTimeout
    const loadRest = () => {
      rest.forEach(preloadSprite);
    };

    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(loadRest);
    } else {
      setTimeout(loadRest, 500);
    }
  }, [sprite, spriteSet]);

  useEffect(() => {
    const next = String(bubble || "").trim();
    if (!next) return;
    setTerminalLine(next);
  }, [bubble]);

  const ayaStateClass = state === "celebrating" ? "aya-celebrating" : reacting ? "aya-reacting" : "";

  return (
    <aside className={`aya-companion ${ayaStateClass}`}>
      <div className="aya-stage">
        <img
          src={`/assets/aya/${sprite}.png`}
          alt="Aya companion"
          className="pixel-art"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.src.endsWith("neutral.png")) {
              target.src = "/assets/aya/neutral.png";
            }
          }}
        />

        <div className="aya-bubble">
          {terminalLine || (mode === "signin" ? "Welcome back!" : "Welcome to HexNest.")}
        </div>
      </div>
    </aside>
  );
};
