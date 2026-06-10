import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadDisplay } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";

const { fontFamily: DISPLAY } = loadDisplay("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
});
const { fontFamily: SANS } = loadSans("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});
const MONO = "ui-monospace, Menlo, Consolas, 'Roboto Mono', monospace";

// ---------- palette ----------
const BG = "#141310";
const INK = "#efece3";
const RED = "#e0241b";
const MUTED = "#8d8a7e";
const PAD = 160;

// ---------- helpers ----------
const GLYPHS = "!<>-_\\/[]{}=+*^?#01ABCDEFX%";
const rand = (n: number) => {
  const x = Math.sin(n * 91.7) * 47853.6;
  return x - Math.floor(x);
};
const fmt = (v: number, dec: number) => {
  const parts = v.toFixed(dec).split(".");
  parts[0] = parseInt(parts[0], 10).toLocaleString("en-US");
  return parts.join(".");
};

const useEnvelope = (total: number, fadeIn = 9, fadeOut = 9) => {
  const frame = useCurrentFrame();
  return interpolate(
    frame,
    [0, fadeIn, total - fadeOut, total],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
};

const Scramble: React.FC<{
  text: string;
  start?: number;
  stagger?: number;
  lock?: number;
  color?: string;
}> = ({ text, start = 0, stagger = 1.5, lock = 9, color = INK }) => {
  const frame = useCurrentFrame();
  const f = frame - start;
  return (
    <>
      {text.split("").map((c, i) => {
        if (c === " ") return <span key={i}>{" "}</span>;
        const end = i * stagger + lock;
        if (f >= end) return <span key={i} style={{ color }}>{c}</span>;
        if (f < 0) return <span key={i} style={{ opacity: 0 }}>{c}</span>;
        const g = GLYPHS[Math.floor(rand(i * 3.7 + Math.floor(f) * 1.9) * GLYPHS.length)];
        return <span key={i} style={{ color: RED }}>{g}</span>;
      })}
    </>
  );
};

const CountUp: React.FC<{
  to: number;
  start: number;
  dur: number;
  dec?: number;
  suffix?: string;
}> = ({ to, start, dur, dec = 0, suffix = "" }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {fmt(to * p, dec)}
      {suffix}
    </span>
  );
};

const Cursor: React.FC<{ h?: number }> = ({ h = 58 }) => {
  const frame = useCurrentFrame();
  const on = frame % 30 < 16;
  return (
    <span
      style={{
        display: "inline-block",
        width: 16,
        height: h,
        background: RED,
        marginLeft: 12,
        opacity: on ? 1 : 0,
        verticalAlign: "-6px",
      }}
    />
  );
};

const Kicker: React.FC<{ children: React.ReactNode; start?: number }> = ({
  children,
  start = 0,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [start, start + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 22,
        letterSpacing: "0.26em",
        textTransform: "uppercase",
        color: MUTED,
        opacity: o,
      }}
    >
      {children}
    </div>
  );
};

