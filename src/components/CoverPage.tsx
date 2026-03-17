import { Globe } from "lucide-react";
import { AppLanguage } from "../types";

interface CoverPageProps {
  onStart: () => void;
  language?: AppLanguage;
  onToggleLanguage?: () => void;
}

export function CoverPage({ onStart, language = "en", onToggleLanguage }: CoverPageProps) {
  const isEn = language === "en";
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-between bg-zinc-950 p-6">
      {/* Top Bar - Language Toggle */}
      <div className="w-full flex justify-end pt-4">
        <button
          onClick={onToggleLanguage}
          className="flex items-center gap-2 text-white/80 hover:text-white transition-colors px-3 py-1.5 rounded-full border border-white/10 bg-white/5"
        >
          <Globe size={16} />
          <span className="text-sm font-medium">{isEn ? "EN" : "CN"}</span>
        </button>
      </div>

      {/* Center - Logo Area */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Logo Container: Square with two bubbles - Scaled down to w-36 h-36 */}
        <div className="relative w-36 h-36 mb-5 flex flex-col justify-center gap-3">
          {/* Top Bubble: Meow (Lime, Tail Left) */}
          <div className="relative bg-lime-400 rounded-xl py-2 px-5 self-start ml-2 shadow-[0_3px_12px_rgba(163,230,53,0.4)] transform -rotate-3">
            <span className="text-3xl font-display font-bold text-black">{isEn ? "Meow" : "喵"}</span>
             {/* Tail for "Left" pointing - Overlaps to prevent gaps */}
             <div className="absolute top-1/2 -left-2 w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[12px] border-r-lime-400 transform rotate-12"></div>
          </div>

          {/* Bottom Bubble: Hi! (White, Tail Right) */}
          <div className="relative bg-white rounded-xl py-2 px-6 self-end mr-2 shadow-[0_3px_12px_rgba(255,255,255,0.2)] transform rotate-3">
            <span className="text-3xl font-display font-bold text-black">{isEn ? "Hi!" : "你好"}</span>
            {/* Tail: Right pointing - Overlaps to prevent gaps */}
            <div className="absolute top-1/2 -right-2 w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[12px] border-l-white transform -rotate-12"></div>
          </div>
          
          {/* Background Glow for the whole logo area */}
          <div className="absolute inset-0 bg-lime-400/10 blur-2xl rounded-full -z-10"></div>
        </div>

        <h1 className="text-3xl font-bold text-white mb-2 tracking-wide">Meowlingo</h1>
        <p className="text-white/60">{isEn ? "Stop Guessing. Start Talking." : "别猜了，直接聊"}</p>
      </div>

      {/* Bottom - Start Button */}
      <div className="w-full max-w-md pb-12">
        <button
          onClick={onStart}
          className="w-full bg-lime-400 text-black py-4 rounded-full font-bold text-lg hover:bg-lime-300 transition-colors shadow-[0_0_30px_rgba(163,230,53,0.3)] flex items-center justify-center gap-2"
        >
          {isEn ? "Start" : "开始"}
        </button>
      </div>
    </div>
  );
}
