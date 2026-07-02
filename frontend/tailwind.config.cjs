/** @type {import('tailwindcss').Config} */
module.exports = {
  corePlugins: {
    preflight: false
  },
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    screens: {
      xs: "480px",
      sm: "768px",
      md: "1024px",
      lg: "1280px",
      xl: "1440px"
    },
    extend: {
      colors: {
        hex: {
          void: "var(--bg-void)",
          panel: "var(--bg-panel)",
          panelDeep: "var(--bg-panel-deep)",
          glass: "var(--border-glass)",
          glassHot: "var(--border-glass-hot)",
          cyan: "var(--accent-cyan)",
          cyanGlow: "var(--accent-cyan-glow)",
          red: "var(--warn-red)",
          amber: "var(--status-amber)",
          text: "var(--text-primary)",
          dim: "var(--text-dim)",
          mute: "var(--text-mute)"
        }
      },
      keyframes: {
        "aya-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" }
        },
        "aya-react": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)" }
        },
        "aya-celebrate": {
          "0%": { transform: "translateY(0) rotate(0deg)" },
          "25%": { transform: "translateY(-11px) rotate(-3deg)" },
          "50%": { transform: "translateY(-4px) rotate(2deg)" },
          "75%": { transform: "translateY(-8px) rotate(-1deg)" },
          "100%": { transform: "translateY(0) rotate(0deg)" }
        },
        "crt-flicker": {
          "0%, 100%": { opacity: "0.9" },
          "7%": { opacity: "0.88" },
          "10%": { opacity: "0.94" },
          "17%": { opacity: "0.86" },
          "22%": { opacity: "0.92" },
          "29%": { opacity: "0.89" },
          "35%": { opacity: "0.95" },
          "47%": { opacity: "0.9" },
          "53%": { opacity: "0.87" },
          "62%": { opacity: "0.93" },
          "71%": { opacity: "0.9" },
          "78%": { opacity: "0.94" },
          "86%": { opacity: "0.88" },
          "93%": { opacity: "0.92" }
        },
        "terminal-glow": {
          "0%, 100%": { textShadow: "0 0 8px rgba(74, 217, 255, 0.75), 0 0 2px rgba(74, 217, 255, 0.7)" },
          "50%": { textShadow: "0 0 12px rgba(74, 217, 255, 0.95), 0 0 3px rgba(74, 217, 255, 0.85)" }
        }
      },
      animation: {
        "aya-float": "aya-float 3s ease-in-out infinite",
        "aya-react": "aya-react 0.3s ease-out",
        "aya-celebrate": "aya-celebrate 0.75s ease-in-out",
        "crt-flicker": "crt-flicker 7.2s steps(20, end) infinite",
        "terminal-glow": "terminal-glow 2.8s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
