# 双重声音问题调试与验证指南

## 1. 复现步骤

1. 打开 Live 页面并连接会话
2. 切到日记页触发“听日记”
3. 立即切回 Live 持续说话触发 Agent 回复
4. 观察是否出现两路同时发声

## 2. 日志采集方法

### 浏览器控制台

- 查看音频焦点事件：
```js
window.__audioFocusDebug?.slice(-50)
```
- 预期行为：
  - 只存在一个 owner 持有焦点
  - `focus_preempt` 应成对出现，表示旧音源被新音源抢占

### 自动化脚本

- 运行：
```bash
node test/audio_dual_voice.chrome.mjs
python -m pytest test/pytest_audio_dual_voice_chrome.py -q
```
- 重点字段：
  - `failedCount`
  - `maxConcurrent`
  - `cancelCount`

## 3. 根因判定准则

- 若 `focus_preempt` 缺失且同时存在 `tts_speak` 与 live PCM 数据流，说明焦点仲裁未生效
- 若 `maxConcurrent > 1`，说明存在并发播放
- 若 `cancelCount` 不增长，说明切换时旧 TTS 未被停止

## 4. 修复后验收标准

- 任意时刻仅一个音频 owner
- `maxConcurrent <= 1`
- 日记朗读切回 Live 后 `speechSynthesis.speaking` 快速变为 false
- 不出现“无声”回归：Live 文本输出后 7 秒内有音频输出或触发恢复日志
