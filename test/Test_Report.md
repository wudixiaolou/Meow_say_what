# Test Summary Report

- 执行时间：2026-03-17T05:37:11.728681
- 目标地址：https://localhost:3000/
- 产物目录：test/artifacts/audio_dual_voice/20260317_053640

## 用例执行结果

| 用例ID | 场景 | 重叠时长(ms) | 控制台错误数 | 结论 |
|---|---|---:|---:|---|
| TC-AUDIO-001 | 单轮对话 | 0.0 | 0 | PASS |
| TC-AUDIO-002 | 多轮连续对话 | 0.0 | 0 | PASS |
| TC-AUDIO-003 | 打断场景 | 8.0 | 0 | PASS |
| TC-AUDIO-004 | 网络抖动模拟 | 0.0 | 0 | PASS |
| TC-AUDIO-005 | 并发事件通知音 | 0.0 | 0 | PASS |

## 失败用例波形对比

- 无失败用例

## 修复建议

- 在Live连接建立与回切时统一执行全局音频仲裁，强制cancel非Agent流。
- 在AudioStreamer与TTS入口统一接入单通道锁并记录抢占日志。
- 在打断链路加入毫秒级停播确认信号，超过50ms即告警。
