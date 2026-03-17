# MeowLingo

A real-time cat behavior translation app based on Gemini Live: the frontend handles multimodal session interaction and UX, while the backend provides local audio classification and runtime health capabilities.

## Project Background

- The product goal comes from a real-time multimodal Agent scenario: enabling users to interact with cats through camera/microphone using a first-person “cat persona translation” experience.
- The current repository provides a runnable dual-stack implementation (Web frontend + Python backend).
- According to the project PRD submission requirements, the README must include reproducible startup and testing instructions. The previous README only contained minimal startup notes and did not meet full delivery/open-source collaboration standards.

## Project Goals

- Build a demo-ready real-time translation main path (connect, respond, interruptible dialogue).
- Keep persona behavior and bilingual experience (Chinese/English) consistent.
- Enhance recognition when the local backend is healthy, while ensuring the core flow is not blocked if backend enhancement is degraded.
- Provide reproducible verification and defect tracking references for regression.

## Directory Structure

```text
.
├─ src/                      # Web frontend (React + TypeScript + Vite)
│  ├─ components/            # UI pages and view components
│  ├─ hooks/                 # Core business hooks (e.g. useLiveAPI)
│  └─ lib/                   # Utilities, storage, unit tests
├─ server/                   # Python FastAPI audio classification backend
│  ├─ app.py                 # API entry (/health, /classify, /events, etc.)
│  ├─ inference.py           # Inference and runtime status
│  └─ test_*.py              # Backend unit tests
├─ test/                     # Test assets, automation scripts, reports, defect list
├─ doc/                      # PRD, roadmap, architecture, supplementary requirements
├─ docs/                     # Supplementary planning documents
├─ package.json              # Frontend scripts and dependencies
└─ vite.config.ts            # Dev server and /api proxy configuration
```

## Runtime Environment

### Frontend

- Node.js 20+ (LTS recommended)
- npm 10+
- Chrome (used in automation scripts and media capability verification)

### Backend

- Python 3.12 (`server/runtime.txt`)
- pip
- ffmpeg (used by `/video/convert`)

### System & Network

- Works on Windows/macOS/Linux; for mobile device testing, use the same LAN
- Local HTTPS development is recommended (dev cert generation logic is already integrated in this repository)

## Installation & Deployment

### 1) Install Dependencies

```bash
npm install
```

```bash
python -m pip install -r server/requirements.txt
```

### 2) Configure Environment Variables

Copy `.env.example` to `.env.local` and fill values as needed:

```env
GEMINI_API_KEY=your_key
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
GEMINI_LIVE_MODEL_FALLBACK=gemini-live-2.5-flash-preview
APP_URL=http://localhost:3000
```

### 3) Start Backend (Port 8011)

```bash
python server/app.py
```

### 4) Start Frontend (Port 3000)

```bash
npm run dev
```

Access URLs:

- Frontend: `https://localhost:3000/`
- Backend health check: `http://127.0.0.1:8011/health`

### 5) Cloud Run Deployment (Optional)

```bash
npm run deploy:gcp
```

## Configuration

- `GEMINI_API_KEY`: Credential for Gemini calls; required for frontend/backend integration.
- `GEMINI_LIVE_MODEL`: Primary Live model used for real-time sessions.
- `GEMINI_LIVE_MODEL_FALLBACK`: Fallback model when primary model is unavailable.
- `VITE_DEV_HTTPS`: Whether HTTPS is enabled in dev mode (`npm run dev` enables it by default).
- Frontend uses Vite proxy to forward `/api/*` to `http://127.0.0.1:8011`.

## Key Code Flows

### 1) Real-time Session Main Path

1. `src/App.tsx` manages page state, persona/mode switching, and connection entry.
2. `src/hooks/useLiveAPI.ts` is responsible for:
   - establishing Gemini Live sessions
   - collecting and streaming audio/video
   - receiving live responses and updating UI
   - handling disconnects (1006/1007/1008), fallback, and reconnect strategy
3. `server/app.py` exposes `/health` and `/classify/active` for backend enhancement and health probing.

### 2) Audio Enhancement Path

1. Frontend collects audio chunks and requests `/api/classify/active`.
2. Backend classifies via `inference.py` and returns classes/confidence.
3. Frontend injects structured observations into the live session to improve explainability.

### 3) Testing & Quality Assets

- Test cases: `test/Test_Cases.md`
- Test report: `test/Test_Report.md`
- Defect list: `test/Bug_Report.csv`

## Issue Diagnosis & Resolution Log

### Issue A: README was incomplete and lacked reproducible test instructions (Resolved)

