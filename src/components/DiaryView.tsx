import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FolderOpen, Loader2, Home } from "lucide-react";
import { AppLanguage, DiaryEntry, DiaryScheduleSettings, HighlightClip } from "../types";
import {
  loadDiaryByDate,
  loadDiaryEntries,
  markTextsConsumedAndCleanup,
  saveDiaryEntry,
  getUnconsumedInteractionTexts,
} from "../lib/diaryData";
import { generateDiaryWithModel, matchHighlightsForDiary } from "../lib/diaryGenerator";

interface DiaryViewProps {
  highlightHistory: HighlightClip[];
  catName?: string;
  personaName?: string;
  schedule: DiaryScheduleSettings;
  onUpdateSchedule: (s: DiaryScheduleSettings) => void;
  onHomeClick: () => void;
  language?: AppLanguage;
  isActive?: boolean;
}

function getDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDayLabelByLanguage(dateStr: string, lang: AppLanguage = "zh") {
  const date = new Date(`${dateStr}T00:00:00`);
  if (lang === "en") {
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  const weekLabel = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekLabel}`;
}

function getTodayKey() {
  return getDayKey(new Date());
}

export function DiaryView({ 
  highlightHistory, 
  catName = "", 
  personaName = "",
  schedule,
  onUpdateSchedule,
  onHomeClick,
  language = "zh",
  isActive = false,
}: DiaryViewProps) {
  const isEn = language === "en";
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [autoLinkedHighlightIds, setAutoLinkedHighlightIds] = useState<string[]>([]);
  const [autoLinking, setAutoLinking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState("");
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const entryByDate = useMemo(() => {
    const map = new Map<string, DiaryEntry>();
    entries.forEach((entry) => map.set(entry.date, entry));
    return map;
  }, [entries]);

  const sortedDates = useMemo(() => entries.map((entry) => entry.date).sort((a, b) => (a < b ? 1 : -1)), [entries]);
  const activeEntry = selectedDate ? entryByDate.get(selectedDate) || null : entries[0] || null;
  const linkedClips = useMemo(() => {
    if (!activeEntry) {
      return [];
    }
    const map = new Map(highlightHistory.map((clip) => [clip.id, clip]));
    return activeEntry.linkedHighlightIds.map((id) => map.get(id)).filter(Boolean) as HighlightClip[];
  }, [activeEntry, highlightHistory]);

  const todayKey = getTodayKey();
  const hasTodayEntry = !!entryByDate.get(todayKey);
  const autoLinkedClips = useMemo(() => {
    const map = new Map(highlightHistory.map((clip) => [clip.id, clip]));
    return autoLinkedHighlightIds.map((id) => map.get(id)).filter(Boolean) as HighlightClip[];
  }, [autoLinkedHighlightIds, highlightHistory]);

  useEffect(() => {
    let cancelled = false;
    loadDiaryEntries(language).then((rows) => {
      if (cancelled) {
        return;
      }
      setEntries(rows);
      setSelectedDate(rows[0]?.date || "");
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    if (isActive) {
      return;
    }
    (Object.values(videoRefs.current) as Array<HTMLVideoElement | null>).forEach((video) => {
      if (!video) {
        return;
      }
      video.onended = null;
      if (!video.paused) {
        video.pause();
      }
      if (video.currentTime > 0) {
        video.currentTime = 0;
      }
    });
  }, [isActive]);

  useEffect(() => {
    if (hasTodayEntry) {
      setAutoLinkedHighlightIds([]);
      setAutoLinking(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setAutoLinking(true);
      try {
        const materials = await getUnconsumedInteractionTexts(Date.now());
        if (cancelled) {
          return;
        }
        const nextIds = matchHighlightsForDiary(materials, highlightHistory, 3);
        setAutoLinkedHighlightIds(nextIds);
      } finally {
        if (!cancelled) {
          setAutoLinking(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [hasTodayEntry, highlightHistory]);

  const reloadEntries = async (focusDate?: string) => {
    const rows = await loadDiaryEntries(language);
    setEntries(rows);
    if (focusDate && rows.some((item) => item.date === focusDate)) {
      setSelectedDate(focusDate);
      return;
    }
    setSelectedDate(rows[0]?.date || "");
  };

  const handleGenerateDiary = async (trigger: "manual" | "scheduled") => {
    const day = getTodayKey();
    const existing = await loadDiaryByDate(day, language);
    if (existing) {
      setStatusText(isEn ? "Today's diary already exists. You can view it now." : "今天的日记已生成，可直接查看");
      setSelectedDate(existing.date);
      return;
    }
    setIsGenerating(true);
    setStatusText(
      trigger === "manual"
        ? isEn
          ? "Generating today's diary..."
          : "正在生成今日互动日记..."
        : isEn
          ? "Scheduled generation in progress..."
          : "到点自动生成中...",
    );
    try {
      const materials = await getUnconsumedInteractionTexts(Date.now());
      const linkedHighlightIds = matchHighlightsForDiary(materials, highlightHistory, 3);
      const result = await generateDiaryWithModel({
        date: day,
        catName,
        personaName: personaName || (isEn ? "Cat Diary" : "猫咪日记"),
        materials,
        linkedHighlightIds,
        language,
      });
      const entry: DiaryEntry = {
        id: `${day}-${Date.now()}`,
        date: day,
        language,
        createdAtMs: Date.now(),
        title: result.title,
        content: result.content,
        summary: result.summary,
        mood: result.mood,
        sourceTextIds: materials.map((item) => item.id),
        linkedHighlightIds,
        readAloudScript: result.readAloudScript,
      };
      await saveDiaryEntry(entry);
      await markTextsConsumedAndCleanup(materials.map((item) => item.id), day);
      const nextSchedule = { ...schedule, lastGeneratedDate: day };
      onUpdateSchedule(nextSchedule);
      setAutoLinkedHighlightIds([]);
      await reloadEntries(day);
      setStatusText(
        isEn
          ? `Diary generated successfully. Linked ${linkedHighlightIds.length} clip(s) and cleaned up text materials.`
          : `今日日记生成成功，已自动关联${linkedHighlightIds.length}段视频并清理文本素材`,
      );
    } catch {
      setStatusText(isEn ? "Generation failed. Materials were kept for retry." : "生成失败，素材已保留，可稍后重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const moveEntry = (direction: "prev" | "next") => {
    if (!activeEntry || sortedDates.length < 2) {
      return;
    }
    const idx = sortedDates.findIndex((date) => date === activeEntry.date);
    const nextIdx = direction === "prev" ? idx + 1 : idx - 1;
    if (nextIdx >= 0 && nextIdx < sortedDates.length) {
      setSelectedDate(sortedDates[nextIdx]);
    }
  };

  // Helper to render interleaved content
  const renderContent = () => {
    if (!activeEntry) return null;
    const paragraphs = activeEntry.content.split(/\n+/).filter((p) => p.trim());
    const nodes = [];
    let clipIndex = 0;
    const maxClips = 3;
    const displayClips = linkedClips.slice(0, maxClips);

    for (let i = 0; i < paragraphs.length; i++) {
       if (clipIndex < displayClips.length && (i === 0 || i % 2 === 0)) {
          const clip = displayClips[clipIndex];
          
          nodes.push(
            <div 
              key={`v-${clip.id}`} 
              className={`
                relative w-[45%] max-w-[220px] aspect-video rounded-lg overflow-hidden shadow-lg bg-black z-10
                border-[4px] border-white
                ring-1 ring-slate-900/5
                ${clipIndex % 2 === 0 ? 'float-right ml-5 mb-4 rotate-2' : 'float-left mr-5 mb-4 -rotate-2'}
                hover:scale-[1.02] transition-transform duration-300
              `}
            >
               <video
                  ref={(el) => {
                    videoRefs.current[clip.id] = el;
                  }}
                  src={clip.clipUrl}
                  className="w-full h-full object-cover"
                  controls
                  muted
                  playsInline
               />
            </div>
          );
          clipIndex++;
       }
       
       nodes.push(
         <p key={`p-${i}`} className="mb-4 text-lg leading-8 text-slate-700 mix-blend-multiply relative z-0">
           {paragraphs[i]}
         </p>
       );
    }
    
    // Append remaining videos if any
    while (clipIndex < displayClips.length) {
       const clip = displayClips[clipIndex];
       nodes.push(
          <div 
            key={`v-${clip.id}`} 
            className={`
              relative w-[45%] max-w-[220px] aspect-video rounded-lg overflow-hidden shadow-lg bg-black z-10
              border-[4px] border-white
              ${clipIndex % 2 === 0 ? 'float-right ml-5 mb-4 rotate-2' : 'float-left mr-5 mb-4 -rotate-2'}
            `}
          >
             <video
                ref={(el) => {
                  videoRefs.current[clip.id] = el;
                }}
                src={clip.clipUrl}
                className="w-full h-full object-cover"
                controls
                muted
                playsInline
             />
          </div>
       );
       clipIndex++;
    }

    nodes.push(<div key="clearfix" className="clear-both"></div>);

    return nodes;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex-none pt-safe px-4 pb-2 border-b border-white/10 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center justify-between h-12">
          <span className="flex items-center gap-2 text-white/90 font-medium">
            <span className="bg-lime-400 text-black p-1 rounded-md">
              <FolderOpen size={16} />
            </span>
            <span>{isEn ? "Cat Diary" : "猫咪日记"}</span>
          </span>
          
          <div className="flex items-center gap-4">
            {/* Removed top navigation buttons as requested */}
            <button 
              onClick={onHomeClick}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            >
              <Home size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-8 flex flex-col items-center">
        {!hasTodayEntry && !activeEntry && (
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4 mb-6 mx-auto mt-10">
             <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-white/90">{isEn ? "Generate Today's Diary" : "生成今日日记"}</div>
                <button
                  disabled={isGenerating}
                  onClick={() => handleGenerateDiary("manual")}
                  className="px-4 py-2 rounded-xl bg-lime-400 text-black text-xs font-bold disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-lime-400/20"
                >
                  {isGenerating && <Loader2 size={14} className="animate-spin" />}
                  {isGenerating ? (isEn ? "Generating..." : "正在生成...") : isEn ? "Generate Now" : "立即生成"}
                </button>
              </div>
              
            {autoLinking ? (
              <p className="text-xs text-white/50 text-center py-4">{isEn ? "Matching text with video timeline..." : "正在匹配文本与视频时间轴..."}</p>
            ) : autoLinkedClips.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-white/50">{isEn ? "Linked Clips" : "已关联素材"}</div>
                <div className="grid grid-cols-3 gap-2">
                  {autoLinkedClips.map((clip) => (
                    <div key={clip.id} className="aspect-video rounded-lg overflow-hidden bg-black/40 border border-white/10 relative">
                      <video src={clip.clipUrl} className="w-full h-full object-cover opacity-60" muted playsInline />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
               <div className="text-xs text-white/40 text-center py-2">
                 {isEn ? "No linked videos. The diary will be generated from text only." : "暂无关联视频，将基于纯文本生成"}
               </div>
            )}
            {statusText && <p className="text-xs text-lime-400/80 text-center">{statusText}</p>}
          </div>
        )}

        {activeEntry ? (
          <div className="w-full max-w-2xl relative my-auto">
             {/* Pagination Dots - Top or Bottom? User said "Diary below two small dots". 
                 Let's put it at the bottom. But we need to handle "slide". 
                 We can simulate slide with a range input or just buttons.
             */}

            <div className="bg-[#Fdfdfd] text-slate-800 rounded-r-2xl rounded-l-md shadow-[0_18px_40px_rgba(15,23,42,0.32)] border-r border-t border-b border-white/70 overflow-hidden min-h-[60vh] relative flex flex-col">
              
              {/* Binder Holes */}
              <div className="absolute left-0 top-0 bottom-0 w-12 bg-slate-100 border-r border-slate-200/50 z-20 flex flex-col justify-evenly items-center py-8 shadow-[inset_-10px_0_20px_rgba(0,0,0,0.02)]">
                 {[1, 2, 3, 4].map(i => (
                   <div key={i} className="w-3.5 h-3.5 rounded-full bg-zinc-800 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)] ring-1 ring-white/50 relative">
                     {/* Hole shine */}
                     <div className="absolute top-1 left-1 w-1 h-1 rounded-full bg-white/10"></div>
                   </div>
                 ))}
              </div>

              {/* Page Turn Buttons - Inside the book */}
              <button 
                onClick={() => moveEntry("prev")} 
                className="absolute left-14 top-1/2 -translate-y-1/2 z-30 p-2 text-slate-300 hover:text-slate-500 transition-colors disabled:opacity-0"
                disabled={sortedDates.indexOf(selectedDate) >= sortedDates.length - 1}
              >
                <ChevronLeft size={24} />
              </button>
              <button 
                onClick={() => moveEntry("next")} 
                className="absolute right-2 top-1/2 -translate-y-1/2 z-30 p-2 text-slate-300 hover:text-slate-500 transition-colors disabled:opacity-0"
                disabled={sortedDates.indexOf(selectedDate) <= 0}
              >
                <ChevronRight size={24} />
              </button>


              <div className="px-8 pl-16 py-6 border-b border-slate-200 flex items-center justify-between bg-slate-50 relative">
                 <div className="flex flex-col">
                   <h2 className="text-xl font-bold text-slate-800">{activeEntry.title}</h2>
                   <p className="text-xs text-slate-500 mt-1">{getDayLabelByLanguage(activeEntry.date, language)} · {activeEntry.mood || (isEn ? "Feeling good" : "心情不错")}</p>
                 </div>
                 
                 <div className="relative group cursor-pointer">
                   <div className="flex items-center gap-1.5 text-slate-400 hover:text-lime-600 transition-colors">
                      <span className="font-serif text-lg font-bold tracking-wider">
                        {activeEntry.date.replace(/-/g, "/")}
                      </span>
                      <CalendarDays size={18} />
                   </div>
                   <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      if (e.target.value) {
                         setSelectedDate(e.target.value);
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                   />
                 </div>
              </div>
              
              {/* Paper Content */}
              <div 
                className="flex-1 p-8 pl-16 text-base font-serif relative"
                style={{
                  backgroundImage: "linear-gradient(#e2e8f0 1px, transparent 1px)",
                  backgroundSize: "100% 2rem",
                  backgroundAttachment: "local",
                  lineHeight: "2rem"
                }}
              >
                {renderContent()}
              </div>

            </div>

            {/* Pagination Dots Slider */}
            <div className="py-6 flex justify-center items-center gap-4">
               {/* Visual representation of dots that can be "slid" */}
               <div className="bg-zinc-900/50 rounded-full p-1 flex items-center gap-2 backdrop-blur-md border border-white/10">
                 {/* 
                    We show a few dots representing pages. 
                    If many pages, maybe just 3 dots with active one.
                    User said "below two small dots".
                    Maybe strictly 2 dots?
                    Let's show indicators for current/total or just prev/next?
                    "two small dots can slide left and right" -> Sounds like a specific UI control.
                    I'll implement a simple dot indicator for the list.
                 */}
                 {sortedDates.map((date, idx) => {
                    // Only show a window of dots if too many?
                    // For now, let's just show max 5 dots centered around active.
                    const activeIdx = sortedDates.findIndex(d => d === selectedDate);
                    if (Math.abs(activeIdx - idx) > 2) return null;
                    
                    return (
                      <button 
                        key={date}
                        onClick={() => setSelectedDate(date)}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                          date === selectedDate ? 'bg-lime-400 w-6' : 'bg-white/20 hover:bg-white/40'
                        }`}
                      />
                    );
                 })}
               </div>
            </div>

          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-white/35 gap-4 py-24">
             <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
              <FolderOpen size={40} />
            </div>
            <p className="text-sm font-medium">{isEn ? "No diary content yet" : "还没有日记内容"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
