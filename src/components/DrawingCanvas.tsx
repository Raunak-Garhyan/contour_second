import { useRef, useEffect, useCallback, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/gameContext";
import { playClick, playClear } from "@/lib/sounds";
import {
  Pencil,
  Circle,
  Square,
  Minus,
  Trash2,
  Send,
} from "lucide-react";

interface DrawingCanvasProps {
  onSubmit: (dataUrl: string) => void;
  timeLeft: number;
}

type DrawTool = "free" | "line" | "circle" | "rect";

const CANVAS_SIZE = 512;

export default function DrawingCanvas({ onSubmit, timeLeft }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [activeTool, setActiveTool] = useState<DrawTool>("free");
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const { soundEnabled } = useGame();

  // Save main canvas state for shape preview
  const savedImageData = useRef<ImageData | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0A0A0A";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }, []);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const pos = getPos(e);
    startPos.current = pos;
    setHasDrawn(true);

    if (activeTool === "free") {
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    } else {
      // Save current canvas state for live preview
      const ctx = canvasRef.current!.getContext("2d")!;
      savedImageData.current = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
  }, [getPos, activeTool]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const pos = getPos(e);

    if (activeTool === "free") {
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (startPos.current && savedImageData.current) {
      // Live shape preview on main canvas
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.putImageData(savedImageData.current, 0, 0);
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const sx = startPos.current.x;
      const sy = startPos.current.y;

      ctx.beginPath();
      if (activeTool === "line") {
        ctx.moveTo(sx, sy);
        ctx.lineTo(pos.x, pos.y);
      } else if (activeTool === "circle") {
        const rx = Math.abs(pos.x - sx) / 2;
        const ry = Math.abs(pos.y - sy) / 2;
        const cx = (sx + pos.x) / 2;
        const cy = (sy + pos.y) / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      } else if (activeTool === "rect") {
        ctx.rect(sx, sy, pos.x - sx, pos.y - sy);
      }
      ctx.stroke();
    }
  }, [getPos, activeTool]);

  const endDraw = useCallback(() => {
    isDrawing.current = false;
    startPos.current = null;
    savedImageData.current = null;
  }, []);

  const clearCanvas = useCallback(() => {
    if (soundEnabled) playClear();
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.fillStyle = "#0A0A0A";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    setHasDrawn(false);
  }, [soundEnabled]);

  const handleSubmit = useCallback(() => {
    const dataUrl = canvasRef.current!.toDataURL("image/png");
    onSubmit(dataUrl);
  }, [onSubmit]);

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft <= 0) {
      handleSubmit();
    }
  }, [timeLeft, handleSubmit]);

  const tools: { id: DrawTool; icon: React.ReactNode; label: string }[] = [
    { id: "free", icon: <Pencil size={16} />, label: "Freestyle" },
    { id: "line", icon: <Minus size={16} />, label: "Line" },
    { id: "circle", icon: <Circle size={16} />, label: "Circle" },
    { id: "rect", icon: <Square size={16} />, label: "Rectangle" },
  ];

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Tool bar */}
      <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: "hsl(var(--card))" }}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              if (soundEnabled) playClick();
              setActiveTool(tool.id);
            }}
            className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
              activeTool === tool.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-card-foreground"
            }`}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        className="w-full max-w-[512px] aspect-square rounded-lg border border-border cursor-crosshair touch-none"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      <div className="flex gap-3 w-full max-w-[512px]">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={clearCanvas}
          className="flex-1 py-3 rounded-lg border border-border font-body text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-2"
        >
          <Trash2 size={14} />
          Clear
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleSubmit}
          disabled={!hasDrawn}
          className="flex-1 py-3 rounded-lg bg-primary font-body text-sm text-primary-foreground font-semibold disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
        >
          <Send size={14} />
          Submit
        </motion.button>
      </div>
    </div>
  );
}
