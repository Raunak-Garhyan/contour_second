import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame, CONTOUR_LIBRARY } from "@/lib/gameContext";
import { playCountdown, playGo } from "@/lib/sounds";

const STEPS = [
  { text: "GET", color: "#ffffff" },
  { text: "SET", color: "#ffffff" },
  { text: "GO!", color: "#ffffff" },
];

function getRandomContours(): string[] {
  const shuffled = [...CONTOUR_LIBRARY].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map((c) => c.src);
}

export default function CountdownTransition() {
  const { setPhase, soundEnabled } = useGame();
  const [step, setStep] = useState(0);
  const [contours] = useState(getRandomContours);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    timers.push(
      setTimeout(() => {
        if (soundEnabled) playCountdown();
      }, 0)
    );

    timers.push(
      setTimeout(() => {
        setStep(1);
        if (soundEnabled) playCountdown();
      }, 1000)
    );

    timers.push(
      setTimeout(() => {
        setStep(2);
        if (soundEnabled) playGo();
      }, 2000)
    );

    timers.push(
      setTimeout(() => {
        setPhase("draw");
      }, 2800)
    );

    return () => timers.forEach(clearTimeout);
  }, [setPhase, soundEnabled]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.5 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="flex flex-col items-center gap-10"
        >
          <div
            className="w-48 h-48 sm:w-60 sm:h-60 bg-black border-4 border-white hard-shadow flex items-center justify-center"
          >
            <img
              src={contours[step]}
              alt="contour preview"
              className="w-full h-full object-contain opacity-80 invert"
            />
          </div>
          <motion.h1
            className="font-display text-8xl sm:text-9xl font-black tracking-tighter text-white"
          >
            {STEPS[step].text}
          </motion.h1>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
