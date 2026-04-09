import { useEffect, useRef, useState } from "react";

export type AyaState =
  | "idle"
  | "watching"
  | "curious"
  | "encouraging"
  | "validating"
  | "pleased"
  | "excited"
  | "peek"
  | "match"
  | "ready"
  | "hover_submit"
  | "error"
  | "angry"
  | "celebrating";

type AyaMode = "signup" | "signin";

const SPRITE_BY_STATE: Record<AyaState, string> = {
  idle: "neutral",
  watching: "calm",
  curious: "thinking",
  encouraging: "smile",
  validating: "wink_right",
  pleased: "happy",
  excited: "laughing",
  peek: "wink_left",
  match: "wink_right",
  ready: "love_shy",
  hover_submit: "smirk",
  error: "frustrated",
  angry: "angry",
  celebrating: "happy"
};

function defaultBubble(mode: AyaMode): string {
  return mode === "signin" ? "Welcome back!" : "Welcome to HexNest.";
}

export function useAyaState(mode: AyaMode) {
  const [state, setState] = useState<AyaState>("idle");
  const [bubble, setBubble] = useState<string>(defaultBubble(mode));
  const [reacting, setReacting] = useState<boolean>(false);
  const bubbleTimerRef = useRef<any | null>(null);
  const transientTimerRef = useRef<any | null>(null);
  const allFieldsValidRef = useRef<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setState("watching");
      setBubble(mode === "signin" ? "Good to see you again." : "Let's connect your node.");
    }, 2000);
    return () => clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => {
      setBubble("");
      bubbleTimerRef.current = null;
    }, 3000);
    return () => {
      if (bubbleTimerRef.current) {
        clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
    };
  }, [bubble]);

  useEffect(() => {
    setReacting(true);
    const timer = setTimeout(() => setReacting(false), 300);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    return () => {
      if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    };
  }, []);

  function transition(next: AyaState, speech?: string, transientMs?: number): void {
    if (transientTimerRef.current) {
      clearTimeout(transientTimerRef.current);
      transientTimerRef.current = null;
    }
    setState(next);
    if (speech) {
      setBubble(speech);
    }
    if (transientMs && transientMs > 0) {
      transientTimerRef.current = setTimeout(() => {
        setState(allFieldsValidRef.current ? "ready" : "watching");
        transientTimerRef.current = null;
      }, transientMs);
    }
  }

  function onFocus(field: "name" | "email" | "password" | "confirm" | "nodeName"): void {
    if (mode === "signin") {
      if (field === "email") {
        transition("validating", "Identity check online.");
        return;
      }
      if (field === "password") {
        transition("peek", "Secure channel. Enter your key.");
        return;
      }
      transition("curious", "Sign in to your swarm.");
      return;
    }

    if (field === "name") {
      transition("encouraging", "What should I call you?");
      return;
    }
    if (field === "email") {
      transition("validating", "Routing your identity node.");
      return;
    }
    if (field === "password") {
      transition("curious", "Forge a strong access key.");
      return;
    }
    if (field === "nodeName") {
      transition("curious", "How should we address this node?");
      return;
    }
    transition("peek", "Confirm it. No mismatches.");
  }

  function onEmailValidation(isValid: boolean): void {
    if (isValid) {
      transition("pleased", "Got it.");
      return;
    }
    transition("error", "Check that email.");
  }

  function onNameValidation(name: string): void {
    const value = String(name || "").trim();
    if (!value) {
      transition("watching");
      return;
    }
    transition("pleased", `Nice to meet you, ${value}!`);
  }

  function onPasswordStrength(strength: "weak" | "medium" | "strong"): void {
    if (strength === "strong") {
      transition("excited", "Now that's a password.");
      return;
    }
    if (strength === "medium") {
      transition("encouraging", "Getting there.");
      return;
    }
    transition("watching", "A bit short...");
  }

  function onPasswordToggle(): void {
    transition("peek", "Yep, that's your password.", 500);
  }

  function onConfirmMatch(matches: boolean): void {
    if (matches) {
      transition("match", "Perfect match.");
      return;
    }
    transition("error", "Doesn't match yet.");
  }

  function onAllFieldsValid(isValid: boolean): void {
    allFieldsValidRef.current = isValid;
    if (isValid) {
      transition("ready", "Ready when you are.");
      return;
    }
    if (state === "ready") {
      transition("watching");
    }
  }

  function onSubmitHover(): void {
    transition("hover_submit", "Let's go.");
  }

  function onSubmitLeave(): void {
    transition(allFieldsValidRef.current ? "ready" : "watching");
  }

  function onSubmitSuccess(): void {
    transition("celebrating", mode === "signin" ? "Welcome back!" : "Welcome to the hive.");
  }

  function onSubmitError(failures: number): void {
    if (failures >= 3) {
      transition("angry", "Something is wrong. Try again carefully.");
      return;
    }
    transition("error", "Oops, let's try again.");
  }

  return {
    state,
    sprite: SPRITE_BY_STATE[state],
    bubble,
    reacting,
    onFocus,
    onEmailValidation,
    onNameValidation,
    onPasswordStrength,
    onPasswordToggle,
    onConfirmMatch,
    onAllFieldsValid,
    onSubmitHover,
    onSubmitLeave,
    onSubmitSuccess,
    onSubmitError
  };
}
