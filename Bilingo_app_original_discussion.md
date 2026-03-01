<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# working on Windows WSL Ubuntu Claude code, I want to be able to speak to it instead of typing. He answers in text still, don't need text to speech.

What the easiest way to achieve this?

The quickest way is to use Windows’ built‑in voice typing (Win + H) and let it dictate directly into the Claude Code input in VS Code or your browser. [^1_1][^1_2][^1_3][^1_4]

## Easiest setup (no extra tools)

On Windows 10/11 you can turn on **voice typing** and use it in any text box, including Claude Code’s message field. [^1_3][^1_4]

1. In Windows, open Settings → Time \& language → Speech and make sure “Online speech recognition” / “Voice typing” is enabled. [^1_3]
2. Put your cursor in the Claude Code input (VS Code panel, browser, or terminal prompt). [^1_5][^1_6]
3. Press `Win + H` to bring up the voice typing toolbar. [^1_2][^1_3][^1_4]
4. Speak; your words will appear as text wherever the cursor is, so you can “talk” your prompt to Claude. [^1_3][^1_4]
5. Press `Win + H` again or click the mic icon to stop. [^1_3][^1_4]

This works regardless of WSL/Ubuntu, because the dictation runs at the Windows layer and simply injects text into the active window.

## If you want something more IDE‑integrated

If you spend most of your time in VS Code, you can also use a speech‑to‑text extension, which gives you a command or button for dictation: [^1_7][^1_8][^1_9]

- Install a speech extension like “VS Code Speech” from the Marketplace. [^1_8]
- Trigger dictation inside the Claude Code chat input and speak your prompt. [^1_8][^1_9]

But for your use case (“just talk instead of typing, Claude still answers in text”), the built‑in `Win + H` dictation is usually the simplest and most robust solution. [^1_1][^1_2][^1_3]
<span style="display:none">[^1_10][^1_11][^1_12][^1_13][^1_14][^1_15]</span>

<div align="center">⁂</div>

[^1_1]: https://www.reddit.com/r/ClaudeAI/comments/1l9mzwi/whats_your_goto_voicetotext_setup_for_cursor_or/

[^1_2]: https://www.reddit.com/r/Windows11/comments/1iaqb9r/tip_of_the_week_you_can_press_win_h_to_input_text/

[^1_3]: https://www.easyit.com/voice-typing/

[^1_4]: https://www.clocktowertech.com/2025/02/13/voice-typing-in-windows-11-a-simple-guide/

[^1_5]: https://code.claude.com/docs/en/vs-code

[^1_6]: https://smartscope.blog/en/ai-development/ai-automation/voice-input-programming-hands-on-implementation-2025/

[^1_7]: https://github.com/olefjaerestad/vscode-speech-to-text

[^1_8]: https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-speech

[^1_9]: https://code.visualstudio.com/docs/configure/accessibility/voice

[^1_10]: https://support.claude.com/en/articles/11101966-using-voice-mode

[^1_11]: https://willowvoice.com/blog/voice-ai-dictation-claude-code

[^1_12]: https://www.reddit.com/r/ClaudeCode/comments/1lwe5st/voice_mode_for_claude_code_easy_install/

[^1_13]: https://getvoicemode.com

[^1_14]: https://stackoverflow.com/questions/78269146/can-i-use-the-speech-to-text-api-in-my-own-extension-in-vs-code

[^1_15]: https://www.youtube.com/watch?v=GbDatJtm8_k


---

# The issue with Windows voice typing is when mixing language..like I want to speak french, but sometime I use english words..and it's messing the voice typing. I'm looking for the best solutio available

You’re running into a fundamental limitation: most consumer dictation (including Windows voice typing and Google Docs) expects one language at a time and handles code‑switching poorly.[^2_1][^2_2]

## Practical options today

1. **Pick one “base” language and accept minor errors**
    - Set Windows voice typing to French and just speak franglais; it will usually keep the sentence structure and you can quickly fix a few English tokens by hand.[^2_3][^2_4]
    - This is still the lowest‑friction option if you care more about speed than perfect transcripts.
