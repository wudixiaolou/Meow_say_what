import { Persona } from "../types";
import { motion } from "motion/react";

interface Props {
  personas: Persona[];
  selected: Persona;
  onSelect: (p: Persona) => void;
}

export function PersonaSelector({ personas, selected, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pb-4 px-2">
      {personas.map((p) => (
        <motion.button
          key={p.id}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect(p)}
          className={`flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-colors ${
            selected.id === p.id
              ? "border-lime-400 bg-lime-400/10"
              : "border-white/10 bg-white/5 hover:bg-white/10"
          }`}
        >
          <div className="text-5xl">{p.avatar}</div>
          <div>
            <div className="font-bold text-lg mb-1">{p.name}</div>
            <div className="text-sm text-white/60">{p.tagline}</div>
          </div>
        </motion.button>
      ))}
    </div>
  );
}
