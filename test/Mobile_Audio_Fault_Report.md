# 移动端语音无声故障定位与修复报告

## 1. 故障现象

- 现象：移动端进入实时会话后，Agent对话响应弱或无响应，且无语音输出。
- 现场线索：页面出现“Mobile safe mode: camera-only permission is enabled.”，说明会话退化到仅摄像头模式。

## 2. 全链路排查流程

### 2.1 硬件与驱动层

- 检查手机系统是否可在“语音备忘录/录音机”正常录音。
- 检查蓝牙耳机/有线耳机切换后系统默认输出设备是否正常。
- 检查设备静音开关、媒体音量、应用音量限制。

### 2.2 操作系统音频服务层

- iOS：设置 -> Safari -> 麦克风/相机权限为允许；关闭“静音模式”后复测。
- Android：设置 -> 应用 -> Chrome -> 权限 -> 麦克风/相机为允许；关闭系统级“禁止后台录音”策略。
- 网络切换后重新确认权限未被系统回收。

### 2.3 浏览器权限与WebRTC层

- 验证 `navigator.mediaDevices.getUserMedia` 可用，且返回流包含 live 音频轨。
- 验证 HTTPS 安全上下文（非安全上下文下浏览器会阻断媒体权限）。
- 对 NotAllowedError / SecurityError 输出明确错误，不再静默降级为仅摄像头模式。

### 2.4 应用音频输出层

- 在连接前初始化并恢复 `AudioContext`，避免移动端手势上下文丢失后的静默播放失败。
- 会话中监控“模型文本已返回但音频流长时间未到达”并自动尝试恢复输出。

### 2.5 接口与服务层

- 检查 `/api/health` 状态，确认后端降级状态是否影响增强链路。
- 检查 Live 连接建立、onmessage音频片段分发、播放缓冲状态。

## 3. 根因结论

- 根因1：移动端默认被置为 camera-only，麦克风不上行，语音对话链路被切断。
- 根因2：音频输出初始化时机偏后，在移动端易出现 AudioContext 未激活导致无声。
- 根因3：移动端未统一注入 speechConfig，语音输出配置不一致，稳定性不足。

## 4. 修复方案

- 修复A：移除“移动端默认仅摄像头”策略，仅在 `qaVideoOnly=1` 时禁用麦克风。
- 修复B：连接前强制初始化并 `resume` AudioStreamer，失败时给出明确可恢复提示。
- 修复C：非 native-audio 模型统一设置 speechConfig（language + voice）。
- 修复D：新增音频健康监控，检测输出停滞并自动触发恢复动作。
- 修复E：若无活跃音频轨且未显式 qaVideoOnly，直接报错并终止连接，避免假连接。

## 5. 回归测试用例

- 自动化：`python -m pytest test/pytest_audio_dual_voice_chrome.py -q`
- 移动矩阵：
  - iOS Safari（iPhone 13/14/15）Wi-Fi 单轮/多轮/打断
  - Android Chrome（Pixel/Samsung）Wi-Fi 单轮/多轮/打断
  - iOS/Android 4G/5G 高延迟
  - 200ms延迟 + 5%丢包
  - Wi-Fi 与蜂窝网络切换

## 6. 当前验证结果

- `npm run lint`：通过
- `npm run build`：通过
- `python -m pytest test/pytest_audio_dual_voice_chrome.py -q`：6 passed, 1 skipped

## 7. 监控与防复发机制

- 监控项：
  - 会话建立成功率
  - getUserMedia权限失败率（按错误类型分组）
  - 无活跃音频轨失败率
  - 音频输出恢复触发次数（audio_output_recovery_triggered）
- 告警建议：
  - 任一机型输出恢复触发率 > 5% 持续 15 分钟触发告警
  - NotAllowedError / SecurityError 异常突增触发权限引导策略回归检查