2. **Use a dedicated online STT tool with better multilingual models**
    - APIs like Soniox explicitly support many languages and can transcribe and translate in real time with higher accuracy than Windows’ built‑in engine.[^2_5]
    - Typical workflow: small tray/desktop client listens to your mic → sends audio to the cloud → pastes text into the active window (Claude Code input).[^2_5]
    - Downsides: subscription cost, network dependency, and you may still see occasional confusion on very mixed sentences.[^2_1][^2_5]
3. **Roll your own “dev‑grade” solution with a modern ASR model**
If you’re willing to tinker a bit, you can get closer to “best available”:
    - Use a multilingual/code‑switching ASR (e.g. a cloud provider like Azure Speech with language identification set to multiple languages, or a local modern model).[^2_6][^2_7][^2_2]
    - Write a small Python app on Windows that:
        - records from your mic,
        - streams to the ASR API (or local model),
        - writes the recognized text into the clipboard or injects it into the current window (e.g. via a global hotkey).
    - Azure Speech, for example, lets you define a set of possible languages and will try to detect the spoken one continuously, which is more robust when you alternate between English and another language, though not perfect on every mixed sentence.[^2_2][^2_6]
4. **Use monolingual STT but keep prompts mostly in one language**
    - For code‑related work, you can decide “Claude prompts are in English, comments/explanations in French,” and set dictation language accordingly.
    - This avoids most code‑switching issues and still gives you hands‑free input.

## What I’d recommend to you

Given you’re comfortable coding and on Windows + WSL:

- For **minimal setup**: keep using `Win + H` but set it to French and consciously bias your prompts to French (with English identifiers/keywords). Quick manual fix for the few mis‑recognized English words is often faster than a more complex pipeline.[^2_4][^2_3]
- If you want **best tech available** and don’t mind a bit of engineering: prototype a tiny helper app around Azure Speech’s multilingual/language‑ID mode or a high‑quality third‑party STT (like Soniox), then bind it to a global hotkey that pastes into Claude Code.[^2_6][^2_2][^2_5]

There is, unfortunately, no truly “perfect” off‑the‑shelf dictation system for fluent franglais yet; the trade‑off is simplicity (Windows) vs. accuracy (custom or third‑party STT).[^2_2][^2_1]
<span style="display:none">[^2_10][^2_11][^2_12][^2_13][^2_14][^2_15][^2_8][^2_9]</span>

<div align="center">⁂</div>

[^2_1]: https://www.reddit.com/r/ArtificialInteligence/comments/1ecm76h/speechtotext_solution_for_multilingual_sentences/

[^2_2]: https://neurips.cc/virtual/2025/poster/121687

[^2_3]: https://en.wikipedia.org/wiki/Windows_Speech_Recognition

[^2_4]: https://support.microsoft.com/en-us/windows/windows-speech-recognition-commands-9d25ef36-994d-f367-a81a-a326160128c7

[^2_5]: https://soniox.com

[^2_6]: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-identification

[^2_7]: https://arxiv.org/html/2509.14161v1

[^2_8]: https://support.microsoft.com/en-us/office/multilingual-speech-recognition-in-microsoft-teams-650cb6d2-8a33-40e7-840d-36bb90216aa4

[^2_9]: https://blog-en.topedia.com/2025/04/how-to-use-the-new-multilingual-speech-recognition-feature-in-teams-meetings/

[^2_10]: https://www.geeksforgeeks.org/websites-apps/how-to-type-other-languages-in-google-docs/

[^2_11]: https://www.youtube.com/watch?v=vR_u6d9YYHc

[^2_12]: https://openreview.net/forum?id=N5BB7Or30g

[^2_13]: https://www.youtube.com/watch?v=oaoqEiEfjwM

