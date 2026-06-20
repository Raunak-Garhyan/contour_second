import { motion } from "framer-motion";
import { useGame } from "@/lib/gameContext";
import { useComputerId } from "@/hooks/useComputerId";
import { useMultiplayerChannel } from "@/hooks/useMultiplayerChannel";

export default function FinalResults() {
  const { results, playerName, resetGame, mode, multiplayerSessionId } = useGame();
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const maxScore = results.length * 10;
  const percentage = Math.round((totalScore / maxScore) * 100);
  const { computerId } = useComputerId({ enabled: mode === "multiplayer" });
  const mp = useMultiplayerChannel({ enabled: mode === "multiplayer", sessionId: multiplayerSessionId, computerId, round: results.length || 1 });
  const oppTotal = mp.opponentTotalScore ?? null;
  const leader =
    oppTotal == null
      ? "Waiting..."
      : totalScore === oppTotal
        ? "Tie"
        : totalScore > oppTotal
          ? "You"
          : "Opponent";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center w-full max-w-[600px] mx-auto py-10"
    >
      <h2 className="font-display text-4xl font-black uppercase tracking-tighter mb-1">Game_Over</h2>
      <p className="text-white/40 text-[10px] font-display font-bold uppercase tracking-[0.5em] mb-12">{playerName}</p>

      {mode === "multiplayer" && (
        <div className="w-full max-w-[600px] mb-10 border-2 border-white hard-shadow-sm bg-black p-5">
          <div className="flex items-center justify-between text-[10px] font-display font-bold uppercase tracking-widest text-white/60">
            <span>Leaderboard_</span>
            <span>1st: <span className="text-white">{leader}</span></span>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-white font-display font-black uppercase tracking-widest text-xs">YOU</div>
            <div className="text-white font-display font-black text-3xl tabular-nums">{totalScore.toFixed(1)}</div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-white/70 font-display font-black uppercase tracking-widest text-xs">OPP</div>
            <div className="text-white/70 font-display font-black text-3xl tabular-nums">
              {oppTotal == null ? "--" : oppTotal.toFixed(1)}
            </div>
          </div>
        </div>
      )}

      <div className="text-center mb-12">
        <p className="font-display text-[10rem] font-black leading-none text-white tracking-tighter">{totalScore.toFixed(1)}</p>
        <p className="text-white/60 font-display font-bold text-xs uppercase tracking-[0.3em] mt-4">
          Total_System_Score / {maxScore} ({percentage}%)
        </p>
      </div>

      <div className="w-full space-y-4 mb-16">
        {results.map((r) => {
          return (
            <div
              key={r.round}
              className="flex items-center justify-between p-5 bg-black border-2 border-white hard-shadow-sm"
            >
              <div className="flex items-center gap-6">
                <span className="text-[10px] text-white/40 font-display font-bold uppercase tracking-widest w-16">RO_0{r.round}</span>
                <span className="text-xs font-display font-black uppercase tracking-widest text-white">{r.promptTitle}</span>
              </div>
              <span className="font-display font-black text-2xl tabular-nums text-white">
                {r.score.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      <motion.button
        whileHover={{ x: 4, y: 4, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
        whileTap={{ x: 4, y: 4, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
        onClick={resetGame}
        className="px-12 py-5 bg-white text-black font-display font-black text-lg uppercase tracking-[0.3em] hard-shadow transition-all"
      >
        RESTART_SYSTEM
      </motion.button>
    </motion.div>
  );
}
