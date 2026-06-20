import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/gameContext";
import { playClick, playClear } from "@/lib/sounds";
import { Undo2, Redo2, Trash2, Send, MousePointer2, Pen } from "lucide-react";

interface BezierCanvasProps {
  onSubmit: (dataUrl: string) => void;
  timeLeft: number;
  ghostImageSrc?: string;
  onLivePreview?: (dataUrl: string) => void;
  onCursorMove?: (x: number, y: number, tool?: string) => void;
  onStrokePoint?: (x: number, y: number) => void;
  persistKey?: string;
  isVisible?: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface BezierNode {
  pos: Point;
  handleIn: Point;  // relative to pos
  handleOut: Point;  // relative to pos
}

type Tool = "pen" | "select";
type DragTarget =
  | { type: "node"; index: number }
  | { type: "handleIn"; index: number }
  | { type: "handleOut"; index: number }
  | null;

const CANVAS_SIZE = 1024;
const VIEW_SIZE = 512; // The core zone for scoring
const OFFSET = (CANVAS_SIZE - VIEW_SIZE) / 2;
const NODE_RADIUS = 5;
const HANDLE_RADIUS = 4;
const HIT_RADIUS = 10;

function dist(a: Point, b: Point) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function snapPoint(p: Point, origin: Point): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const angle = Math.atan2(dy, dx);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: origin.x + Math.cos(snappedAngle) * distance,
    y: origin.y + Math.sin(snappedAngle) * distance,
  };
}