[^2_14]: https://support.microsoft.com/en-gb/windows/windows-speech-recognition-commands-9d25ef36-994d-f367-a81a-a326160128c7

[^2_15]: https://usevoicy.com/blog/how-to-do-speech-to-text-in-google-docs


---

# There mnust be available solutions to download

Yes, there are good downloadable/local options; the best balance today for mixed French/English is to run a modern multilingual ASR locally and wire it into your workflow.

## 1. “Good enough and simple”: Whisper locally

OpenAI Whisper models are multilingual and handle code‑switching (e.g. fr/en in the same sentence) much better than Windows voice typing.[^3_1][^3_2]

Typical setup on Windows:

1. Install `whisper.cpp` (prebuilt exe) or a Python Whisper wrapper.[^3_1]
2. Download a multilingual model (e.g. `large-v3` or a quantized `large-v3` for speed).[^3_1]
3. Run a small tray app/script that:
    - records from your mic,
    - sends chunks to Whisper for transcription,
    - pastes the text into the active window (Claude Code).

People commonly run `whisper.cpp` as a local server and hit it from a small Python/Node client, which is nice if you want hotkeys and low latency.[^3_1]

Pros:

- Fully local, no API keys, excellent multilingual accuracy.[^3_2][^3_1]
- Handles code‑switching much better than Windows STT.[^3_2]

Cons:

- Some setup; real‑time performance depends on your CPU/GPU.


## 2. “More researchy but powerful”: Omnilingual ASR

Meta’s **Omnilingual ASR** is open‑source, designed for many languages and explicitly mentions robustness to accents and code‑switching.[^3_3][^3_4][^3_5]

- You can download models and run them locally (PyTorch).[^3_5][^3_3]
- It’s aimed at exactly your kind of use case (multilingual + code‑switching).[^3_5]
- You’d likely have to write your own thin wrapper to capture mic input and inject text like with Whisper.

Pros: cutting‑edge multilingual + code‑switch, open‑source.[^3_3][^3_5]
Cons: more “research repo” than turnkey app; more engineering than Whisper.

## 3. Lighter offline engines

Projects like **Vosk** and **voice2json** provide offline STT with multiple languages and simple CLIs.[^3_6][^3_7]

- Vosk supports >20 languages including English and French, and runs offline on modest hardware.[^3_7]
- voice2json is Linux‑focused but could run inside WSL for scripting, then send text back to Windows/VS Code.[^3_6]

Accuracy for heavy code‑switching is typically behind Whisper/Omnilingual ASR, but setup is straightforward.

## 4. What I’d actually do in your position

Given your profile (Windows + WSL, comfortable coding, using Claude Code):

- Start with **Whisper (whisper.cpp)**, using a multilingual model and a small helper that:
    - maps a global hotkey → capture a few seconds of audio → call Whisper → paste into VS Code/Claude.[^3_1]
- If you want to push further on code‑switch quality or just experiment, try **Omnilingual ASR** as a drop‑in backend replacement for the same helper script.[^3_3][^3_5]

If you want, I can sketch a minimal architecture and sample Python (Windows) pseudo‑code for:

- global hotkey,
- mic capture,
- call to Whisper/Omnilingual,
- paste into the active Claude Code input.
<span style="display:none">[^3_10][^3_11][^3_12][^3_13][^3_14][^3_15][^3_8][^3_9]</span>

<div align="center">⁂</div>

[^3_1]: https://www.youtube.com/watch?v=U87ywEWc1_c

[^3_2]: https://www.youtube.com/watch?v=6hrrZC4ciaE

[^3_3]: https://github.com/facebookresearch/omnilingual-asr

[^3_4]: https://arxiv.org/html/2511.09690v1

[^3_5]: https://sourceforge.net/projects/omnilingual-asr.mirror/

[^3_6]: http://voice2json.org

[^3_7]: https://alphacephei.com/vosk/

[^3_8]: https://www.isca-archive.org/interspeech_2021/klejch21_interspeech.pdf

