# BeatBook

**Offline, voice-first order taking for FMCG field sales reps, with on-device AI.**

A general-trade sales rep visits dozens of small shops a day, then re-types orders and reports into apps that need a network signal many shops don't have. With BeatBook the rep just speaks the order. The phone turns it into clean order lines and builds the end-of-day report, with no network needed.

## How it works

```
Rep speaks (English / Hindi)
   │
   ▼
Whisper (speech → text), running on the phone      ← Transformers.js · WebGPU, CPU fallback
   │
   ▼
Qwen2.5 open-source LLM, running on the phone      ← WebLLM · WebGPU
   • output restricted to a JSON schema whose SKU field is an enum of the catalogue,
     so it cannot invent products
   │
   ▼
Validator + rules engine (catalogue matching, Hindi numbers, dozen/case conversion)
   • checks the LLM output; takes over if the model is unavailable
   │
   ▼
Editable order → daily report → CSV / share sheet / clipboard → laptop
```

- **Offline:** after a one-time model download, the app shell, libraries and model weights are cached on the phone. It works in airplane mode.
- **Private:** audio and order data never leave the device.
- **Hindi + English:** the rules engine understands Hindi number words (do darjan, ek peti, dus wala) and Devanagari.
- **Built for the rep's day:** a "Repeat last order" button, the order read back aloud (on-device text-to-speech), no-order reasons, shop notes, a shelf photo, and time-to-capture per outlet.
- **Laptop side:** `manager.html` is the area manager's dashboard. Drop in the CSVs the phones send (via Office Kit, Nearby Share or WhatsApp) to see strike rate, order value by outlet, top products and market notes. Nothing is uploaded.

## Run it

It's a static web app (PWA). Host the folder on any HTTPS host (GitHub Pages works), open it in Chrome on Android, then use **Add to Home screen**. Open **On-device AI → Download both models** on Wi-Fi.

## Files

| File | What it does |
|---|---|
| `index.html` | Layout and styles |
| `app.js` | Screens, visit flow, report and export |
| `ai.js` | Model loading, transcription, LLM order reading |
| `parser.js` | Rules engine and LLM output validator |
| `catalog.js` | Demo catalogue, beat and last orders (fictional brands) |
| `manager.html` | Laptop dashboard for the area manager |
| `sw.js` | Service worker for offline use |

## Roadmap

- Shelf photo → on-device vision model flags stock gaps and competitor products
- Native Android build with the LLM on the Snapdragon NPU
- Sync to the distributor's sales system when back online