export default function BezierCanvas({ onSubmit, timeLeft, ghostImageSrc, onLivePreview, onCursorMove, onStrokePoint, persistKey, isVisible = true }: BezierCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<BezierNode[]>([]);
  const [history, setHistory] = useState<BezierNode[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [activeTool, setActiveTool] = useState<Tool>("pen");
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  // Keyboard states
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isMetaPressed, setIsMetaPressed] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState<number[]>([]);

  const [ghostReady, setGhostReady] = useState(false);
  // Snapshot of the path taken the moment a drag starts; used to render a
  // semi-transparent "before" ghost so users can see the curve delta live.
  const dragStartNodesRef = useRef<BezierNode[] | null>(null);
  const { soundEnabled } = useGame();

  const invertedGhostImg = useRef<HTMLCanvasElement | null>(null);
  const livePreviewTimeoutRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<number | null>(null);
  const isPointerDownRef = useRef(false);
  const submittedRef = useRef(false);

  // Restore persisted nodes (multiplayer refresh resiliency).
  useEffect(() => {
    if (!persistKey) return;
    try {
      const raw = localStorage.getItem(persistKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setNodes(parsed);
      setHistory([parsed]);
      setHistoryIndex(0);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey]);

  // Persist nodes as you draw.
  useEffect(() => {
    if (!persistKey) return;
    if (persistTimeoutRef.current) window.clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(persistKey, JSON.stringify(nodes));
      } catch {
        // ignore
      }
    }, 200);
    return () => {
      if (persistTimeoutRef.current) window.clearTimeout(persistTimeoutRef.current);
    };
  }, [nodes, persistKey]);

  // Load ghost image
  useEffect(() => {
    if (!ghostImageSrc) {
      invertedGhostImg.current = null;
      setGhostReady(false);
      return;
    }
    setGhostReady(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const offscreen = document.createElement("canvas");
      offscreen.width = CANVAS_SIZE;
      offscreen.height = CANVAS_SIZE;
      const oCtx = offscreen.getContext("2d")!;
      oCtx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

      const imageData = oCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      oCtx.putImageData(imageData, 0, 0);
      invertedGhostImg.current = offscreen;
      setGhostReady(true);
    };
    img.src = ghostImageSrc;
  }, [ghostImageSrc]);

  const pushHistory = useCallback((newNodes: BezierNode[]) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, JSON.parse(JSON.stringify(newNodes))];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    if (soundEnabled) playClick();
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    const restored = JSON.parse(JSON.stringify(history[newIndex]));
    setNodes(restored);
  }, [historyIndex, history, soundEnabled]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    if (soundEnabled) playClick();
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    const restored = JSON.parse(JSON.stringify(history[newIndex]));
    setNodes(restored);
  }, [historyIndex, history, soundEnabled]);

  const clearCanvas = useCallback(() => {
    if (soundEnabled) playClear();
    const empty: BezierNode[] = [];
    setNodes(empty);
    setSelectedNodes([]);
    pushHistory(empty);
  }, [soundEnabled, pushHistory]);

  const deleteSelectedNode = useCallback(() => {
    if (selectedNodes.length === 0) return;
    if (soundEnabled) playClick();
    const updated = nodes.filter((_, i) => !selectedNodes.includes(i));
    setNodes(updated);
    setSelectedNodes([]);
    pushHistory(updated);
  }, [selectedNodes, nodes, soundEnabled, pushHistory]);

  // Keyboard listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey) setIsShiftPressed(true);
      if (e.altKey) setIsAltPressed(true);
      if (e.metaKey || e.ctrlKey) setIsMetaPressed(true);

      const isCmd = e.metaKey || e.ctrlKey;
      
      // Tool Shortcuts
      if (!isCmd) {
        if (e.key.toLowerCase() === "p") setActiveTool("pen");
        if (e.key.toLowerCase() === "v" || e.key.toLowerCase() === "a") setActiveTool("select");
        if (e.key === "Backspace" || e.key === "Delete") {
          deleteSelectedNode();
          e.preventDefault();
        }
        if (e.key === "Escape") setSelectedNodes([]);
      }

      // History Shortcuts
      if (isCmd && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        e.preventDefault();
      } else if (isCmd && e.key.toLowerCase() === "x") {
        clearCanvas();
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.shiftKey) setIsShiftPressed(false);
      if (!e.altKey) setIsAltPressed(false);
      if (!e.metaKey && !e.ctrlKey) setIsMetaPressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    const handleBlur = () => {
      setIsShiftPressed(false);
      setIsAltPressed(false);
      setIsMetaPressed(false);
    };
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [undo, redo, clearCanvas, deleteSelectedNode]);

  const getPos = useCallback((e: React.PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const findHit = useCallback((pos: Point, currentNodes: BezierNode[]): DragTarget | { type: "segment", index: number } | null => {
    for (let i = currentNodes.length - 1; i >= 0; i--) {
      const n = currentNodes[i];
      const hIn = { x: n.pos.x + n.handleIn.x, y: n.pos.y + n.handleIn.y };
      const hOut = { x: n.pos.x + n.handleOut.x, y: n.pos.y + n.handleOut.y };
      
      // If node is selected, prioritize handles (even if zero)
      const isNodeSelected = selectedNodes.includes(i);
      if (isNodeSelected || activeTool === "pen") {
        if (dist(pos, hOut) < HIT_RADIUS) return { type: "handleOut", index: i };
        if (dist(pos, hIn) < HIT_RADIUS) return { type: "handleIn", index: i };
      }

      if (dist(pos, hOut) < HIT_RADIUS && (n.handleOut.x !== 0 || n.handleOut.y !== 0)) {
        return { type: "handleOut", index: i };
      }
      if (dist(pos, hIn) < HIT_RADIUS && (n.handleIn.x !== 0 || n.handleIn.y !== 0)) {
        return { type: "handleIn", index: i };
      }
      if (dist(pos, n.pos) < HIT_RADIUS) {
        return { type: "node", index: i };
      }
    }

    // Segment hit detection
    if (currentNodes.length > 1) {
      for (let i = 1; i < currentNodes.length; i++) {
        const p0 = currentNodes[i-1].pos;
        const p1 = { x: p0.x + currentNodes[i-1].handleOut.x, y: p0.y + currentNodes[i-1].handleOut.y };
        const p2 = { x: currentNodes[i].pos.x + currentNodes[i].handleIn.x, y: currentNodes[i].pos.y + currentNodes[i].handleIn.y };
        const p3 = currentNodes[i].pos;

        // Check 20 points along the curve
        for (let t = 0; t <= 1; t += 0.05) {
          const cx = Math.pow(1 - t, 3) * p0.x + 3 * Math.pow(1 - t, 2) * t * p1.x + 3 * (1 - t) * Math.pow(t, 2) * p2.x + Math.pow(t, 3) * p3.x;
          const cy = Math.pow(1 - t, 3) * p0.y + 3 * Math.pow(1 - t, 2) * t * p1.y + 3 * (1 - t) * Math.pow(t, 2) * p2.y + Math.pow(t, 3) * p3.y;
          if (dist(pos, { x: cx, y: cy }) < HIT_RADIUS) {
            return { type: "segment", index: i }; // index refers to the segment leading to i
          }
        }
      }
    }

    return null;
  }, []);

  const renderCanvas = useCallback((
    currentNodes: BezierNode[],
    currentSelectedNodes: number[],
    currentHoveredNode: number | null,
    previewPos: Point | null = null,
    currentActiveTool: Tool = "pen",
    dragGhostNodes: BezierNode[] | null = null,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Ghost image (Inverted outline) - Centered
    if (invertedGhostImg.current) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(invertedGhostImg.current, OFFSET, OFFSET, VIEW_SIZE, VIEW_SIZE);
      ctx.globalAlpha = 1;
    }

    // Grid lines - Illustrator style large pixels
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

    if (currentNodes.length === 0) return;

    // ── Drag Ghost ──────────────────────────────────────────────────────────
    // Original path snapshot drawn before the live curve so the user can see
    // the before/after delta while dragging any node or tangent handle.
    if (dragGhostNodes && dragGhostNodes.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(dragGhostNodes[0].pos.x, dragGhostNodes[0].pos.y);
      for (let i = 1; i < dragGhostNodes.length; i++) {
        const prev = dragGhostNodes[i - 1];
        const curr = dragGhostNodes[i];
        ctx.bezierCurveTo(
          prev.pos.x + prev.handleOut.x,
          prev.pos.y + prev.handleOut.y,
          curr.pos.x + curr.handleIn.x,
          curr.pos.y + curr.handleIn.y,
          curr.pos.x,
          curr.pos.y,
        );
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw curves
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2; 
    ctx.lineCap = "square";
    ctx.lineJoin = "miter";

    ctx.beginPath();
    ctx.moveTo(currentNodes[0].pos.x, currentNodes[0].pos.y);

    for (let i = 1; i < currentNodes.length; i++) {
      const prev = currentNodes[i - 1];
      const curr = currentNodes[i];
      ctx.bezierCurveTo(
        prev.pos.x + prev.handleOut.x, 
        prev.pos.y + prev.handleOut.y, 
        curr.pos.x + curr.handleIn.x, 
        curr.pos.y + curr.handleIn.y, 
        curr.pos.x, 
        curr.pos.y
      );
    }
    ctx.stroke();

    if (currentActiveTool === "select" || currentActiveTool === "pen") {
      // Draw handles and nodes
      for (let i = 0; i < currentNodes.length; i++) {
        const n = currentNodes[i];
        const isSelected = currentSelectedNodes.includes(i);
        const hIn = { x: n.pos.x + n.handleIn.x, y: n.pos.y + n.handleIn.y };
        const hOut = { x: n.pos.x + n.handleOut.x, y: n.pos.y + n.handleOut.y };

        // Handle lines - only if node is selected or hovered
        const isHovered = currentHoveredNode === i;
        const hasHandleIn = n.handleIn.x !== 0 || n.handleIn.y !== 0;
        const hasHandleOut = n.handleOut.x !== 0 || n.handleOut.y !== 0;

        if (isSelected || isHovered) {
          // If EITHER handle exists, show BOTH side tangents (method.ac style)
          if (hasHandleIn || hasHandleOut) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";

            // Draw two separate lines meeting at the anchor center
            // Line to In-handle
            ctx.beginPath();
            ctx.moveTo(n.pos.x, n.pos.y);
            ctx.lineTo(hIn.x, hIn.y);
            ctx.stroke();

            // Line to Out-handle
            ctx.beginPath();
            ctx.moveTo(n.pos.x, n.pos.y);
            ctx.lineTo(hOut.x, hOut.y);
            ctx.stroke();

            // Handle CIRCLES
            ctx.fillStyle = "#000000";
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.2;
            
            // In Handle
            ctx.beginPath();
            ctx.arc(hIn.x, hIn.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Out Handle
            ctx.beginPath();
            ctx.arc(hOut.x, hOut.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }

        // Node square - Anchor points
        ctx.fillStyle = isSelected ? "#ffffff" : "#000000";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(n.pos.x - 4, n.pos.y - 4, 8, 8);
        ctx.fillRect(n.pos.x - 4, n.pos.y - 4, 8, 8);
        
        // Highlight for selected
        if (isSelected) {
          ctx.strokeStyle = "rgba(255,255,255,0.4)";
          ctx.lineWidth = 1;
          ctx.strokeRect(n.pos.x - 8, n.pos.y - 8, 16, 16);
        }
      }
    }

    // ── Curve Preview ──────────────────────────────────────────────────────
    // Shown in pen mode while hovering (no drag active) with ≥1 existing node
    if (currentActiveTool === "pen" && previewPos && currentNodes.length > 0) {
      const lastNode = currentNodes[currentNodes.length - 1];
      const hasHandleOut =
        lastNode.handleOut.x !== 0 || lastNode.handleOut.y !== 0;

      ctx.save();

      // ── Dashed preview bezier from last anchor → cursor ──────────────────
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastNode.pos.x, lastNode.pos.y);
      // CP1: outgoing tangent of last node; CP2: cursor itself (zero incoming handle)
      ctx.bezierCurveTo(
        lastNode.pos.x + lastNode.handleOut.x,
        lastNode.pos.y + lastNode.handleOut.y,
        previewPos.x,
        previewPos.y,
        previewPos.x,
        previewPos.y,
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Ghost anchor square at cursor ─────────────────────────────────────
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(previewPos.x - 4, previewPos.y - 4, 8, 8);
      ctx.strokeRect(previewPos.x - 4, previewPos.y - 4, 8, 8);

      // ── Outgoing tangent direction indicator at cursor ────────────────────
      // Shows the mirrored incoming handle the user would get with smooth continuity
      if (hasHandleOut) {
        const hOut = {
          x: lastNode.pos.x + lastNode.handleOut.x,
          y: lastNode.pos.y + lastNode.handleOut.y,
        };
        // Direction of the curve as it arrives at the cursor
        const arrivalDx = previewPos.x - hOut.x;
        const arrivalDy = previewPos.y - hOut.y;
        const arrivalLen = Math.sqrt(arrivalDx * arrivalDx + arrivalDy * arrivalDy);
        if (arrivalLen > 0) {
          // Continuation handle: same direction, scaled to ~30% of the outgoing handle length
          const handleLen =
            Math.sqrt(lastNode.handleOut.x ** 2 + lastNode.handleOut.y ** 2) * 0.4;
          const nx = (arrivalDx / arrivalLen) * handleLen;
          const ny = (arrivalDy / arrivalLen) * handleLen;
          const tipX = previewPos.x + nx;
          const tipY = previewPos.y + ny;

          // Faint dashed line showing continuation direction
          ctx.globalAlpha = 0.28;
          ctx.lineWidth = 1;
          ctx.strokeStyle = "#ffffff";
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(previewPos.x, previewPos.y);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Tiny handle circle at tip
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── Close-path hint ─────────────────────────────────────────────────
      // With 2+ nodes, show a faint dashed segment from the last anchor back
      // to the first anchor so the user can see how the path would close.
      // Brightens and adds a ring when the cursor is near the first node.
      if (currentNodes.length >= 2) {
        const firstNode = currentNodes[0];
        const lastNodeForClose = currentNodes[currentNodes.length - 1];
        const isNearFirst = dist(previewPos, firstNode.pos) < HIT_RADIUS * 3;

        ctx.globalAlpha = isNearFirst ? 0.5 : 0.18;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(lastNodeForClose.pos.x, lastNodeForClose.pos.y);
        ctx.bezierCurveTo(
          lastNodeForClose.pos.x + lastNodeForClose.handleOut.x,
          lastNodeForClose.pos.y + lastNodeForClose.handleOut.y,
          firstNode.pos.x + firstNode.handleIn.x,
          firstNode.pos.y + firstNode.handleIn.y,
          firstNode.pos.x,
          firstNode.pos.y,
        );
        ctx.stroke();
        ctx.setLineDash([]);

        // Ring glow on first node to signal "click to close"
        if (isNearFirst) {
          ctx.globalAlpha = 0.65;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(firstNode.pos.x, firstNode.pos.y, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }, []);

  // Re-render when nodes, selection, cursor preview, active tool, or visibility changes.
  useEffect(() => {
    renderCanvas(nodes, selectedNodes, hoveredNode, cursorPos, activeTool, dragStartNodesRef.current);
  }, [nodes, selectedNodes, hoveredNode, cursorPos, activeTool, ghostReady, isVisible, renderCanvas]);

  // Redraw when switching back from opponent view (canvas may have missed a paint while hidden).
  useEffect(() => {
    if (!isVisible) return;
    const id = requestAnimationFrame(() => {
      renderCanvas(nodes, selectedNodes, hoveredNode, cursorPos, activeTool, dragStartNodesRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [isVisible, nodes, selectedNodes, hoveredNode, cursorPos, activeTool, renderCanvas]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;
    const pos = getPos(e);
    // Clear the hover preview as soon as a click begins
    setCursorPos(null);

    const hit = findHit(pos, nodes);
    if (activeTool === "select") {
      if (hit) {
        if (hit.type === "segment") {
          setSelectedNodes([hit.index - 1, hit.index]);
          setDragTarget(null);
        } else {
          // Capture pre-drag snapshot for ghost rendering
          dragStartNodesRef.current = JSON.parse(JSON.stringify(nodes));
          setSelectedNodes([hit.index]);
          setDragTarget(hit);
        }
      } else {
        setSelectedNodes([]);
      }
      return;
    }

    // Pen tool
    if (hit) {
      if (hit.type === "node") {
        // Capture pre-drag snapshot for ghost rendering
        dragStartNodesRef.current = JSON.parse(JSON.stringify(nodes));
        setSelectedNodes([hit.index]);
        setDragTarget(hit);
        return;
      }
      if (hit.type === "segment") {
        setSelectedNodes([hit.index - 1, hit.index]);
        setDragTarget(null);
        return;
      }
      // Handle hit — capture snapshot
      dragStartNodesRef.current = JSON.parse(JSON.stringify(nodes));
    }

    // Add new node
    const newNode: BezierNode = {
      pos: { x: pos.x, y: pos.y },
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setSelectedNodes([newNodes.length - 1]);
    setDragTarget({ type: "handleOut", index: newNodes.length - 1 });
  }, [getPos, activeTool, nodes, findHit]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getPos(e);
    if (onCursorMove) {
      try {
        const nx = Math.max(0, Math.min(1, pos.x / CANVAS_SIZE));
        const ny = Math.max(0, Math.min(1, pos.y / CANVAS_SIZE));
        onCursorMove(nx, ny, activeTool);
      } catch {
        // ignore
      }
    }

    if (!dragTarget) {
      // Hover detection
      const hit = findHit(pos, nodes);
      setHoveredNode(hit?.type === "node" ? hit.index : null);
      // Show curve preview only in pen mode with at least one anchor placed
      if (activeTool === "pen" && nodes.length > 0) {
        setCursorPos(pos);
      } else {
        setCursorPos(null);
      }
      return;
    }

    // Emit a light-weight "stroke point" stream for multiplayer. This is not the
    // canonical bezier model; it's just a fast live visualization.
    if (onStrokePoint && activeTool === "pen" && isPointerDownRef.current) {
      try {
        const nx = Math.max(0, Math.min(1, pos.x / CANVAS_SIZE));
        const ny = Math.max(0, Math.min(1, pos.y / CANVAS_SIZE));
        onStrokePoint(nx, ny);
      } catch {
        // ignore
      }
    }

    const updated = JSON.parse(JSON.stringify(nodes)) as BezierNode[];
    const node = updated[dragTarget.index];

    if (dragTarget.type === "node") {
      let finalPos = pos;
      if (isShiftPressed) {
        const prevNode = dragTarget.index > 0 ? updated[dragTarget.index - 1] : null;
        if (prevNode) {
          finalPos = snapPoint(pos, prevNode.pos);
        }
      }
      node.pos = finalPos;
    } else if (dragTarget.type === "handleOut") {
      let finalPos = pos;
      if (isShiftPressed) {
        finalPos = snapPoint(pos, node.pos);
      }
      node.handleOut = { x: finalPos.x - node.pos.x, y: finalPos.y - node.pos.y };
      
      if (!isAltPressed) {
        node.handleIn = { x: -node.handleOut.x, y: -node.handleOut.y };
      }
    } else if (dragTarget.type === "handleIn") {
      let finalPos = pos;
      if (isShiftPressed) {
        finalPos = snapPoint(pos, node.pos);
      }
      node.handleIn = { x: finalPos.x - node.pos.x, y: finalPos.y - node.pos.y };

      if (!isAltPressed) {
        node.handleOut = { x: -node.handleIn.x, y: -node.handleIn.y };
      }
    }

    setNodes(updated);
  }, [getPos, dragTarget, nodes, isShiftPressed, isAltPressed, activeTool, onCursorMove, onStrokePoint]);

  const handlePointerLeave = useCallback(() => {
    setCursorPos(null);
    setHoveredNode(null);
    isPointerDownRef.current = false;
    if (onCursorMove) {
      try {
        onCursorMove(-1, -1, activeTool);
      } catch {
        // ignore
      }
    }
  }, [onCursorMove, activeTool]);

  const handlePointerUp = useCallback((e?: React.PointerEvent<HTMLCanvasElement>) => {
    // Discard the pre-drag ghost snapshot so it stops rendering after release
    dragStartNodesRef.current = null;
    isPointerDownRef.current = false;
    if (dragTarget) {
      pushHistory(nodes);
      if (activeTool === "select") {
        // stay in select
      } else {
        setActiveTool("pen");
      }
    }
    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore (can throw if not captured)
      }
    }
    setDragTarget(null);
  }, [dragTarget, nodes, pushHistory, activeTool]);

  const handleSubmit = useCallback(() => {
    if (persistKey) {
      try {
        localStorage.removeItem(persistKey);
      } catch {
        // ignore
      }
    }
    // Create a 512x512 crop of the center for scoring
    const offscreen = document.createElement("canvas");
    offscreen.width = VIEW_SIZE;
    offscreen.height = VIEW_SIZE;
    const ctx = offscreen.getContext("2d")!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    if (nodes.length > 1) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "square";
      ctx.beginPath();
      
      // Translate coordinates so that (OFFSET, OFFSET) becomes (0,0) in the crop
      const tx = (p: Point) => ({ x: p.x - OFFSET, y: p.y - OFFSET });
      
      const p0 = tx(nodes[0].pos);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < nodes.length; i++) {
        const prev = nodes[i - 1];
        const curr = nodes[i];
        const cp1 = tx({ x: prev.pos.x + prev.handleOut.x, y: prev.pos.y + prev.handleOut.y });
        const cp2 = tx({ x: curr.pos.x + curr.handleIn.x, y: curr.pos.y + curr.handleIn.y });
        const p = tx(curr.pos);
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p.x, p.y);
      }
      ctx.stroke();
    }

    onSubmit(offscreen.toDataURL("image/png"));
  }, [nodes, onSubmit, persistKey]);

  const renderPreviewDataUrl = useCallback((currentNodes: BezierNode[]) => {
    const offscreen = document.createElement("canvas");
    // Render the full drawing space (not the scoring crop) so the opponent sees
    // the same framing as the local player.
    offscreen.width = CANVAS_SIZE;
    offscreen.height = CANVAS_SIZE;
    const ctx = offscreen.getContext("2d")!;
    // Transparent background so the opponent can see the prompt underneath.
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (currentNodes.length > 1) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "square";
      ctx.beginPath();
      const p0 = currentNodes[0].pos;
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < currentNodes.length; i++) {
        const prev = currentNodes[i - 1];
        const curr = currentNodes[i];
        const cp1 = { x: prev.pos.x + prev.handleOut.x, y: prev.pos.y + prev.handleOut.y };
        const cp2 = { x: curr.pos.x + curr.handleIn.x, y: curr.pos.y + curr.handleIn.y };
        const p = curr.pos;
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p.x, p.y);
      }
      ctx.stroke();
    }

    return offscreen.toDataURL("image/png");
  }, []);

  // Emit a debounced live preview for multiplayer.
  useEffect(() => {
    if (!onLivePreview) return;
    if (livePreviewTimeoutRef.current) window.clearTimeout(livePreviewTimeoutRef.current);
    livePreviewTimeoutRef.current = window.setTimeout(() => {
      try {
        onLivePreview(renderPreviewDataUrl(nodes));
      } catch {
        // ignore preview failures
      }
    }, 150);
    return () => {
      if (livePreviewTimeoutRef.current) window.clearTimeout(livePreviewTimeoutRef.current);
    };
  }, [nodes, onLivePreview, renderPreviewDataUrl]);

  // Reset submit guard each round / session.
  useEffect(() => {
    submittedRef.current = false;
  }, [persistKey, ghostImageSrc]);

  // Auto-submit once when time runs out.
  useEffect(() => {
    if (timeLeft > 0) return;
    if (submittedRef.current) return;
    submittedRef.current = true;
    handleSubmit();
  }, [timeLeft, handleSubmit]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const hasNodes = nodes.length > 0;
  const hasSelection = selectedNodes.length > 0;

  const tools = [
    { id: "pen" as Tool, icon: <Pen size={15} />, label: "Pen Tool" },
    { id: "select" as Tool, icon: <MousePointer2 size={15} />, label: "Select" },
  ];

  return (
    <div className="flex flex-col gap-0 w-full h-full border-4 border-white hard-shadow bg-black overflow-hidden select-none">
      {/* SHORTHAND LEGEND BAR — collapses gracefully on small screens */}
      <div className="bg-white text-black py-1.5 px-3 flex flex-wrap items-center justify-between border-b-4 border-white gap-2">
        <div className="flex items-center gap-2 sm:gap-3 text-[9px] font-black uppercase tracking-widest">
          <button
            type="button"
            onClick={() => setActiveTool("pen")}
            className="flex items-center gap-1 hover:bg-black/5 px-1.5 py-1"
            aria-label="Pen tool"
          >
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">P</kbd>
            <span className="hidden xs:inline">Pen</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("select")}
            className="flex items-center gap-1 hover:bg-black/5 px-1.5 py-1"
            aria-label="Select tool"
          >
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">V</kbd>
            <span className="hidden xs:inline">Select</span>
          </button>
          <button
            type="button"
            onClick={deleteSelectedNode}
            disabled={!hasSelection}
            className="hidden sm:flex items-center gap-1 hover:bg-black/5 px-1.5 py-1 disabled:opacity-40"
            aria-label="Delete selected node"
          >
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">DEL</kbd>
            <span>Delete_Node</span>
          </button>
          <button
            type="button"
            onClick={() => { setSelectedNodes([]); setDragTarget(null); }}
            className="hidden sm:flex items-center gap-1 text-black/60 hover:text-black hover:bg-black/5 px-1.5 py-1"
            aria-label="Deselect"
          >
            <kbd className="px-1.5 py-0.5 border border-black/20 rounded-sm bg-transparent text-black font-mono">ESC</kbd>
            <span>Deselect</span>
          </button>
        </div>

        <div className="hidden md:flex items-center gap-3 text-[9px] font-black uppercase tracking-widest border-l-2 border-black/10 pl-3">
          <button type="button" onClick={undo} disabled={!canUndo} className="flex items-center gap-1 hover:bg-black/5 px-1.5 py-1 disabled:opacity-40" aria-label="Undo">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">⌘Z</kbd>
            <span>Undo</span>
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} className="flex items-center gap-1 hover:bg-black/5 px-1.5 py-1 disabled:opacity-40" aria-label="Redo">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">⇧⌘Z</kbd>
            <span>Redo</span>
          </button>
          <button type="button" onClick={() => setIsShiftPressed((v) => !v)} className="flex items-center gap-1 hover:bg-black/5 px-1.5 py-1" aria-pressed={isShiftPressed} aria-label="Toggle snap 45 degrees">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">SHIFT</kbd>
            <span>Snap_45°</span>
          </button>
          <button type="button" onClick={() => setIsAltPressed((v) => !v)} className="flex items-center gap-1 hover:bg-black/5 px-1.5 py-1" aria-pressed={isAltPressed} aria-label="Toggle break handle">
            <kbd className="px-1.5 py-0.5 border border-black rounded-sm bg-black text-white font-mono">ALT</kbd>
            <span>Break_Handle</span>
          </button>
        </div>
      </div>

      {/* Illustrator Control Bar — compact on mobile */}
      <div className="h-10 border-b-4 border-white flex items-center px-3 gap-3 bg-black z-10 overflow-hidden">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-3 h-3 bg-white" />
          <span className="font-display font-black text-[10px] uppercase tracking-[0.15em] hidden sm:block">CTRL_PANEL</span>
        </div>
        <div className="h-5 w-px bg-white/20 hidden sm:block" />
        <div className="flex items-center gap-3 text-[10px] font-display font-bold uppercase tracking-widest text-white/60 min-w-0">
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-white/40">TOOL:</span>
            <span className="text-white">{activeTool === "pen" ? "PEN" : "SELECT"}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-white/40">N:</span>
            <span className="text-white">{nodes.length}</span>
          </div>
          {selectedNodes.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 animate-pulse text-white shrink-0">
              <span>SEL:</span>
              <span>{selectedNodes.length === 1 ? `#${selectedNodes[0] + 1}` : "SEG"}</span>
            </div>
          )}
        </div>
        <div className="flex-1" />
        {/* Modifier key indicators — hidden on small screens */}
        <div className="hidden sm:flex items-center gap-1.5">
          <div className={`px-1.5 py-0.5 border text-[9px] font-black ${isShiftPressed ? "bg-white text-black border-white" : "text-white/20 border-white/10"}`}>SHIFT</div>
          <div className={`px-1.5 py-0.5 border text-[9px] font-black ${isAltPressed ? "bg-white text-black border-white" : "text-white/20 border-white/10"}`}>ALT</div>
          <div className={`px-1.5 py-0.5 border text-[9px] font-black ${isMetaPressed ? "bg-white text-black border-white" : "text-white/20 border-white/10"}`}>CMD</div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Illustrator Sidebar Tool Panel — hidden on mobile */}
        <div className="hidden sm:flex w-14 border-r-4 border-white flex-col items-center py-3 gap-3 bg-black shrink-0">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                if (soundEnabled) playClick();
                setActiveTool(tool.id);
                setSelectedNodes([]);
              }}
              className={`w-10 h-10 flex items-center justify-center transition-all ${
                activeTool === tool.id
                  ? "bg-white text-black hard-shadow-sm scale-110"
                  : "text-white hover:bg-white/10 border-2 border-transparent"
              }`}
              title={`${tool.label} (${tool.id === "pen" ? "P" : "V"})`}
            >
              {tool.icon}
            </button>
          ))}
          <div className="h-px w-8 bg-white/20 my-2" />
          <button
            onClick={undo}
            disabled={!canUndo}
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-white hover:text-black disabled:opacity-10 transition-all"
            title="Undo (⌘Z)"
          >
            <Undo2 size={16} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-white hover:text-black disabled:opacity-10 transition-all"
            title="Redo (⇧⌘Z)"
          >
            <Redo2 size={16} />
          </button>
          <div className="flex-1" />
          <button
            onClick={clearCanvas}
            disabled={!hasNodes}
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-red-500 hover:text-white disabled:opacity-10 transition-all border-2 border-white/10 mb-2"
            title="Clear Stage (⌘X)"
          >
            <Trash2 size={16} />
          </button>
        </div>

        {/* Workspace */}
        <div className="flex-1 bg-[#050505] relative overflow-hidden flex items-center justify-center p-3 sm:p-6">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className={`block transition-all bg-black touch-none w-full h-full max-w-full max-h-full object-contain ${
              activeTool === "pen" ? "cursor-crosshair" : "cursor-default"
            } outline-none`}
            style={{ aspectRatio: "1 / 1", maxWidth: "min(100%, calc(100vh - 14rem))", maxHeight: "min(100%, calc(100vh - 14rem))", width: "auto", height: "auto" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            tabIndex={0}
          />
          {/* Zoom indicator */}
          <div className="absolute bottom-3 right-3 text-[9px] font-black text-white/20 uppercase tracking-widest">
            Zoom: 100% | Layer: 01
          </div>
        </div>

        {/* Illustrator Right Panel — hidden on mobile/tablet, shown lg+ */}
        <div className="hidden lg:flex w-44 border-l-4 border-white flex-col bg-black p-3 gap-4 shrink-0">
          <div className="space-y-3">
            <h3 className="font-display font-black text-[10px] uppercase tracking-widest border-b-2 border-white/10 pb-2">PROPERTIES</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-white/40 font-bold uppercase">WIDTH</span>
                <span className="text-[10px] font-mono text-white">512px</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-white/40 font-bold uppercase">HEIGHT</span>
                <span className="text-[10px] font-mono text-white">512px</span>
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <span className="text-[8px] text-white/40 font-bold uppercase tracking-widest">Shortcuts</span>
              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-bold text-white/60"><span>PEN</span> <span className="text-white bg-white/10 px-1 font-mono">[P]</span></div>
                <div className="flex justify-between text-[9px] font-bold text-white/60"><span>SELECT</span> <span className="text-white bg-white/10 px-1 font-mono">[V]</span></div>
                <div className="flex justify-between text-[9px] font-bold text-white/60"><span>DELETE</span> <span className="text-white bg-white/10 px-1 font-mono">[DEL]</span></div>
              </div>
            </div>
          </div>
          <div className="flex-1" />
          <motion.button
            whileHover={{ scale: 1.02, x: -2, y: -2, boxShadow: "4px 4px 0px 0px rgba(255,255,255,1)" }}
            whileTap={{ scale: 0.98, x: 0, y: 0, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
            onClick={handleSubmit}
            disabled={nodes.length < 2}
            className="w-full py-3 bg-white text-black font-display font-black text-xs uppercase tracking-[0.2em] border-2 border-white disabled:opacity-20 transition-all flex items-center justify-center gap-2"
          >
            <Send size={14} />
            SUBMIT
          </motion.button>
        </div>
      </div>

      {/* Status Bar / Footer — truncated gracefully on mobile */}
      <div className="h-7 border-t-4 border-white bg-black flex items-center px-3 justify-between text-[9px] font-bold text-white/40 uppercase tracking-[0.2em] overflow-hidden">
        <div className="flex items-center gap-4 min-w-0 overflow-hidden">
          <span className="truncate hidden sm:block">{activeTool === "pen" ? "Draw anchor points to create a path" : selectedNodes.length > 0 ? "Drag to modify" : "Select an anchor"}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="hidden sm:block">
            X: {cursorPos ? cursorPos.x.toFixed(1) : "0.0"}&nbsp;&nbsp;Y: {cursorPos ? cursorPos.y.toFixed(1) : "0.0"}
          </span>
          <span className="text-white/20 hidden md:block">SYSTEM_READY_</span>
        </div>
      </div>
    </div>
  );
}