// ---------- byte-map ----------
const ByteMap: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [start, start + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const sweepDur = 56;
  const left = interpolate(frame, [start + 8, start + 8 + sweepDur], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const sweepOp = interpolate(
    frame,
    [start + 8, start + 16, start + sweepDur, start + 8 + sweepDur],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const seg = (basis: string, bg: string, color: string, label: string) => (
    <div
      style={{
        flex: `0 0 ${basis}`,
        background: bg,
        color,
        borderRight: `1px solid ${INK}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: MONO,
        fontSize: 18,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      {label}
    </div>
  );
  return (
    <div style={{ opacity: reveal }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          height: 92,
          border: `1px solid ${INK}`,
          overflow: "hidden",
        }}
      >
        {seg("5%", INK, MUTED, "PE")}
        {seg(
          "79%",
          "repeating-linear-gradient(135deg, rgba(224,36,27,.24), rgba(224,36,27,.24) 11px, rgba(224,36,27,.46) 11px, rgba(224,36,27,.46) 22px)",
          INK,
          "Compressed payload   ·   entropy 8.00   ·   keycode sealed"
        )}
        <div
          style={{
            flex: "0 0 16%",
            background: "rgba(239,236,227,.07)",
            color: INK,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: MONO,
            fontSize: 18,
            textTransform: "uppercase",
          }}
        >
          Signature
        </div>
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${left}%`,
            width: 3,
            background: RED,
            boxShadow: "0 0 22px 3px rgba(224,36,27,.7)",
            opacity: sweepOp,
          }}
        />
      </div>
    </div>
  );
};

// ---------- scenes ----------
const SceneBoot: React.FC = () => {
  const o = useEnvelope(90);
  return (
    <AbsoluteFill
      style={{
        opacity: o,
        padding: PAD,
        justifyContent: "center",
        gap: 34,
      }}
    >
      <Kicker start={4}>Security engineering // field briefing</Kicker>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 280,
          letterSpacing: "-0.03em",
          lineHeight: 0.9,
          color: INK,
        }}
      >
        <Scramble text="EKO-II" start={10} stagger={4} lock={10} />
        <Cursor h={190} />
      </div>
      <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.14em", color: RED, opacity: interpolate(useCurrentFrame(), [34, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        WEBROOT  /  WHAT WE FOUND, WHAT WE BUILT
      </div>
    </AbsoluteFill>
  );
};

const SceneFound: React.FC = () => {
  const o = useEnvelope(120);
  return (
    <AbsoluteFill
      style={{ opacity: o, padding: PAD, justifyContent: "center", gap: 44 }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 150,
          letterSpacing: "-0.02em",
          lineHeight: 0.95,
          color: INK,
        }}
      >
        <Scramble text="What we found." start={8} stagger={1.6} />
      </div>
      <Kicker start={26}>Two signed files  ·  one hidden keycode</Kicker>
      <ByteMap start={30} />
    </AbsoluteFill>
  );
};

const Stat: React.FC<{
  children: React.ReactNode;
  cap: string;
  red?: boolean;
}> = ({ children, cap, red }) => (
  <div style={{ flex: 1 }}>
    <div
      style={{
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize: 116,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        color: red ? RED : INK,
      }}
    >
      {children}
    </div>
    <div
      style={{
        marginTop: 18,
        fontFamily: MONO,
        fontSize: 19,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: MUTED,
      }}
    >
      {cap}
    </div>
  </div>
);

const SceneData: React.FC = () => {
  const o = useEnvelope(120);
  return (
    <AbsoluteFill
      style={{ opacity: o, padding: PAD, justifyContent: "center", gap: 60 }}
    >
      <Kicker start={4}>The difference, in numbers</Kicker>
      <div
        style={{
          display: "flex",
          gap: 48,
          borderTop: `1px solid ${INK}`,
          paddingTop: 50,
        }}
      >
        <Stat cap="Size delta · bytes" red>
          <CountUp to={2592} start={10} dur={52} />
        </Stat>
        <Stat cap="Entropy · bits/byte" red>
          <CountUp to={8} start={10} dur={52} dec={2} />
        </Stat>
        <Stat cap="Of the body differs" red>
          <CountUp to={39.1} start={10} dur={52} dec={1} suffix="%" />
        </Stat>
        <Stat cap="Plaintext name hits">0</Stat>
      </div>
    </AbsoluteFill>
  );
};

const STEPS: [string, string, string][] = [
  ["01", "Detect", "Find the agent: registry, services, WRSA.exe"],
  ["02", "Discover", "Read the machine's own keycode by its shape"],
  ["03", "Uninstall", "Run the official WRSA.exe removal"],
  ["04", "Sweep", "Remove residual services, files, tasks"],
];

