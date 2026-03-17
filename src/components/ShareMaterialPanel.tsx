import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, FolderOpen, X, Camera, ChevronLeft, Megaphone } from "lucide-react";
import { AppLanguage, HighlightClip } from "../types";
import { pickSelectedClip } from "../lib/highlightClip";

function groupClips(clips: HighlightClip[], language: AppLanguage) {
  const sorted = [...clips].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const now = new Date();
  
  const groups: { label: string; clips: HighlightClip[] }[] = [];
  const thisWeekClips: HighlightClip[] = [];
  const olderClips = new Map<string, HighlightClip[]>();

  sorted.forEach(clip => {
     const diffTime = now.getTime() - clip.createdAt.getTime();
     const diffDays = diffTime / (1000 * 60 * 60 * 24);
     
     if (diffDays <= 7) {
       thisWeekClips.push(clip);
     } else {
       const month = clip.createdAt.getMonth() + 1;
      const label = language === "zh" ? `${month}月` : new Intl.DateTimeFormat("en-US", { month: "long" }).format(clip.createdAt);
       if (!olderClips.has(label)) {
         olderClips.set(label, []);
       }
       olderClips.get(label)?.push(clip);
     }
  });
  
  if (thisWeekClips.length > 0) {
    groups.push({ label: language === "zh" ? "本周" : "This Week", clips: thisWeekClips });
  }
  
  olderClips.forEach((clips, label) => {
    groups.push({ label, clips });
  });
  
  return groups;
}

interface CaptureControlsProps {
  autoCaptureEnabled: boolean;
  onToggleAutoCapture: () => void;
  onManualCapture: () => void;
  highlightHistory: HighlightClip[];
  disabled?: boolean;
  language?: AppLanguage;
}

