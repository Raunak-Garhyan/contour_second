import { motion } from "framer-motion";
import { useGame } from "@/lib/gameContext";
import { User, Users, Volume2, VolumeX } from "lucide-react";
import { playClick } from "@/lib/sounds";

export default function HomePage() {
  const { startGame, startMatchmaking, soundEnabled, toggleSound } = useGame();

  const handleStart = (mode: "solo" | "multiplayer") => {
    if (soundEnabled) playClick();
    if (mode === "solo") {
      startGame("solo");
      return;
    }
    startMatchmaking();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-black">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-lg p-10 bg-black border-4 border-white hard-shadow"
      >
        <h1 className="font-display text-7xl sm:text-8xl font-black text-white leading-none mb-6 tracking-tighter">
          CONTOUR
        </h1>

        <div className="space-y-4 mb-10">
          <p className="text-white font-display font-bold uppercase tracking-widest text-xs leading-relaxed opacity-80">
            Humans can't reliably recall shapes.
          </p>
          <p className="text-white font-display font-bold uppercase tracking-widest text-xs leading-relaxed">
            Redraw the contour from memory.
          </p>
        </div>

        <p className="text-white font-display font-black text-sm uppercase tracking-[0.2em] mb-6">
          SELECT MODE_
        </p>

        <div className="flex items-center gap-4">
          <motion.button
            whileTap={{ x: 2, y: 2, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
            whileHover={{ x: -2, y: -2, boxShadow: "4px 4px 0px 0px rgba(255,255,255,1)" }}
            onClick={() => handleStart("solo")}
            className="flex-1 h-16 border-2 border-white flex items-center justify-center gap-3 text-white font-display font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all"
            aria-label="Solo mode"
          >
            <User size={20} />
            <span>SOLO</span>
          </motion.button>

          <motion.button
            whileTap={{ x: 2, y: 2, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
            whileHover={{ x: -2, y: -2, boxShadow: "4px 4px 0px 0px rgba(255,255,255,1)" }}
            onClick={() => handleStart("multiplayer")}
            className="flex-1 h-16 border-2 border-white flex items-center justify-center gap-3 text-white font-display font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all"
            aria-label="Multiplayer mode"
          >
            <Users size={20} />
            <span>MULTI</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              if (soundEnabled) playClick();
              toggleSound();
            }}
            className="w-16 h-16 border-2 border-white flex items-center justify-center text-white hover:bg-white hover:text-black transition-all"
            aria-label={soundEnabled ? "Mute sound" : "Enable sound"}
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </motion.button>
        </div>
      </motion.div>

      <p className="mt-10 text-white font-display font-bold text-[10px] uppercase tracking-[0.4em] opacity-30">
        CONTOUR DRAW DUEL // REV 2.0
      </p>
    </div>
  );
}