const SceneBuilt: React.FC = () => {
  const o = useEnvelope(120);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{ opacity: o, padding: PAD, justifyContent: "center", gap: 46 }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 150,
          letterSpacing: "-0.02em",
          lineHeight: 0.95,
          color: INK,
        }}
      >
        <Scramble text="What we built." start={8} stagger={1.6} />
      </div>
      <div style={{ borderTop: `1px solid ${INK}` }}>
        {STEPS.map(([n, name, desc], i) => {
          const s = spring({
            frame: frame - (38 + i * 9),
            fps,
            config: { damping: 200 },
          });
          const x = interpolate(s, [0, 1], [44, 0]);
          return (
            <div
              key={n}
              style={{
                opacity: s,
                transform: `translateX(${x}px)`,
                display: "flex",
                alignItems: "baseline",
                gap: 30,
                padding: "22px 0",
                borderBottom: "1px solid rgba(239,236,227,.16)",
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 24,
                  color: RED,
                  fontWeight: 600,
                  width: 56,
                }}
              >
                {n}
              </span>
              <span
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 500,
                  fontSize: 46,
                  color: INK,
                  width: 320,
                }}
              >
                {name}
              </span>
              <span style={{ fontFamily: SANS, fontSize: 28, color: MUTED }}>
                {desc}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const SceneVerdict: React.FC = () => {
  const o = useEnvelope(90);
  const frame = useCurrentFrame();
  const signOff = interpolate(frame, [46, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line = (label: string, verdict: string, start: number) => (
    <div
      style={{
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize: 92,
        letterSpacing: "-0.02em",
        lineHeight: 1.12,
        color: INK,
      }}
    >
      {label}{" "}
      <span style={{ color: RED }}>
        <Scramble text={verdict} start={start} stagger={2} lock={8} color={RED} />
      </span>
    </div>
  );
  return (
    <AbsoluteFill
      style={{ opacity: o, padding: PAD, justifyContent: "center", gap: 18 }}
    >
      {line("Keycode-agnostic wrapper:", "yes.", 8)}
      {line("Crack the signed binary:", "no.", 20)}
      <div
        style={{
          marginTop: 56,
          opacity: signOff,
          fontFamily: MONO,
          fontSize: 22,
          letterSpacing: "0.1em",
          color: MUTED,
          borderTop: `1px solid rgba(239,236,227,.18)`,
          paddingTop: 26,
        }}
      >
        EKO-II  ·  Remove-Webroot.ps1  ·  Webroot SecureAnywhere 1.13.0.9  ·  2026.06.10
      </div>
    </AbsoluteFill>
  );
};

// ---------- persistent HUD + background ----------
const Bg: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: BG,
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(239,236,227,.022) 0px, rgba(239,236,227,.022) 1px, transparent 1px, transparent 64px), repeating-linear-gradient(90deg, rgba(239,236,227,.022) 0px, rgba(239,236,227,.022) 1px, transparent 1px, transparent 64px)",
    }}
  />
);

const Hud: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const secs = Math.floor(frame / fps);
  const tc = `00:${String(secs).padStart(2, "0")}`;
  const prog = interpolate(frame, [0, durationInFrames], [0, 100]);
  const corner: React.CSSProperties = {
    position: "absolute",
    fontFamily: MONO,
    fontSize: 18,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: MUTED,
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: RED }} />
      <div style={{ ...corner, top: 42, left: 56 }}>EKO-II</div>
      <div style={{ ...corner, top: 42, right: 56, color: RED }}>● REC</div>
      <div style={{ ...corner, bottom: 40, left: 56 }}>{tc}</div>
      <div style={{ ...corner, bottom: 40, right: 56 }}>127.0.0.1</div>
      <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: `${prog}%`, background: RED, opacity: 0.5 }} />
    </AbsoluteFill>
  );
};

// ---------- main ----------
export const Intro: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS }}>
      <Bg />
      <Sequence durationInFrames={90}>
        <SceneBoot />
      </Sequence>
      <Sequence from={90} durationInFrames={120}>
        <SceneFound />
      </Sequence>
      <Sequence from={210} durationInFrames={120}>
        <SceneData />
      </Sequence>
      <Sequence from={330} durationInFrames={120}>
        <SceneBuilt />
      </Sequence>
      <Sequence from={450} durationInFrames={90}>
        <SceneVerdict />
      </Sequence>
      <Hud />
    </AbsoluteFill>
  );
};
