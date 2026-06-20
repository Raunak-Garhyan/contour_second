import { useEffect } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/gameContext";
import { playScore } from "@/lib/sounds";
import { useComputerId } from "@/hooks/useComputerId";
import { useMultiplayerChannel } from "@/hooks/useMultiplayerChannel";

export default function RoundResult() {
  const { results, currentRound, totalRounds, nextRound, soundEnabled, mode, multiplayerSessionId, syncRound } = useGame();
  const lastResult = results[results.length - 1];
  const { computerId } = useComputerId({ enabled: mode === "multiplayer" });
  const mp = useMultiplayerChannel({ enabled: mode === "multiplayer", sessionId: multiplayerSessionId, computerId, round: currentRound });

  useEffect(() => {
    if (lastResult && soundEnabled) {
      playScore(lastResult.score);
    }
  }, [lastResult, soundEnabled]);

  useEffect(() => {
    if (mode !== "multiplayer") return;
    if (!mp.opponentRoundState) return;
    if (mp.opponentRoundState.round > currentRound) syncRound(mp.opponentRoundState.round);
  }, [mode, mp.opponentRoundState, currentRound, syncRound]);

  if (!lastResult) return null;

  const isLast = currentRound >= totalRounds;
  const scoreColor = lastResult.score >= 7 ? "text-accent" : lastResult.score >= 4 ? "text-card-foreground" : "text-destructive";

  return (
    <div className="flex flex-col items-center w-full max-w-[800px] mx-auto py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-10"
      >
        <p className="text-xs font-display font-bold uppercase tracking-[0.4em] text-white/40 mb-2">
          Round {lastResult.round} _ {lastResult.promptTitle}
        </p>
        <h2 className="text-9xl font-display font-black text-white leading-none tracking-tighter">
          {lastResult.score.toFixed(1)}
        </h2>
        <p className="text-white font-display font-bold uppercase tracking-widest text-xs mt-2 opacity-60">
          Precision_Score
        </p>
      </motion.div>

      <div className="grid grid-cols-2 gap-8 w-full max-w-[600px] mb-12">
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-display font-bold uppercase tracking-widest text-white/40">Reference_</p>
          <div className="w-full aspect-square border-2 border-white bg-black hard-shadow-sm overflow-hidden">
            <img src={lastResult.originalSrc} alt="Original contour" className="w-full h-full object-contain invert opacity-70" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-display font-bold uppercase tracking-widest text-white/40">Drawing_</p>
          <div className="w-full aspect-square border-2 border-white bg-black hard-shadow-sm overflow-hidden">
            <img src={lastResult.drawingDataUrl} alt="Your drawing" className="w-full h-full object-contain opacity-70" />
          </div>
        </div>
      </div>

      <motion.button
        whileHover={{ x: 4, y: 4, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
        whileTap={{ x: 4, y: 4, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
        onClick={() => {
          nextRound();
          if (mode === "multiplayer") {
            mp.sendRoundState(currentRound + 1, "countdown");
          }
        }}
        className="px-12 py-4 bg-white text-black font-display font-black text-sm uppercase tracking-[0.2em] hard-shadow transition-all"
      >
        {isLast ? "FINAL RESULTS" : "CONTINUE ROUND"}
      </motion.button>
    </div>
  );
}