[^3_9]: https://jisem-journal.com/index.php/journal/article/download/8998/4138/14985

[^3_10]: https://www.reddit.com/r/LocalLLaMA/comments/1lnejb6/what_is_the_best_open_source_tts_model_with_multi/

[^3_11]: https://soniox.com/docs/stt/SDKs/python-SDK

[^3_12]: https://www.siliconflow.com/articles/en/best-open-source-models-for-speech-translation

[^3_13]: https://github.com/soniox/speech-to-text-web

[^3_14]: https://mistral.ai/news/voxtral

[^3_15]: https://ai-sdk.dev/providers/community-providers/soniox


---

# Alright,but can we make sure we can stream tokens with Whisper ? I dont like to speak for 10sec and not being able to actualy see anything written. It should work like windows voice typing for that

Yes, you can get Whisper to behave much closer to Windows voice typing, with words appearing while you speak, but you need a **streaming wrapper** around it.

## Does Whisper support streaming-style output?

- Whisper itself is batch‑oriented, but projects like `whisper.cpp` include a `stream` example that continuously samples mic audio every ~0.5s and updates the transcript, so you see text appear as you talk.[^4_1][^4_2]
- Other wrappers such as `whisper_streaming`, WhisperFlow, WhisperLive, and various WebSocket setups turn Whisper into a real‑time system with partial results and low latency (typically 1–3s).[^4_3][^4_4][^4_5][^4_6][^4_7]

So yes: with the right wrapper, you can absolutely stream tokens/words and not wait 10 seconds for a big block. It’s not literally token‑by‑token like an LLM, but it’s “chunk‑by‑chunk” every second or two.

## Concrete approach for your setup

For your Windows + WSL + Claude Code use case, I’d look at:

1. **whisper.cpp “stream” mode as the backend**
    - Use the `stream` example from `whisper.cpp`, which records from the mic and updates transcripts every 0.5s.[^4_2][^4_1]
    - You adapt or wrap it so that whenever new confirmed text appears, it sends keystrokes / pastes into the active text box (Claude Code input).
2. **Or use a higher‑level streaming library**
    - `ufal/whisper_streaming` adds a proper streaming algorithm (local agreement, sliding windows) to Whisper with ~3.3s latency and robust multilingual support.[^4_8][^4_5][^4_3]
    - Libraries like WhisperFlow (Python) or WhisperLive show end‑to‑end examples of real‑time transcription with WebSockets and partial results appearing live.[^4_4][^4_6][^4_7]

In both cases you can get a UX like:

- Press a hotkey → start capturing audio.
- Every ~0.5–2s new partial text appears in your Claude Code input.
- When you stop speaking or hit the hotkey again, the last segment is finalized.


## Recommendation for you

Given your comfort level:

