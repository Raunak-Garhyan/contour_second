import { useEffect, useMemo, useRef, useState } from "react";

type Cursor = { x: number; y: number; tool?: string } | null;

interface OpponentMirrorProps {
  promptSrc?: string;
  opponentId: string | null;
  isSupported: boolean;
  opponentRound: number | null;
  opponentPreview: string | null;
  opponentStrokePoints: Array<[number, number]>;
  opponentCursor: Cursor;
  opponentCursorTrail: Array<[number, number]>;
  sessionId?: string | null;
  round: number;
  isVisible?: boolean;
}

const CANVAS_SIZE = 1024;
const VIEW_SIZE = 512;
const OFFSET = (CANVAS_SIZE - VIEW_SIZE) / 2;
const STORAGE_VERSION = 1;

function storageKey(sessionId: string | null | undefined, round: number) {
  if (!sessionId) return null;
  return `contour_mp_opponent_view:v${STORAGE_VERSION}:${sessionId}:round:${round}`;
}

export default function OpponentMirror({
  promptSrc,
  opponentId,
  isSupported,
  opponentRound,
  opponentPreview,
  opponentStrokePoints,
  opponentCursor,
  opponentCursorTrail,
  sessionId,
  round,
  isVisible = true,
}: OpponentMirrorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameRef = useRef<string | null>(null);
  const promptUnderlayRef = useRef<HTMLCanvasElement | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const [underlayRev, setUnderlayRev] = useState(0);

  const [persisted, setPersisted] = useState<{
    preview: string | null;
    strokePoints: Array<[number, number]>;
  } | null>(null);

  // Keep a monotonic local copy so the polyline never "jumps backwards"
  // if the upstream hook briefly reports a shorter array.
  const [stablePreview, setStablePreview] = useState<string | null>(null);
  const [stableStrokePoints, setStableStrokePoints] = useState<Array<[number, number]>>([]);

  const key = useMemo(() => storageKey(sessionId, round), [sessionId, round]);

  // Reset all states and clear the canvas cache on round change to prevent bleed-through.
  useEffect(() => {
    setPersisted(null);
    setStablePreview(null);
    setStableStrokePoints([]);
    lastFrameRef.current = null;
  }, [round]);

  // Load last known opponent state to avoid blanks/flicker on refresh.
  useEffect(() => {
    if (!key) {
      setPersisted(null);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setPersisted(null);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        setPersisted(null);
        return;
      }
      const preview = typeof parsed.preview === "string" ? parsed.preview : null;
      const pts = Array.isArray(parsed.strokePoints) ? parsed.strokePoints : [];
      setPersisted({ preview, strokePoints: pts });
    } catch {
      setPersisted(null);
    }
  }, [key]);

  // Persist the latest frame/points (best-effort).
  useEffect(() => {
    if (!key) return;
    const payload = {
      preview: opponentPreview,
      strokePoints: opponentStrokePoints,
      ts: Date.now(),
    };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [key, opponentPreview, opponentStrokePoints]);

  // Initialize stable state from persisted snapshot.
  useEffect(() => {
    if (!persisted) return;
    setStablePreview((prev) => prev ?? persisted.preview ?? null);
    setStableStrokePoints((prev) => (prev.length ? prev : persisted.strokePoints ?? []));
  }, [persisted]);

  // Updates from live stream.
  useEffect(() => {
    setStablePreview(opponentPreview);
  }, [opponentPreview]);

  useEffect(() => {
    setStableStrokePoints(opponentStrokePoints || []);
  }, [opponentStrokePoints]);

  const effectivePreview = stablePreview ?? persisted?.preview ?? null;
  const effectiveStrokePoints = stableStrokePoints.length ? stableStrokePoints : (persisted?.strokePoints ?? []);

  const cursorPx = useMemo(() => {
    if (!opponentCursor || opponentCursor.x < 0 || opponentCursor.y < 0) return null;
    return {
      x: opponentCursor.x * CANVAS_SIZE,
      y: opponentCursor.y * CANVAS_SIZE,
    };
  }, [opponentCursor]);

  // Draw prompt + latest opponent preview into a real canvas so the display is stable.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = (imgElement?: HTMLImageElement) => {
      ctx.save();
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Inverted prompt underlay (matches main "YOU" ghost sizing).
      if (promptUnderlayRef.current) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(promptUnderlayRef.current, OFFSET, OFFSET, VIEW_SIZE, VIEW_SIZE);
        ctx.globalAlpha = 1;
      }

      // Grid lines (same density as main view).
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= CANVAS_SIZE; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_SIZE);
        ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_SIZE; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_SIZE, y);
        ctx.stroke();
      }

      if (imgElement) {
        ctx.drawImage(imgElement, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }
      ctx.restore();
    };

    const nextFrame = effectivePreview;
    if (!nextFrame) {
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = requestAnimationFrame(() => render());
      lastFrameRef.current = null;
      return;
    }

    if (nextFrame === lastFrameRef.current) return;
    lastFrameRef.current = nextFrame;

    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = requestAnimationFrame(() => render(img));
    };
    img.src = nextFrame;

    return () => {
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
    };
  }, [effectivePreview, promptSrc, underlayRev, isVisible]);

  // Redraw when switching to opponent view.
  useEffect(() => {
    if (!isVisible) return;
    lastFrameRef.current = null;
    setUnderlayRev((v) => v + 1);
  }, [isVisible]);

  // Precompute an inverted prompt underlay once per prompt, like BezierCanvas does.
  useEffect(() => {
    if (!promptSrc) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const offscreen = document.createElement("canvas");
      offscreen.width = CANVAS_SIZE;
      offscreen.height = CANVAS_SIZE;
      const oCtx = offscreen.getContext("2d");
      if (!oCtx) return;
      oCtx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const imageData = oCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      oCtx.putImageData(imageData, 0, 0);

      // Store at full strength; opacity is applied at draw time so we can tune it.
      const underlay = document.createElement("canvas");
      underlay.width = CANVAS_SIZE;
      underlay.height = CANVAS_SIZE;
      const uCtx = underlay.getContext("2d");
      if (!uCtx) return;
      uCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      uCtx.globalAlpha = 1;
      uCtx.drawImage(offscreen, 0, 0);
      promptUnderlayRef.current = underlay;

      // Force a redraw next time we receive a frame.
      lastFrameRef.current = null;
      setUnderlayRev((v) => v + 1);
    };
    img.src = promptSrc;
  }, [promptSrc]);

  return (
    <div className="flex flex-col gap-0 w-full h-full border-4 border-white hard-shadow bg-black overflow-hidden select-none">
      {/* Shortcut Legend Bar — hide SHIFT/ALT groups on small screens */}
      <div className="bg-white text-black py-1.5 px-3 flex flex-wrap items-center justify-between border-b-4 border-white gap-2">
        <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest">
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">P</kbd>
            <span>Pen</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">V</kbd>
            <span>Select</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">DEL</kbd>
            <span>Delete_Node</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-black/60">
            <kbd className="px-1.5 py-0.5 border border-black/20 rounded-sm bg-transparent text-black font-mono">ESC</kbd>
            <span>Deselect</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-3 text-[9px] font-black uppercase tracking-widest border-l-2 border-black/10 pl-3">
          <div className="flex items-center gap-1.5 text-black/50">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">⌘Z</kbd>
            <span>Undo</span>
          </div>
          <div className="flex items-center gap-1.5 text-black/50">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">⇧⌘Z</kbd>
            <span>Redo</span>
          </div>
          <div className="flex items-center gap-1.5 text-black/50">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">SHIFT</kbd>
            <span>Snap_45°</span>
          </div>
          <div className="flex items-center gap-1.5 text-black/50">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">ALT</kbd>
            <span>Break_Handle</span>
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="h-10 border-b-4 border-white flex items-center px-3 gap-3 bg-black z-10 overflow-hidden">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-3 h-3 bg-white" />
          <span className="font-display font-black text-[10px] uppercase tracking-[0.15em] hidden xs:block">CTRL_PANEL</span>
        </div>
        <div className="h-6 w-px bg-white/20 hidden sm:block" />
        <div className="flex items-center gap-3 text-[10px] font-display font-bold uppercase tracking-widest text-white/60 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-white/40">TOOL:</span>
            <span className="text-white">PEN</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-white/40">ANCHORS:</span>
            <span className="text-white">{opponentId ? "LIVE" : 0}</span>
          </div>
        </div>
        <div className="flex-1" />
        {/* SHIFT/ALT/CMD badges – hidden on small screens */}
        <div className="hidden sm:flex items-center gap-1.5">
          <div className="px-2 py-0.5 border border-white/10 text-[9px] font-black text-white/20">SHIFT</div>
          <div className="px-2 py-0.5 border border-white/10 text-[9px] font-black text-white/20">ALT</div>
          <div className="px-2 py-0.5 border border-white/10 text-[9px] font-black text-white/20">CMD</div>
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — hidden on xs, shown from sm */}
        <div className="hidden sm:flex w-14 border-r-4 border-white flex-col items-center py-3 gap-3 bg-black shrink-0">
          <div className="w-9 h-9 flex items-center justify-center bg-white text-black">
            <span className="text-[14px]">✎</span>
          </div>
          <div className="w-9 h-9 flex items-center justify-center text-white border-2 border-transparent">
            <span className="text-[14px]">↖</span>
          </div>
          <div className="h-px w-7 bg-white/20 my-1" />
          <div className="w-9 h-9 flex items-center justify-center text-white/10">
            <span className="text-[14px]">↶</span>
          </div>
          <div className="w-9 h-9 flex items-center justify-center text-white/10">
            <span className="text-[14px]">↷</span>
          </div>
          <div className="flex-1" />
          <div className="w-9 h-9 flex items-center justify-center text-white/10 border-2 border-white/10 mb-1">
            <span className="text-[14px]">⌦</span>
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 bg-[#050505] relative overflow-hidden flex items-center justify-center p-3 sm:p-6">
          <div className="relative w-full h-full max-w-full flex items-center justify-center">
            <div className="relative" style={{ width: "min(100%, 100vh - 16rem)", aspectRatio: "1 / 1", maxHeight: "100%" }}>
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className="block w-full h-full bg-black outline-none"
              />
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet">
                {effectiveStrokePoints.length > 1 ? (
                  <polyline
                    fill="none"
                    stroke="white"
                    strokeWidth={0.004}
                    points={effectiveStrokePoints.map(([x, y]) => `${x},${y}`).join(" ")}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {opponentCursorTrail.length > 1 ? (
                  <polyline
                    fill="none"
                    stroke="white"
                    strokeOpacity={0.25}
                    strokeWidth={0.0025}
                    points={opponentCursorTrail.map(([x, y]) => `${x},${y}`).join(" ")}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
              {opponentCursor && opponentCursor.x >= 0 && opponentCursor.y >= 0 ? (
                <div
                  className="absolute w-3 h-3 rounded-full bg-white mix-blend-difference pointer-events-none"
                  style={{
                    left: `${opponentCursor.x * 100}%`,
                    top: `${opponentCursor.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              ) : null}
              {!opponentId ? (
                <div className="absolute inset-0 flex items-center justify-center text-white/60 font-display font-black uppercase tracking-[0.2em] text-xs px-6 text-center">
                  Waiting for opponent...
                </div>
              ) : null}
            </div>
          </div>
          <div className="absolute bottom-3 right-3 text-[9px] font-black text-white/20 uppercase tracking-widest">
            Zoom: 100% | Layer: 01
          </div>
        </div>

        {/* Right Properties Panel — hidden on mobile and tablet, shown only on lg+ */}
        <div className="hidden lg:flex w-44 border-l-4 border-white flex-col bg-black p-3 gap-4 shrink-0">
          <div className="space-y-3">
            <h3 className="font-display font-black text-[10px] uppercase tracking-widest border-b-2 border-white/10 pb-2">PROPERTIES</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-white/40 font-bold uppercase">WIDTH</span>
                <span className="text-[10px] font-mono text-white">{VIEW_SIZE}px</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-white/40 font-bold uppercase">HEIGHT</span>
                <span className="text-[10px] font-mono text-white">{VIEW_SIZE}px</span>
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <span className="text-[8px] text-white/40 font-bold uppercase tracking-widest">Status</span>
              <div className="space-y-1 text-[9px] font-bold text-white/60">
                <div className="flex justify-between"><span>CONNECTED</span> <span className="text-white bg-white/10 px-1 font-mono">{opponentId ? "YES" : "NO"}</span></div>
                <div className="flex justify-between"><span>ROUND</span> <span className="text-white bg-white/10 px-1 font-mono">{opponentRound ?? "--"}</span></div>
              </div>
            </div>
          </div>
          <div className="flex-1" />
          <div className="w-full py-3 bg-white text-black font-display font-black text-xs uppercase tracking-[0.2em] border-2 border-white opacity-20 flex items-center justify-center gap-2">
            <span>SUBMIT</span>
          </div>
        </div>
      </div>

      {/* Status Bar Footer */}
      <div className="h-7 border-t-4 border-white bg-black flex items-center px-3 justify-between text-[9px] font-bold text-white/40 uppercase tracking-[0.2em] overflow-hidden">
        <div className="flex items-center gap-4 min-w-0 overflow-hidden">
          <span className="truncate">{opponentId ? "Opponent screen mirrored live" : "Waiting for opponent"}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="hidden sm:block">
            X: {cursorPx ? cursorPx.x.toFixed(1) : "0.0"}&nbsp;&nbsp;Y: {cursorPx ? cursorPx.y.toFixed(1) : "0.0"}
          </span>
          <span className="text-white/20 hidden md:block">SYSTEM_READY_</span>
        </div>
      </div>
    </div>
  );
}