- Symptom: README only had minimal startup steps and missed critical sections like testing, troubleshooting, and contribution rules.
- Impact: Did not meet open-source maintainability expectations or reproducible-testing submission requirements.
- Existing-solution assessment: The repository already contains test scripts and reports, which can be directly consolidated into a standard README workflow.
- Location paths:
  - `test/Test_Cases.md`
  - `test/Test_Report.md`
  - `test/pytest_audio_dual_voice_chrome.py`
  - `src/lib/*.test.ts`
- Validation steps:
  1. Execute commands in “Testing & Verification (Reproducible)”.
  2. Ensure command exit codes are 0.
  3. Confirm `test/Test_Report.md` and artifact directories are updated.

### Issue B: Live model unavailable blocks translation path (In progress, partial existing implementation)

- Symptom: `Bug-TAIL-001` indicates that no recognition output is produced when the primary model is unavailable (status: Open).
- Error/behavior: A 1007 recovery may still end with “current Live model unavailable”.
- Existing-solution assessment: Frontend already includes auto-switch and reconnect logic, but failures may still occur due to account model availability and quota constraints.
- Existing implementation location:
  - `src/hooks/useLiveAPI.ts` (1006/1007/1008 branches, fallback switching, reconnect retry control)
  - `vite.config.ts` (`GEMINI_LIVE_MODEL` and `GEMINI_LIVE_MODEL_FALLBACK` injection)
- Verification steps:
  1. Configure primary/fallback models in `.env.local`.
  2. Start frontend/backend and enter real-time translation.
  3. Trigger connection and observe error modal plus `activeLiveModel` changes.
  4. Verify whether output continues after fallback.

### Follow-up Modification Plan for Issue B (if existing fallback still fails)

1. Root-cause analysis
   - Account/project has no permission for available Live models.
   - API key invalid or quota exhausted.
   - Both primary and fallback models are incompatible with current stream mode.
2. Code change scope
   - `src/hooks/useLiveAPI.ts`: improve model-availability error categorization and observability events.
   - `src/App.tsx`: refine user-facing error guidance into permission/quota/incompatibility categories.
   - `test/Bug_Report.csv`: append reproduction environment and regression status.
3. Interface/logic adjustments
   - Add pre-connection model candidate and compatibility checks.
   - Stop retrying after fallback failure and provide explicit configuration guidance.
   - Keep local backend path independent to avoid global blockage.
4. Dependency checks
   - Node and `@google/genai` version compatibility.
   - `.env.local` exists with complete keys.
   - Backend health check passes (`/health`).
5. Rollback strategy
   - If regressions are introduced, roll back to the current stable error-handling branch and keep only validated reconnect paths.
   - Record rollback reason and affected version window in `test/Bug_Report.csv`.
6. Unit testing requirements
   - Add tests for model-switch and retry-termination branches in `useLiveAPI`.
   - Keep `npx tsx --test src/lib/*.test.ts` as baseline regression.
   - Maintain passing backend tests:
     - `python -m unittest server/test_runtime_routing.py`
     - `python -m unittest server/test_train_data_layout.py`

## Testing & Verification (Reproducible)

### Quick Checks

```bash
npm run lint
```

```bash
npm run build
```

### Frontend Unit Tests (TypeScript)

```bash
npx tsx --test src/lib/*.test.ts
```

### Backend Unit Tests (Python)

```bash
python -m unittest server/test_runtime_routing.py
python -m unittest server/test_train_data_layout.py
```

### Browser Regression Scripts (Language & Gallery)

```bash
node test/language_toggle.chrome.mjs
node test/i18n_english_no_chinese.chrome.mjs
node test/language_cache_detection.chrome.mjs
node test/gallery_playback.chrome.test.js
```

### Dual-Voice Audio Automation (Playwright + Pytest)

```bash
python -m pytest test/pytest_audio_dual_voice_chrome.py -q
```

After execution, verify:

- `test/artifacts/audio_dual_voice/<run_id>/` contains complete outputs
- `test/Test_Report.md` has newly added or updated results
- `test/Bug_Report.csv` status aligns with current regression conclusions

## Contribution Guide

1. Run the minimum regression set under “Testing & Verification (Reproducible)” before submitting changes.
2. When behavior logic changes, update `test/Test_Cases.md` and `test/Bug_Report.csv` together.
3. Do not commit secrets, private data, or large temporary artifacts.
4. PR descriptions should include: background, changes, verification steps, risks, and rollback plan.

## License

This repository currently does not contain a `LICENSE` file. Under open-source conventions, this means “All Rights Reserved” by default. If public collaboration is intended, add an explicit license (e.g., MIT or Apache-2.0).

## Contact

- Issue reporting: please use repository Issues.
- Quality records: refer to `test/Bug_Report.csv` and `test/Test_Report.md`.
- Requirement background: refer to `doc/PRD.md`.
