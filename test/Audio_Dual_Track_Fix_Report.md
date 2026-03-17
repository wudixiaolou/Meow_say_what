# Agent 模式双音轨问题修复报告

## 1. 复现步骤

1. 启动应用并进入 Live 会话
2. 切换到“日记本”并点击“听日记”（触发 TTS）
3. 不等待朗读结束，立即切回 Live 并开始语音交互
4. 观察是否出现 TTS 与 Live PCM 同时播放

## 2. 根因定位

- 缺少统一音频焦点仲裁，多个音源并发竞争播放权：
  - Live PCM（AudioContext）
  - Diary TTS（speechSynthesis）
  - 猫叫音效（HTMLAudioElement）
- 旧实现为“分散 cancel”，在异步时序下存在竞态窗口。
- 未对媒体 `play` 事件做会话期互斥拦截，外部媒体可插入播放。

## 3. 代码级修复

- 新增全局音频焦点管理器，确保同一时刻只有一个 owner：
  - `src/lib/audioFocus.ts`
- Live 输出接入焦点并在中断/停止时释放：
  - `src/lib/audio.ts`
- 猫叫音效接入焦点，结束/异常/手动停止都释放：
  - `src/lib/catSounds.ts`
- 日记 TTS 接入焦点，并在切页/停止时强制释放：
  - `src/components/DiaryView.tsx`
- Live 会话期间新增媒体播放守卫（拦截冲突音频）：
  - `src/hooks/useLiveAPI.ts`

## 4. 日志采集方案

- 控制台采集焦点日志：
  - `window.__audioFocusDebug?.slice(-50)`
- 自动化采集：
  - `node test/audio_dual_voice.chrome.mjs`
  - `python -m pytest test/pytest_audio_dual_voice_chrome.py -q`
- 关键字段：
  - `failedCount`、`maxConcurrent`、`concurrentNow`、`cancelCount`

## 5. 自动化测试结果

- 单元测试（焦点互斥）：
  - `npm run test:audio:unit` -> 3 passed
- 集成测试（Chrome 双音轨场景）：
  - `npm run test:audio:integration` -> failedCount=0
- 回归测试（语音双声+无声风险）：
  - `python -m pytest test/pytest_audio_dual_voice_chrome.py -q` -> 6 passed, 1 skipped
- 工程校验：
  - `npm run lint` -> pass
  - `npm run build` -> pass

## 6. 防复发机制

- 所有音源统一进入 Audio Focus 竞争模型
- Live 会话开启后，媒体守卫拦截非会话媒体的 `play`
- 保留音频恢复探针，避免“修双声引发无声”回归
