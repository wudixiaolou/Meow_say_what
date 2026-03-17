import { useState, useRef } from "react";
import { PERSONAS } from "./constants";
import { PersonaSelector } from "./components/PersonaSelector";
import { CaptureControls, GalleryView } from "./components/ShareMaterialPanel";
import { DiaryView } from "./components/DiaryView";
import { SettingsView } from "./components/SettingsView";
import { TranslationBubble } from "./components/TranslationBubble";
import { CoverPage } from "./components/CoverPage";
import { OnboardingPage } from "./components/OnboardingPage";
import { useLiveAPI } from "./hooks/useLiveAPI";
import { useDiarySchedule } from "./hooks/useDiarySchedule";
import { InteractionMode, AppLanguage } from "./types";
import { Square, Camera, X, Settings2, MessageCircle, Image as ImageIcon, BookOpenText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [view, setView] = useState<'cover' | 'onboarding' | 'main'>('cover');
  const [userProfile, setUserProfile] = useState<{ role: 'dad' | 'mom' | null; catName: string }>({ role: null, catName: '' });
  const [persona, setPersona] = useState(PERSONAS[0]);
  const [mode, setMode] = useState<InteractionMode>(() => {
    const saved = window.localStorage.getItem("meowlingo_mode");
    return saved === "qa" ? "qa" : "narration";
  });
  const [language, setLanguage] = useState<AppLanguage>(() => {
    return (window.localStorage.getItem("meowlingo_lang") as AppLanguage) || "zh";
  });
  const [activeTab, setActiveTab] = useState<'live' | 'gallery' | 'diary' | 'settings'>('live');
  const videoRef = useRef<HTMLVideoElement>(null);
  const { schedule, updateSchedule } = useDiarySchedule();

  const {
    isConnected,
    isConnecting,
    transcript,
    connect,
    disconnect,
    logs,
    highlightClip,
    highlightHistory,
    autoCaptureEnabled,
    backendDegraded,
    toggleAutoCapture,
    triggerManualCapture,
    errorMessage,
    clearError,
  } =
    useLiveAPI(persona, mode, videoRef, userProfile, language);

  const handlePersonaSelect = (p: typeof PERSONAS[0]) => {
    setPersona(p);
    if (isConnected) {
      disconnect();
      setTimeout(() => connect(), 500);
    }
  };

  const toggleLanguage = () => {
    const next = language === "zh" ? "en" : "zh";
    setLanguage(next);
    window.localStorage.setItem("meowlingo_lang", next);
  };

  const handleModeSwitch = (nextMode: InteractionMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    window.localStorage.setItem("meowlingo_mode", nextMode);
    if (isConnected) {
      disconnect();
      setTimeout(() => connect(), 500);
    }
  };

  return (
    <div className="relative w-full h-[100dvh] bg-zinc-950 overflow-hidden font-sans flex flex-col">
      {view === 'cover' && <CoverPage onStart={() => setView('onboarding')} />}
      {view === 'onboarding' && <OnboardingPage onNext={(data) => { setUserProfile(data); setView('main'); }} />}

      {/* Video Background - Always present but maybe covered */}
      <div className="absolute inset-0 w-full h-full">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Dark overlay for non-live modes */}
        <div 
          className={`absolute inset-0 bg-zinc-950/90 backdrop-blur-sm transition-opacity duration-300 ${
            activeTab !== 'live' ? 'opacity-100 z-20' : 'opacity-0 pointer-events-none z-0'
          }`} 
        />
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 w-full overflow-hidden z-30">
        
        {/* Live Tab Content */}
        <div 
          className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${
            activeTab === 'live' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Top Bar */}
          {(isConnected || isConnecting) && (
            <div className="p-6 flex justify-between items-start">
              <div className="flex flex-col gap-2">
                <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
                  <span className="text-lime-400 font-display font-bold">喵语通</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] font-medium text-white/80">LIVE</span>
                    {backendDegraded && (
                      <span className="text-[10px] font-medium text-lime-300 border border-lime-300/40 bg-lime-300/10 px-1.5 py-0.5 rounded-full">
                        降级
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Center Area (Translations Hint) */}
          <div className="flex-1 relative flex flex-col justify-end p-6 pb-4">
            {!isConnected && !isConnecting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-40">
                <motion.button
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    clearError();
                    connect();
                  }}
                  className="w-24 h-24 bg-lime-400/20 rounded-full flex items-center justify-center mb-6 backdrop-blur-md border border-lime-400/30 cursor-pointer hover:bg-lime-400/30 transition-colors"
                >
                  <Camera size={40} className="text-lime-400" />
                </motion.button>
                <p className="text-white font-medium text-lg mb-2">点击开始体验</p>
              </div>
            )}
          </div>

          {isConnected && (
            <div className="absolute left-4 bottom-36 z-20 w-[78%] max-w-md h-36 overflow-hidden pointer-events-none">
              <div className="flex h-full flex-col justify-end gap-2">
                <AnimatePresence initial={false}>
                  {logs.slice(-8).map((log, i) => (
                    <motion.div
                      key={`${log.timestamp.getTime()}-${i}`}
                      initial={{ opacity: 0, y: 24, filter: "blur(2px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -18, filter: "blur(2px)" }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                      className="text-xs sm:text-sm text-white/90 leading-relaxed drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] max-w-[95%]"
                    >
                      {log.text}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Floating Speaker Button - Positioned relative to Live Tab */}
          {/* Moved to root level for visibility debugging */}

          {/* Bottom Controls Area */}
          {(isConnected || isConnecting) && (
            <div className="px-6 pb-24 flex flex-col items-center gap-4 pt-10">
              <CaptureControls
                autoCaptureEnabled={autoCaptureEnabled}
                onToggleAutoCapture={toggleAutoCapture}
                onManualCapture={triggerManualCapture}
                highlightHistory={highlightHistory}
                disabled={!isConnected}
              />

              <div className="bg-black/40 backdrop-blur-md p-1 rounded-full border border-white/10 flex items-center gap-1 w-fit z-10 pointer-events-auto">
                <button
                  onClick={() => handleModeSwitch("narration")}
                  className={`px-3 py-1.5 rounded-full text-[11px] transition-colors ${
                    mode === "narration" ? "bg-lime-400 text-black font-semibold" : "text-white/75"
                  }`}
                >
                  碎碎念
                </button>
                <button
                  onClick={() => handleModeSwitch("qa")}
                  className={`px-3 py-1.5 rounded-full text-[11px] transition-colors ${
                    mode === "qa" ? "bg-lime-400 text-black font-semibold" : "text-white/75"
                  }`}
                >
                  一问一答
                </button>
              </div>

              <div className="w-full max-w-md pointer-events-none flex flex-col items-start mb-4">
                <AnimatePresence mode="wait">
                  <motion.div
                    key="live-hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-white/60 mt-1 px-1 text-left drop-shadow-md"
                  >
                    {mode === "narration"
                      ? "自动翻译进行中，你可随时打断提问"
                      : "一问一答模式：可随时提问，结合动作与意图回答"}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="w-full max-w-md flex justify-center pt-2">
                <div className="flex items-center gap-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-lime-400 rounded-full animate-ping opacity-20"></div>
                    <button
                      onClick={disconnect}
                      className="w-16 h-16 rounded-full bg-lime-400 flex items-center justify-center hover:bg-lime-300 transition-colors shadow-[0_0_30px_rgba(251,191,36,0.3)] relative z-10"
                    >
                      <Square size={24} fill="black" className="text-black" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Gallery Tab Content */}
        <div 
          className={`absolute inset-0 transition-opacity duration-300 ${
            activeTab === 'gallery' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <GalleryView
            highlightClip={highlightClip}
            highlightHistory={highlightHistory}
          />
        </div>

        {/* Diary Tab Content */}
        <div 
          className={`absolute inset-0 transition-opacity duration-300 ${
            activeTab === 'diary' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <DiaryView
            highlightHistory={highlightHistory}
            catName={userProfile.catName}
            schedule={schedule}
            onUpdateSchedule={updateSchedule}
            onHomeClick={() => setActiveTab("live")}
            language={language}
            isActive={activeTab === "diary"}
          />
        </div>

        {/* Settings Tab Content */}
        <div 
          className={`absolute inset-0 transition-opacity duration-300 ${
            activeTab === 'settings' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <SettingsView
             personas={PERSONAS}
             selectedPersona={persona}
             onSelectPersona={handlePersonaSelect}
             schedule={schedule}
             onUpdateSchedule={updateSchedule}
             language={language}
             onToggleLanguage={toggleLanguage}
          />
        </div>
      </div>

      {/* Bottom Tab Bar */}
      <div className="relative z-40 bg-zinc-950 border-t border-white/10 pb-safe pt-2 px-6">
        <div className="flex justify-between items-center max-w-md mx-auto">
          <button
            onClick={() => setActiveTab('live')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-300 ${
              activeTab === 'live' 
                ? 'text-lime-400 -translate-y-3 bg-zinc-900 border border-white/10 shadow-[0_0_20px_rgba(163,230,53,0.15)]' 
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <div className={`p-1.5 rounded-full ${activeTab === 'live' ? 'bg-lime-400/10' : ''}`}>
              <MessageCircle size={24} fill={activeTab === 'live' ? "currentColor" : "none"} />
            </div>
            <span className="text-[10px] font-medium">实时翻译</span>
          </button>

          <button
            onClick={() => setActiveTab('gallery')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-300 relative ${
              activeTab === 'gallery' 
                ? 'text-lime-400 -translate-y-3 bg-zinc-900 border border-white/10 shadow-[0_0_20px_rgba(163,230,53,0.15)]' 
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <div className={`p-1.5 rounded-full ${activeTab === 'gallery' ? 'bg-lime-400/10' : ''}`}>
              <ImageIcon size={24} fill={activeTab === 'gallery' ? "currentColor" : "none"} />
            </div>
            <span className="text-[10px] font-medium">精彩瞬间</span>
            {highlightHistory.length > 0 && activeTab !== 'gallery' && (
              <span className="absolute top-2 right-3 w-2 h-2 bg-red-500 rounded-full ring-2 ring-zinc-950" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('diary')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-300 ${
              activeTab === 'diary' 
                ? 'text-lime-400 -translate-y-3 bg-zinc-900 border border-white/10 shadow-[0_0_20px_rgba(163,230,53,0.15)]' 
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <div className={`p-1.5 rounded-full ${activeTab === 'diary' ? 'bg-lime-400/10' : ''}`}>
              <BookOpenText size={24} />
            </div>
            <span className="text-[10px] font-medium">日记本</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-300 ${
              activeTab === 'settings' 
                ? 'text-lime-400 -translate-y-3 bg-zinc-900 border border-white/10 shadow-[0_0_20px_rgba(163,230,53,0.15)]' 
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <div className={`p-1.5 rounded-full ${activeTab === 'settings' ? 'bg-lime-400/10' : ''}`}>
              <Settings2 size={24} />
            </div>
            <span className="text-[10px] font-medium">设置</span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-zinc-900 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 border border-red-500/30 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-red-300">连接失败</h2>
                <button
                  onClick={clearError}
                  className="p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">{errorMessage}</p>
              <button
                onClick={() => {
                  clearError();
                  connect();
                }}
                disabled={isConnecting}
                className="mt-5 w-full bg-lime-400 text-black py-3 rounded-full font-bold hover:bg-lime-300 transition-colors disabled:opacity-50"
              >
                {isConnecting ? "重连中..." : "立即重试"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
