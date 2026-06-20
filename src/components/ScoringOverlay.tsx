import { motion } from "framer-motion";

export default function ScoringOverlay() {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1, repeat: Infinity }}
        className="font-display text-4xl font-black uppercase tracking-[0.4em] text-white"
      >
        Calculating_Score...
      </motion.div>
    </div>
  );
}
