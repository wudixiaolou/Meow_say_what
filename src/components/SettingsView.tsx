import { CalendarDays, Globe, UserRound } from "lucide-react";
import { PersonaSelector } from "./PersonaSelector";
import { Persona, DiaryScheduleSettings, AppLanguage } from "../types";
import { useState } from "react";

interface SettingsViewProps {
  personas: Persona[];
  selectedPersona: Persona;
  onSelectPersona: (p: Persona) => void;
  schedule: DiaryScheduleSettings;
  onUpdateSchedule: (s: DiaryScheduleSettings) => void;
  language?: AppLanguage;
  onToggleLanguage?: () => void;
}

export function SettingsView({ 
  personas,
  selectedPersona, 
  onSelectPersona,
  schedule,
  onUpdateSchedule,
  language = "zh",
  onToggleLanguage
}: SettingsViewProps) {
  const isEn = language === "en";
  const [activeTab, setActiveTab] = useState<'persona' | 'diary'>('persona');

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden pt-safe">
      <div className="flex-none px-6 pt-6 pb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold flex items-center gap-2">{isEn ? "Settings" : "设置"}</h2>
        <button
          onClick={onToggleLanguage}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition-colors"
        >
          <Globe size={14} />
          <span>{isEn ? "EN" : "CN"}</span>
        </button>
      </div>

      <div className="flex-none px-6 mb-6">
        <div className="flex bg-white/5 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('persona')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === 'persona' ? 'bg-lime-400 text-black shadow-sm' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <UserRound size={16} />
            {isEn ? "Persona" : "猫咪分身"}
          </button>
          <button
            onClick={() => setActiveTab('diary')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === 'diary' ? 'bg-lime-400 text-black shadow-sm' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <CalendarDays size={16} />
            {isEn ? "Diary" : "日记设置"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {activeTab === 'persona' ? (
          <PersonaSelector personas={personas} selected={selectedPersona} onSelect={onSelectPersona} />
        ) : (
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <span className="font-medium text-base flex items-center gap-2">
                    <CalendarDays size={18} className="text-lime-400" /> 
                    {isEn ? "Scheduled Diary" : "定时生成日记"}
                  </span>
                  <p className="text-xs text-white/50">
                    {isEn ? "Generate automatically every day" : "开启后将每天自动生成"}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedule.enabled}
                    onChange={(e) => onUpdateSchedule({ ...schedule, enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-7 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:start-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5.5 after:w-5.5 after:transition-all peer-checked:bg-lime-400"></div>
                </label>
              </div>
              
              {schedule.enabled && (
                <div className="pt-4 border-t border-white/10 animate-in fade-in slide-in-from-top-2">
                  <label className="block text-sm text-white/70 mb-3">{isEn ? "Generate At" : "生成时间"}</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="time"
                      value={schedule.timeOfDay}
                      onChange={(e) => onUpdateSchedule({ ...schedule, timeOfDay: e.target.value })}
                      className="flex-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white text-lg font-mono focus:outline-none focus:border-lime-400/50 transition-colors"
                    />
                  </div>
                  <p className="text-xs text-white/40 mt-3 leading-relaxed">
                    {isEn ? (
                      <>The system will generate a cat diary every day at <span className="text-lime-300">{schedule.timeOfDay}</span> based on daily interactions.</>
                    ) : (
                      <>系统将在每天 <span className="text-lime-300">{schedule.timeOfDay}</span> 自动根据当天的互动内容为您生成一篇猫咪日记。</>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
