# Alibaba Cloud Deployment Proof

## Service Used
- **Qwen Cloud API (DashScope)** via Alibaba Cloud Model Studio (百炼平台)
- API endpoint: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Models used: `qwen3.7-plus`, `qwen3.7-max`, `qwen-plus`, `qwen-max`, `qwen-turbo`

## Evidence
- All API calls in this project use the DashScope OpenAI-compatible endpoint.
- The integration code lives in [`js/api.js`](../js/api.js) — `window.QwenAPI.chat(...)`.
- All agent nodes (Producer, Reviewer A, Reviewer B, Adversarial) communicate with
  Qwen models through Alibaba Cloud infrastructure at runtime.
- Streaming SSE responses are parsed from the DashScope `/chat/completions` endpoint
  and rendered into the output panel in real time.

## How to verify
1. Open `index.html` in a browser.
2. Click 🔑 **API Key** in the topbar and paste a DashScope API key
   (obtain one at `bailian.console.aliyun.com`).
3. Select the **⚡ Adversarial Convergence** template.
4. Click **Run** (or press ⌘⇧R). Watch the live streaming output from Qwen models.

## API Key
- Platform: Alibaba Cloud 百炼 (Model Studio / DashScope)
- Account: Registered on `bailian.console.aliyun.com`
- The key is stored only in the browser's `localStorage` (`qwen-api-key`).
  It is never sent anywhere except directly to `dashscope.aliyuncs.com`.

## Deployment Target
This static project is designed to be served from **Alibaba Cloud OSS + CDN**
(no server-side code, no build step). All fetch calls use either the configured
DashScope endpoint or relative URLs.
