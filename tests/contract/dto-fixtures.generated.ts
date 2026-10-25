// GENERATED FILE — do not edit by hand.
// Produced by `UPDATE_CONTRACT_FIXTURES=1 cargo test --lib contract_fixtures`
// (src-tauri/src/contract_fixtures.rs) from the Rust DTOs exactly as serde puts
// them on the IPC wire. `pnpm typecheck` verifies every sample against the TS DTO:
// a renamed, missing or extra field fails the build (2026-10 review §5.2).
import type {
  AudioStartResultDto,
  CaptureRequestDto,
  CaptureResultDto,
  DiagnosticsSnapshotDto,
  LlmCancelRequestDto,
  LlmChunkDto,
  LlmStreamRequestDto,
  OcrRequestDto,
  OcrResultDto,
  SecretHasResultDto,
  SecretKeyRequestDto,
  SecretSetRequestDto,
  TranscribeResultDto,
  TrayActionPayloadDto,
} from '@/core/contracts/dto';

export const captureRequest: CaptureRequestDto = {
  "displayIndex": 1,
  "displayName": "\\\\.\\DISPLAY2",
  "region": {
    "height": 200,
    "width": 300,
    "x": 10,
    "y": 20
  },
  "target": "active-window"
};

export const captureResult: CaptureResultDto = {
  "capturedAt": 1700000000000,
  "height": 882,
  "imageBase64": "QUJD",
  "source": "window",
  "width": 1568
};

export const ocrRequest: OcrRequestDto = {
  "imageBase64": "QUJD",
  "languages": [
    "en",
    "ru"
  ]
};

export const ocrResult: OcrResultDto = {
  "boxes": [
    {
      "box": {
        "height": 200,
        "width": 300,
        "x": 10,
        "y": 20
      },
      "confidence": 0.5,
      "text": "fn"
    }
  ],
  "fullText": "fn main"
};

export const llmStreamRequest: LlmStreamRequestDto = {
  "maxImageEdge": 1568,
  "messages": [
    {
      "parts": [
        {
          "kind": "text",
          "text": "sys"
        }
      ],
      "role": "system"
    },
    {
      "cache": true,
      "parts": [
        {
          "imageBase64": "QUJD",
          "kind": "image"
        },
        {
          "kind": "text",
          "text": "q"
        }
      ],
      "role": "user"
    },
    {
      "parts": [
        {
          "kind": "text",
          "text": "a"
        }
      ],
      "role": "assistant"
    }
  ],
  "model": "anthropic/claude-haiku-4.5",
  "reasoningEffort": "medium",
  "requestId": "req-1",
  "temperature": 0.3
};

export const llmCancelRequest: LlmCancelRequestDto = {
  "requestId": "req-1"
};

export const llmChunkTextDelta: LlmChunkDto = {
  "delta": "hi",
  "type": "text-delta"
};

export const llmChunkFinish: LlmChunkDto = {
  "model": "anthropic/claude-haiku-4.5",
  "reason": "stop",
  "type": "finish",
  "usage": {
    "cachedTokens": 4096,
    "cost": 0.0021,
    "inputTokens": 12,
    "outputTokens": 34
  }
};

export const llmChunkFinishMinimal: LlmChunkDto = {
  "reason": "cancelled",
  "type": "finish"
};

export const llmChunkError: LlmChunkDto = {
  "message": "boom",
  "retryable": true,
  "type": "error"
};

export const secretKeyRequest: SecretKeyRequestDto = {
  "key": "openrouter.api_key"
};

export const secretHasResult: SecretHasResultDto = {
  "exists": true
};

export const secretSetRequest: SecretSetRequestDto = {
  "key": "openrouter.api_key",
  "value": "sk-or-v1-sample"
};

export const audioStartResult: AudioStartResultDto = {
  "maxSeconds": 60
};

export const transcribeResult: TranscribeResultDto = {
  "text": "привет"
};

export const trayActionPayload: TrayActionPayloadDto = {
  "action": "stop-recording"
};

export const diagnosticsSnapshot: DiagnosticsSnapshotDto = {
  "appVersion": "0.0.0",
  "arch": "x86_64",
  "logPath": "C:\\Users\\me\\AppData\\Local\\com.aihelper.app\\logs\\ai-helper.log",
  "logTail": "[INFO] started\n",
  "os": "windows"
};