export function CaptureControls({
  autoCaptureEnabled,
  onToggleAutoCapture,
  onManualCapture,
  highlightHistory,
  disabled = false,
  language = "zh",
}: CaptureControlsProps) {
  const isEn = language === "en";
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSpeakerVisible, setIsSpeakerVisible] = useState(true);

  // Speaker button animation
  useEffect(() => {
    const show = () => {
      setIsSpeakerVisible(true);
      setTimeout(() => setIsSpeakerVisible(false), 3000);
    };
    // Initial delay then start loop
    const initialHide = setTimeout(() => setIsSpeakerVisible(false), 3000);
    const timer = setInterval(show, 8000); // 3s show + 5s hide = 8s cycle
    return () => {
      clearTimeout(initialHide);
      clearInterval(timer);
    };
  }, []);

  if (disabled) {
    return (
      <div className="absolute right-6 bottom-28 z-50 flex flex-col items-end gap-3 opacity-50 pointer-events-none grayscale">
        <button
          className="w-12 h-12 rounded-full flex items-center justify-center bg-black/45 text-white/50 backdrop-blur-md border border-white/10 shadow-lg"
        >
          <Camera size={22} />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute right-6 bottom-16 z-50 flex flex-col items-end gap-4 pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-end gap-3">
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-64 rounded-2xl border border-white/10 bg-black/45 backdrop-blur-md p-3 space-y-3 shadow-2xl origin-bottom-right"
            >
              <div className="text-xs text-white/80 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Sparkles size={13} className="text-lime-300" />
                  {isEn ? "Smart capture is running" : "智能捕捉后台运行中"}
                </span>
                <button
                  onClick={onToggleAutoCapture}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    autoCaptureEnabled ? "bg-emerald-400 text-black" : "bg-white/10 text-white"
                  }`}
                >
                  {isEn ? `Auto Capture ${autoCaptureEnabled ? "On" : "Off"}` : `自动抓拍 ${autoCaptureEnabled ? "开" : "关"}`}
                </button>
              </div>
              
              <button
                onClick={() => {
                  onManualCapture();
                  setIsExpanded(false);
                }}
                className="w-full px-3 py-2 text-xs rounded-xl bg-lime-400 text-black font-semibold hover:bg-lime-300 transition-colors flex items-center justify-center gap-1"
              >
                <Sparkles size={14} />
                {isEn ? "Manual Capture" : "手动抓拍"}
              </button>
              
              <div className="text-[10px] text-white/55 leading-relaxed flex justify-between">
                <span>{isEn ? "Capture triggers on high-confidence events" : "抓拍仅在高置信事件命中时触发"}</span>
                {highlightHistory.length > 0 && (
                  <span className="text-lime-400 font-medium">
                    {isEn ? `${highlightHistory.length} moments captured` : `已抓拍 ${highlightHistory.length} 个瞬间`}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors shadow-lg border border-white/10 relative ${
            isExpanded ? "bg-white/20 text-white" : "bg-black/45 text-lime-400 backdrop-blur-md hover:bg-black/60"
          }`}
        >
          {isExpanded ? <X size={20} /> : <Camera size={22} />}
          {!isExpanded && autoCaptureEnabled && (
            <span className="absolute top-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-zinc-950 rounded-full"></span>
          )}
        </button>
      </div>

      {/* Floating Speaker Button - Now integrated directly below camera button */}
      <div className="h-12 w-12 flex items-center justify-center pointer-events-auto">
        <AnimatePresence>
          {isSpeakerVisible && (
            <motion.button
              initial={{ opacity: 0, scale: 0, rotate: -45 }}
              animate={{ 
                opacity: 1, 
                scale: 1, 
                rotate: [0, -10, 10, -10, 10, 0], // Shake animation
              }}
              exit={{ opacity: 0, scale: 0, rotate: 45 }}
              transition={{ 
                duration: 0.5,
                rotate: {
                  repeat: 2,
                  repeatType: "mirror",
                  duration: 0.3,
                  ease: "easeInOut",
                  delay: 0.2
                }
              }}
              className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shadow-lg text-white border border-white/20"
              aria-label="Speaker"
            >
              <Megaphone size={18} fill="currentColor" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface GalleryViewProps {
  highlightClip: HighlightClip | null;
  highlightHistory: HighlightClip[];
  language?: AppLanguage;
}

export function GalleryView({
  highlightClip,
  highlightHistory,
  language = "zh",
}: GalleryViewProps) {
  const isEn = language === "en";
  const [selectedClipId, setSelectedClipId] = useState("");
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

  const selectedClip = useMemo(() => {
    return pickSelectedClip(highlightClip, highlightHistory, selectedClipId);
  }, [highlightClip, highlightHistory, selectedClipId]);

  const clipGroups = useMemo(() => groupClips(highlightHistory, language), [highlightHistory, language]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      {viewMode === 'list' && (
        <>
          {/* Gallery Header with Navigation */}
          <div className="flex-none pt-4 px-4 pb-0 border-b border-white/10 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-6 text-sm font-medium">
              <span className="pb-3 border-b-2 border-lime-400 text-lime-400">
                {isEn ? "Video Clips" : "视频片段库"}
                {highlightHistory.length > 0 && (
                  <span className="ml-2 text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full text-white/70">
                    {highlightHistory.length}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
            {clipGroups.length > 0 ? (
              <div className="space-y-6">
                {clipGroups.map((group) => (
                  <div key={group.label} className="space-y-3">
                    <div className="text-xl font-bold text-white px-1">{group.label}</div>
                    <div className="grid grid-cols-3 gap-1">
                      {group.clips.map((clip) => (
                        <button
                          key={clip.id}
                          onClick={() => {
                            setSelectedClipId(clip.id);
                            setViewMode('detail');
                          }}
                          className="aspect-square relative overflow-hidden bg-zinc-900"
                        >
                          <video src={clip.clipUrl} className="w-full h-full object-cover" muted playsInline />
                          <div className="absolute inset-0 bg-black/10 hover:bg-black/0 transition-colors" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-white/30 space-y-4">
                <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
                  <FolderOpen size={32} />
                </div>
                <p className="text-sm">{isEn ? "No clips yet, capture one now!" : "暂无素材，快去抓拍吧！"}</p>
              </div>
            )}
          </div>
        </>
      )}

      {viewMode === 'detail' && selectedClip && (
        <div className="flex flex-col h-full animate-in slide-in-from-right duration-300 bg-zinc-950 absolute inset-0 z-20">
          <div className="flex-1 relative flex items-center justify-center bg-black">
            <video
              key={selectedClip.id}
              src={selectedClip.clipUrl}
              className="max-h-full max-w-full object-contain"
              controls
              autoPlay
              playsInline
              muted
            />
            
            {/* Overlay Controls */}
            <div className="absolute top-4 left-4 z-10">
              <button 
                onClick={() => setViewMode('list')}
                className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/90 hover:bg-black/60 transition-colors border border-white/10"
              >
                <ChevronLeft size={24} />
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