- Use **whisper.cpp + its `stream` example** as the core, because it already does continuous mic capture and incremental transcription.[^4_1][^4_2]
- Add a small Windows helper (Python or C\#) that reads partial transcripts from the stream process and injects them into VS Code / Claude Code as they come in.

If you’d like, next step I can sketch a minimal architecture and pseudo‑code for:

- Running `whisper.cpp` streaming,
- Getting partial results,
- Injecting them live into Claude Code with a hotkey.
<span style="display:none">[^4_10][^4_11][^4_12][^4_13][^4_14][^4_15][^4_16][^4_17][^4_18][^4_19][^4_20][^4_21][^4_22][^4_23][^4_24][^4_25][^4_26][^4_27][^4_28][^4_29][^4_30][^4_31][^4_32][^4_33][^4_9]</span>

<div align="center">⁂</div>

[^4_1]: https://github.com/ggml-org/whisper.cpp

[^4_2]: https://github.com/ggerganov/whisper.cpp/blob/master/examples/stream/README.md

[^4_3]: https://github.com/ufal/whisper_streaming

[^4_4]: https://itnext.io/whisperflow-a-real-time-speech-to-text-library-274279d98cba

[^4_5]: https://www.youtube.com/watch?v=_spinzpEeFM

[^4_6]: https://www.baseten.co/blog/zero-to-real-time-transcription-the-complete-whisper-v3-websockets-tutorial/

[^4_7]: https://www.youtube.com/watch?v=0PHWCApIcCI

[^4_8]: https://arxiv.org/html/2506.12154v1

[^4_9]: https://www.perplexity.ai/podcast

[^4_10]: https://www.perplexity.ai

[^4_11]: https://www.perplexity.ai/help-center/fr/collections/8935108-perplexity-pro

[^4_12]: https://www.perplexity.ai/ja/hub/faq/what-are-threads

[^4_13]: https://www.perplexity.ai/ko/hub/technical-faq/what-is-a-token-and-how-many-tokens-can-perplexity-read-at-once

[^4_14]: https://www.perplexity.ai/help-center/es/articles/10354924-informacion-sobre-tokens

[^4_15]: https://www.perplexity.ai/hub/blog/disaggregated-prefill-and-decode

[^4_16]: https://www.perplexity.ai/ja/hub/technical-faq/what-is-a-token-and-how-many-tokens-can-perplexity-read-at-once

[^4_17]: https://www.perplexity.ai/help-center/ko/articles/11652747-감사-로그

[^4_18]: https://www.perplexity.ai/help-center/en/articles/10354958-can-i-control-parameters-like-temperature-top-p-and-stop-tokens

[^4_19]: https://www.perplexity.ai/es-es/hub/blog/perplexity-raises-series-b-funding-round

[^4_20]: https://www.perplexity.ai/fr/hub/legal/perplexity-api-terms-of-service

[^4_21]: https://www.perplexity.ai/nl/hub/legal/merchant-program-terms-of-service

[^4_22]: https://www.perplexity.ai/es-es/hub/blog/rl-training-for-math-reasoning

[^4_23]: https://www.perplexity.ai/pl/hub/blog/open-sourcing-r1-1776

[^4_24]: https://www.perplexity.ai/el/hub/associate-product-manager

[^4_25]: https://www.perplexity.ai/it/hub/blog/building-safer-ai-browsers-with-browsesafe

[^4_26]: https://www.perplexity.ai/de/hub/faq/pro-enterprise-faq

[^4_27]: https://www.reddit.com/r/LocalLLaMA/comments/1h2kvu2/whisper_whispercppwhisperkit_for_live/

[^4_28]: https://whynothugo.nl/journal/2024/09/22/transcribing-audio-with-whisper.cpp/

[^4_29]: https://www.omnilingualasr1.com

[^4_30]: https://github.com/ggml-org/whisper.cpp/issues/1653

[^4_31]: https://www.reddit.com/r/LocalLLaMA/comments/1q1au63/omniasrserver_openaicompatible_api_for_metas/

[^4_32]: https://github.com/facebookresearch/omnilingual-asr

[^4_33]: https://developers.openai.com/api/docs/guides/speech-to-text/


---

# Ok, get a name for my project

How about **“FranglAI”** – a nod to franglais and the AI doing live multilingual dictation for Claude Code.

---

# Great, but it will actually be a mix of english and french in any proportion.

Then I’d go with **CodeSwitch** — it captures the idea of switching freely between English and French while coding and dictating, in any proportion.

---

# Yep..but it isnt related to language, voice, typing or anything..it sound more a coding solution

You’re right, that one’s too generic.

Here are a few that clearly evoke voice + mixed languages:

- **BilingoType** – bilingual + typing, hinting at fluid fr/en dictation.
- **PolyglotPrompt** – speaks to prompts in multiple languages.
- **LinguaFlow** – language flowing in and becoming text as you speak.
- **Speak2CodeMix** – explicit about speech → code with mixed languages.
- **VoxBilingue** – “voice” + bilingual, with a French twist in the name.

If you tell me which vibe you prefer (more playful vs. more “pro tool”), I can narrow it down or iterate.

