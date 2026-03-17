# 移动端音频稳定性监控清单

## 关键指标

- `session_started` 成功率（按平台分组：iOS Safari / Android Chrome）
- `audio_output_recovery_triggered` 触发率
- `getUserMedia` 失败率（按错误码：NotAllowedError / NotReadableError / SecurityError）
- 会话建立后 10 秒内无首帧音频比例

## 采集要求

- 每条日志必须携带：平台、浏览器、系统版本、网络类型、模型名
- 线上按 5 分钟窗口聚合，保留 p50/p95

## 告警阈值

- 任一平台 `audio_output_recovery_triggered` > 5% 持续 15 分钟
- `NotAllowedError` 较过去 24 小时均值上升 3 倍
- 会话建立后无首帧音频比例 > 2%

## 处置流程

- 先确认 HTTPS 与媒体权限状态
- 再确认设备输入输出路由（耳机/扬声器）与系统音量
- 抽样核查 `useLiveAPI` 日志：是否出现 camera-only 提示或恢复触发
