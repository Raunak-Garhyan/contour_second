import { useGame } from "@/lib/gameContext";

interface StatusBarProps {
  timeLeft?: number;
  totalTime?: number;
}

export default function StatusBar({ timeLeft, totalTime }: StatusBarProps) {
  const { currentRound, totalRounds, results, phase } = useGame();

  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const progress = totalTime && timeLeft != null ? timeLeft / totalTime : 1;

  return (
    <div className="w-full max-w-[1000px] mx-auto mb-6">
      <div className="flex items-center justify-between px-1 py-3 text-sm font-display font-bold uppercase tracking-widest text-foreground border-b-2 border-white/10 mb-2">
        <span>
          Round {currentRound}/{totalRounds}
        </span>
        {timeLeft != null && (
          <span className="text-xl tabular-nums">
            {timeLeft}s
          </span>
        )}
        <span>Score {totalScore.toFixed(1)}</span>
      </div>
      {totalTime && timeLeft != null && (
        <div className="h-3 w-full bg-secondary border-2 border-white overflow-hidden">
          <div
            className="h-full transition-all duration-1000 linear bg-white"
            style={{
              width: `${progress * 100}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
