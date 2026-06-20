import { useEffect, useState, useCallback } from "react";
import { useGame } from "@/lib/gameContext";
import { scoreDrawing } from "@/lib/scoring";
import { playSubmit, playTimerTick } from "@/lib/sounds";
import BezierCanvas from "./BezierCanvas";
import StatusBar from "./StatusBar";
import { useMultiplayerChannel } from "@/hooks/useMultiplayerChannel";
import { useComputerId } from "@/hooks/useComputerId";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import OpponentMirror from "./OpponentMirror";

export default function DrawPhase() {
  const { drawTime, currentPrompt, setPhase, submitRound, soundEnabled, mode, currentRound, totalRounds, results, multiplayerSessionId, syncRound } = useGame();
  const [timeLeft, setTimeLeft] = useState(drawTime);
  const [viewMode, setViewMode] = useState<"you" | "opponent">("you");
  const { computerId } = useComputerId({ enabled: mode === "multiplayer" });
  const multiplayer = useMultiplayerChannel({ enabled: mode === "multiplayer", sessionId: multiplayerSessionId, computerId, round: currentRound });
  const { sendPreview, sendScore, sendCursor, sendStrokePoint, sendRoundState, opponentRoundState, opponentCursorTrail } = multiplayer;

  useEffect(() => {
    // Restore remaining time for this session+round (best-effort).
    if (mode === "multiplayer" && multiplayerSessionId) {
      try {
        const raw = localStorage.getItem(`contour_session:${multiplayerSessionId}:round:${currentRound}:timeLeft`);
        if (raw) {
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0) setTimeLeft(n);
          else setTimeLeft(drawTime);
        } else {
          setTimeLeft(drawTime);
        }
      } catch {
        setTimeLeft(drawTime);
      }
    } else {
      setTimeLeft(drawTime);
    }

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        if (prev <= 6 && soundEnabled) playTimerTick();
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [drawTime, soundEnabled, mode, multiplayerSessionId, currentRound]);

  useEffect(() => {
    if (mode !== "multiplayer") return;
    if (!multiplayerSessionId) return;
    try {
      localStorage.setItem(
        `contour_session:${multiplayerSessionId}:round:${currentRound}:timeLeft`,
        String(timeLeft)
      );
    } catch {
      // ignore
    }
  }, [timeLeft, mode, multiplayerSessionId, currentRound]);

  useEffect(() => {
    if (mode !== "multiplayer") return;
    if (!multiplayerSessionId) return;
    sendRoundState(currentRound, "draw");
  }, [mode, multiplayerSessionId, currentRound, sendRoundState]);

  useEffect(() => {
    if (mode !== "multiplayer") return;
    if (!opponentRoundState) return;
    // If we ever get out of sync, snap to the highest known round.
    // This avoids both players being on different prompts.
    if (opponentRoundState.round > currentRound) {
      syncRound(opponentRoundState.round);
    }
  }, [opponentRoundState, currentRound, mode, syncRound]);

  const handleSubmit = useCallback(
    async (dataUrl: string) => {
      if (!currentPrompt) return;
      if (soundEnabled) playSubmit();
      setPhase("scoring");
      const withTimeout = async <T,>(p: Promise<T>, ms: number) => {
        return await Promise.race([
          p,
          new Promise<T>((_, reject) => {
            window.setTimeout(() => reject(new Error("Score timeout")), ms);
          }),
        ]);
      };

      let score = 0;
      try {
        score = await withTimeout(scoreDrawing(currentPrompt.src, dataUrl), 6000);
      } catch {
        score = 0;
      }
      if (mode === "multiplayer") {
        const priorTotal = results.reduce((sum, r) => sum + r.score, 0);
        sendScore(priorTotal + score, currentRound);
        if (isSupabaseConfigured && multiplayerSessionId && computerId) {
          try {
            await supabase.from("session_rounds").upsert({
              session_id: multiplayerSessionId,
              round: currentRound,
              computer_id: computerId,
              prompt_id: currentPrompt.id,
              score,
              drawing_data_url: dataUrl,
            });
          } catch {
            // ignore persistence failures
          }
        }
      }
      submitRound(dataUrl, score);
    },
    [currentPrompt, setPhase, submitRound, soundEnabled, mode, results, sendScore, currentRound, multiplayerSessionId, computerId]
  );

  if (mode === "multiplayer") {
    const yourTotal = results.reduce((sum, r) => sum + r.score, 0);
    const oppTotal = multiplayer.opponentTotalScore ?? null;
    const leader =
      oppTotal == null
        ? "Waiting..."
        : yourTotal === oppTotal
          ? "Tie"
          : yourTotal > oppTotal
            ? "You"
            : "Opponent";
    const progress = drawTime && timeLeft != null ? timeLeft / drawTime : 1;
    const maxTotal = (totalRounds || 0) * 10;
    const totalPct = maxTotal > 0 ? Math.round((yourTotal / maxTotal) * 100) : 0;
    const verdict =
      oppTotal == null
        ? "Waiting..."
        : yourTotal === oppTotal
          ? "Draw"
          : yourTotal > oppTotal
            ? "You won"
            : "You lose";
    return (
      <div className="flex flex-col items-center w-full h-full min-h-0">
        <div className="w-full max-w-[1200px] mx-auto mb-4">
          <div className="px-1 py-3 text-xs font-display font-bold uppercase tracking-widest text-white border-b-2 border-white/15">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div className="flex items-center gap-3">
                <span>
                  RO_{String(currentRound).padStart(2, "0")}
                </span>
                <span className="text-white/40">|</span>
                <span>{currentPrompt?.title ?? "Prompt"}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-white/60">Leaderboard_</span>
                <span className="text-white/40">|</span>
                <span className="text-white/80">
                  1st: <span className="text-white">{leader}</span>
                </span>
                <span className="text-white/40">|</span>
                <span className="text-white/80">{verdict}</span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div className="flex items-center gap-3">
                <span className="text-white/70">
                  YOU <span className="text-white tabular-nums">{yourTotal.toFixed(1)}</span>
                </span>
                <span className="text-white/30">vs</span>
                <span className="text-white/70">
                  OPP <span className="text-white tabular-nums">{oppTotal == null ? "--" : oppTotal.toFixed(1)}</span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-white/70">
                  Total_System_Score{" "}
                  <span className="text-white tabular-nums">
                    {yourTotal.toFixed(1)}
                  </span>
                  {maxTotal ? (
                    <span className="text-white/50">
                      {" "}
                      / {maxTotal} ({totalPct}%)
                    </span>
                  ) : null}
                </span>
                <span className="text-white/40">|</span>
                <span className="text-lg tabular-nums">{timeLeft}s</span>
              </div>
            </div>
          </div>
          <div className="h-3 w-full bg-white/10 border-2 border-white/20 overflow-hidden">
            <div
              className="h-full transition-all duration-1000 linear bg-white"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="w-full flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-white/70 font-display font-bold uppercase tracking-widest text-[9px]">
              Share your session link to invite a friend
            </div>
            <div className="flex items-center gap-4">
              <div className="text-white/50 font-display font-bold uppercase tracking-widest text-[9px]">
                {multiplayer.opponentId ? "Friend connected" : "No friend yet"}
              </div>
              <div className="flex border-2 border-white hard-shadow-sm bg-black overflow-hidden select-none">
                <button
                  type="button"
                  onClick={() => setViewMode("you")}
                  className={`px-3 py-1 font-display font-black text-[9px] uppercase tracking-widest transition-all ${
                    viewMode === "you"
                      ? "bg-white text-black font-extrabold"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  Your_Canvas
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("opponent")}
                  className={`px-3 py-1 font-display font-black text-[9px] uppercase tracking-widest transition-all border-l-2 border-white ${
                    viewMode === "opponent"
                      ? "bg-white text-black font-extrabold"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  Opponent_Mirror
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 w-full min-h-0 flex flex-col items-center">
          <div className="w-full max-w-[900px] flex-1 min-h-0 flex flex-col relative">
            {/* Keep both mounted so switching views doesn't wipe canvas state */}
            <div
              className={`flex-1 min-h-0 flex flex-col absolute inset-0 ${
                viewMode === "you" ? "visible z-10" : "invisible pointer-events-none z-0"
              }`}
              aria-hidden={viewMode !== "you"}
            >
              <div className="text-white font-display font-black uppercase tracking-[0.25em] text-[10px] mb-2 opacity-80">
                YOU
              </div>
              <div className="flex-1 min-h-0">
                <BezierCanvas
                  onSubmit={handleSubmit}
                  timeLeft={timeLeft}
                  ghostImageSrc={currentPrompt?.src}
                  onLivePreview={(dataUrl) => sendPreview(dataUrl, currentRound)}
                  persistKey={multiplayerSessionId ? `contour_session:${multiplayerSessionId}:round:${currentRound}:nodes` : undefined}
                  onCursorMove={(x, y, tool) => {
                    sendCursor(x, y, tool);
                  }}
                  onStrokePoint={(x, y) => {
                    if (x < 0 || y < 0) return;
                    sendStrokePoint(x, y, currentRound);
                  }}
                  isVisible={viewMode === "you"}
                />
              </div>
            </div>
            <div
              className={`flex-1 min-h-0 flex flex-col absolute inset-0 ${
                viewMode === "opponent" ? "visible z-10" : "invisible pointer-events-none z-0"
              }`}
              aria-hidden={viewMode !== "opponent"}
            >
              <div className="text-white font-display font-black uppercase tracking-[0.25em] text-[10px] mb-2 opacity-80">
                OPPONENT
              </div>
              <div className="flex-1 min-h-0 w-full">
                <OpponentMirror
                  promptSrc={currentPrompt?.src}
                  opponentId={multiplayer.opponentId}
                  isSupported={multiplayer.isSupported}
                  opponentRound={multiplayer.opponentRound}
                  opponentPreview={multiplayer.opponentPreview}
                  opponentStrokePoints={multiplayer.opponentStrokePoints}
                  opponentCursor={multiplayer.opponentCursor}
                  opponentCursorTrail={opponentCursorTrail}
                  sessionId={multiplayerSessionId}
                  round={currentRound}
                  isVisible={viewMode === "opponent"}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full h-full min-h-0">
      <StatusBar timeLeft={timeLeft} totalTime={drawTime} />
      <div className="flex-1 w-full min-h-0">
        <BezierCanvas
          onSubmit={handleSubmit}
          timeLeft={timeLeft}
          ghostImageSrc={currentPrompt?.src}
        />
      </div>
    </div>
  );
}
