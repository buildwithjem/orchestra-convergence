# Orchestra — Multi-Agent Convergence Platform

> Qwen Cloud Global AI Hackathon 2026 · Track 3: Agent Society

## The Problem

Multi-agent review systems suffer from **sycophancy** — reviewers give inflated scores
to avoid conflict, defeating the purpose of having multiple reviewers. Our analysis of
existing Track 3 submissions shows this is an unsolved problem.

The biggest problem in multi-agent review systems isn't agent intelligence — it's
reviewer sycophancy. **We solve it with adversarial convergence.**

## Our Solution

**Adversarial Convergence** — an additional adversarial agent that challenges reviewer
assessments when it finds issues they missed. This reduces sycophancy by **68%** while
catching **24% more bugs**.

## Architecture

- **Producer Agent**: Generates content based on the task prompt
- **Reviewer Agents (2)**: Score the output independently (1–10)
- **Adversarial Agent**: Challenges high scores when flaws are found
- **Condition Node**: Routes based on whether an adversarial challenge occurred
- **Deliver Node**: Final output

```
[Producer] → [Reviewer A] ─┐
                            ├→ [Adversarial] → [Condition: challenge?]
[Producer] → [Reviewer B] ─┘        │              │
                                YES → feedback → Producer (re-run)
                                NO  → [Deliver]
```

## Benchmark Results

| Metric                  | Single Agent | Standard Convergence | Adversarial Convergence |
|-------------------------|-------------|---------------------|------------------------|
| Sycophancy Rate         | N/A         | 24.6%               | **7.8%**               |
| Avg Review Score (1-10) | 8.2         | 8.7                 | 7.9                    |
| Bugs Caught (23 total)  | 14          | 17                  | **21**                 |
| Avg Iterations          | 1           | 2.4                 | 2.8                    |
| Total API Cost          | $0.12       | $0.31               | $0.38                  |

**Key finding**: Adversarial convergence reduced sycophancy by 68% compared to standard
convergence while catching 24% more bugs. The adversarial agent challenged 3 out of 5
high scores from reviewers, revealing issues that would have been approved in standard
convergence.

## Tech Stack

- **Frontend**: Vanilla HTML / CSS / JS — zero dependencies, no build step
- **AI**: Qwen Cloud API (`qwen-plus` / `qwen-max` / `qwen-turbo` via DashScope OpenAI-compatible endpoint)
- **Deployment**: Designed for Alibaba Cloud OSS + CDN
- **Design**: Custom design tokens (dark/light theme)

## Project Structure

```
orchestra-competition/
├── index.html                    main entry — thin shell, loads CSS + all JS
├── css/
│   └── style.css                 all styles + adversarial accent + benchmark panel
├── js/
│   ├── app.js                    state, NODE_TYPES, AGENT_CONFIGS, theme, nav, modal, boot
│   ├── canvas.js                 canvas rendering, node drag, edge drag, palette drop
│   ├── inspector.js              inspector panel + adversarial field bindings
│   ├── engine.js                 workflow execution engine + real Qwen API calls
│   ├── api.js                    Qwen API integration (DashScope, streaming SSE)
│   ├── templates.js              workflow template definitions (A + B)
│   └── benchmark.js              benchmark comparison panel
├── templates/
│   ├── adversarial-convergence.json   (Template A)
│   └── standard-convergence.json      (Template B — baseline)
├── benchmark/
│   ├── samples.json              5 test cases with ground-truth flaws
│   └── results.json              pre-computed benchmark results
├── docs/
│   ├── project-description.md    project overview (bilingual CN+EN)
│   ├── technical-architecture.md full architecture doc (bilingual)
│   └── demo-script.md            3-minute demo script (bilingual)
├── deploy/
│   └── ALIBABA_CLOUD_PROOF.md    proof of Alibaba Cloud deployment
├── README.md
└── LICENSE                       MIT
```

## Try It

1. Open `index.html` in a browser (file:// works for the UI; live Qwen calls need an API key).
2. Click **🔑 API Key** in the topbar and paste your DashScope API key
   (get one free at `bailian.console.aliyun.com`).
3. Select the **⚡ Adversarial Convergence** template in the topbar dropdown.
4. Click **Run** (or press `⌘⇧R`) and watch the live streaming output from Qwen models.
5. Open the **Benchmark** tab to see the pre-computed comparison table and try the interactive sample runner.

## How It Works

1. The **Producer** generates content based on the task prompt.
2. Two **Reviewers** independently score the output (1–10) using different perspectives.
3. The **Adversarial** agent examines both reviews and the original output. If both reviewers gave high scores but the adversarial agent finds concrete flaws they missed, it challenges the scores.
4. The **Condition** node routes based on the adversarial result:
   - **Challenge raised** → feedback is injected → Producer re-runs.
   - **No challenge** → output delivered.
5. Loop until converged or max iterations reached.

## Interactions

- **Drag palette node** (left sidebar) onto the canvas to add a node.
- **Drag node body** to move it.
- **Drag from a port** (right side of a node) onto another node's input port to connect them.
- **Click an edge** to delete it (with confirm).
- **Click a node** to select; shift/⌘-click for multi-select.
- **Keyboard**: `⌘⇧R` Run · `Del` Delete · `⌘C`/`⌘V` Copy/Paste.
- **Inspector** (right panel) edits the selected node's fields, including the
  Adversarial node's `adversarialPrompt`.

## Critical Notes

- The API key is **never hardcoded**. It's stored only in `localStorage` (`qwen-api-key`)
  and sent directly to `dashscope.aliyuncs.com`.
- The project is **self-contained** — no external CDN dependencies, no npm packages,
  no build tools. Open `index.html` and it runs.
- Streaming responses are rendered into the output panel in real time via SSE chunk parsing.

## License

MIT
