import { motion, AnimatePresence } from "motion/react";

interface Props {
  text: string;
}

export function TranslationBubble({ text }: Props) {
  return (
    <AnimatePresence mode="wait">
      {text && (
        <motion.div
          key={text}
          initial={{ opacity: 0, y: -20, scale: 0.9, transformOrigin: 'top right' }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="absolute top-28 right-6 w-[75%] max-w-sm z-20"
        >
          <div className="bg-white/95 backdrop-blur-md text-black p-5 rounded-3xl rounded-tr-none shadow-2xl relative border-2 border-lime-400/20">
            {/* Speech bubble tail pointing to top right */}
            <div className="absolute -top-4 right-0 w-8 h-8 bg-white/95 border-t-2 border-r-2 border-lime-400/20 transform -skew-x-12 rounded-tr-lg" style={{ clipPath: 'polygon(100% 0, 0% 100%, 100% 100%)' }}></div>
            
            <div className="text-lg font-display leading-relaxed relative z-10">
              "{text}"
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
