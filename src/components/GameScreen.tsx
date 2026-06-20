import { useGame } from "@/lib/gameContext";
import DrawPhase from "./DrawPhase";
import RoundResult from "./RoundResult";
import FinalResults from "./FinalResults";
import ScoringOverlay from "./ScoringOverlay";
import HomePage from "./HomePage";
import CountdownTransition from "./CountdownTransition";
import Matchmaking from "./Matchmaking";

export default function GameScreen() {
  const { phase } = useGame();

  if (phase === "idle") return <HomePage />;

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center p-4 md:p-12 bg-black text-white selection:bg-white selection:text-black">
      <div className="w-full h-full flex flex-col items-center justify-center">
        {phase === "matchmaking" && <Matchmaking />}
        {phase === "countdown" && <CountdownTransition />}
        {phase === "draw" && <DrawPhase />}
        {phase === "scoring" && <ScoringOverlay />}
        {phase === "roundResult" && <RoundResult />}
        {phase === "finalResults" && <FinalResults />}
      </div>
    </div>
  );
}
