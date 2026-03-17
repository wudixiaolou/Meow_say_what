import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { AppLanguage } from "../types";

interface OnboardingPageProps {
  onNext: (data: { role: 'dad' | 'mom'; catName: string }) => void;
  language?: AppLanguage;
}

export function OnboardingPage({ onNext, language = "zh" }: OnboardingPageProps) {
  const isEn = language === "en";
  const [role, setRole] = useState<'dad' | 'mom' | null>(null);
  const [catName, setCatName] = useState("");

  const handleSubmit = () => {
    if (role && catName) {
      onNext({ role, catName });
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-zinc-950 p-6 pt-12">
      <div className="flex-1 max-w-md mx-auto w-full flex flex-col gap-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white">{isEn ? "Create Profile" : "建立档案"}</h2>
          <p className="text-white/60">{isEn ? "Let's get to know your cat better" : "让我们更好地了解你的猫咪"}</p>
        </div>

        {/* Question 1 */}
        <div className="space-y-4">
          <label className="text-white font-medium block">
            {isEn ? "1. Are you your cat's dad or mom?" : "1. 请问你是猫咪的“爸爸”还是“妈妈”？"}
          </label>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setRole('dad')}
              className={`p-4 rounded-2xl border-2 transition-all ${
                role === 'dad'
                  ? 'border-lime-400 bg-lime-400/10 text-lime-400'
                  : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {isEn ? "👨 Dad" : "👨 爸爸"}
            </button>
            <button
              onClick={() => setRole('mom')}
              className={`p-4 rounded-2xl border-2 transition-all ${
                role === 'mom'
                  ? 'border-lime-400 bg-lime-400/10 text-lime-400'
                  : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {isEn ? "👩 Mom" : "👩 妈妈"}
            </button>
          </div>
        </div>

        {/* Question 2 */}
        <div className="space-y-4">
          <label className="text-white font-medium block">
            {isEn ? "2. What's your cat's name?" : "2. 请问你的猫咪叫什么？"}
          </label>
          <input
            type="text"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder={isEn ? "e.g. Mimi" : "例如：咪咪"}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/30 focus:outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-400 transition-all"
          />
        </div>
      </div>

      {/* Bottom - Next Button */}
      <div className="w-full max-w-md mx-auto pb-12">
        <button
          onClick={handleSubmit}
          disabled={!role || !catName}
          className="w-full bg-lime-400 text-black py-4 rounded-full font-bold text-lg hover:bg-lime-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(163,230,53,0.3)]"
        >
          {isEn ? "Next" : "下一步"} <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}
