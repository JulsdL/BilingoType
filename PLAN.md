# Fine-Tuning Whisper for French/English Code-Switching

## Overview

Fine-tune OpenAI's Whisper model to excel at transcribing speech that mixes French and English within the same utterance. The resulting model will be:
- Hosted on HuggingFace Hub for cloud inference (HF Inference API/Endpoints)
- Converted to CTranslate2 format for local faster-whisper inference
- Integrated into BilingoType via existing `customModelPath` and HF backend flows

## Phase 1: Dataset Preparation

### 1.1 Public Code-Switching Datasets

Source bilingual French/English speech data from:

| Dataset | Description | Size | Link |
|---------|-------------|------|------|
| **SEAME-like FR/EN** | Code-switching conversational speech | Varies | Research datasets |
| **Common Voice (fr + en)** | Mozilla's crowd-sourced speech | ~2000h each | `mozilla-foundation/common_voice_17_0` |
| **Multilingual LibriSpeech (fr)** | Read speech in French | ~1100h | `facebook/multilingual_librispeech` |
| **LibriSpeech (en)** | Read speech in English | ~960h | `openslr/librispeech_asr` |
| **FLEURS (fr + en)** | Google's multilingual benchmark | ~12h each | `google/fleurs` |
| **VoxPopuli (fr + en)** | European Parliament speech | ~500h+ | `facebook/voxpopuli` |

### 1.2 Synthetic Code-Switching Data Generation

Since no large-scale FR/EN code-switching dataset exists publicly, we create synthetic training data:

**Strategy A: Sentence Splicing**
- Take French sentences and English sentences from Common Voice / LibriSpeech
- Splice audio segments to create mixed utterances
- Generate transcriptions with language tags: `<fr>Bonjour</fr> I need the <fr>rapport financier</fr> please`
- Cross-fade audio at splice points for natural transitions

**Strategy B: TTS-Generated Code-Switching**
- Use bilingual TTS (e.g., Coqui TTS, Bark, or HF TTS models) to generate mixed utterances
- Write scripts that produce natural code-switching patterns:
  - English with French insertions (tech workplace in Montreal)
  - French with English technical terms (dev context)
  - Rapid switching (Franglais patterns)
- Advantage: Perfect transcriptions, unlimited volume

**Strategy C: Existing Bilingual Content**
- Scrape bilingual podcasts (with proper licensing)
- Canadian parliamentary debates (public domain, often bilingual)
- Bilingual YouTube channels with subtitles

### 1.3 Data Format

HuggingFace `datasets` format with columns:
```python
{
    "audio": Audio(sampling_rate=16000),  # 16kHz mono WAV
    "sentence": str,                       # Ground truth transcription
    "language": str,                       # "fr-en" for code-switching, "fr" or "en" for monolingual
}
```

### 1.4 Data Processing Pipeline

```
training/
├── data/
│   ├── prepare_common_voice.py    # Download + preprocess Common Voice fr/en
│   ├── prepare_fleurs.py          # Download + preprocess FLEURS fr/en
│   ├── generate_synthetic.py      # Sentence splicing + TTS generation
│   ├── create_dataset.py          # Merge all sources into unified HF dataset
│   └── audio_utils.py             # Resampling, normalization, cross-fade
```

**Target dataset composition:**
- 40% monolingual French (maintains French accuracy)
- 40% monolingual English (maintains English accuracy)
- 20% code-switching (the novel capability)
- Total: ~100-500 hours (start with 100h, iterate)

---

## Phase 2: Fine-Tuning Pipeline

### 2.1 Base Model Selection

**whisper-large-v3-turbo** (809M params) — best balance of quality and inference speed.

Rationale:
- Large-v3 quality with ~3x faster inference
- Better than large-v3 for real-time dictation latency
- 809M params feasible for LoRA fine-tuning on cloud GPU (A100/T4)

Fallback: **whisper-large-v3** (1550M params) if turbo quality is insufficient.

### 2.2 Training Approach: LoRA

Use **LoRA (Low-Rank Adaptation)** for parameter-efficient fine-tuning:
- Only trains ~1-5% of parameters (adapter weights)
- Requires ~16GB VRAM (fits on T4/A10G/A100)
- Faster training, lower cost
- Can merge adapters back into base model for deployment

Configuration:
```python
from peft import LoraConfig

lora_config = LoraConfig(
    r=32,                          # Rank
    lora_alpha=64,                 # Scaling
    target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)
```

### 2.3 Training Configuration

```python
from transformers import Seq2SeqTrainingArguments

training_args = Seq2SeqTrainingArguments(
    output_dir="./bilingotype-whisper-fr-en",
    per_device_train_batch_size=8,
    gradient_accumulation_steps=2,
    learning_rate=1e-4,
    warmup_steps=500,
    max_steps=5000,               # ~100h dataset, adjust as needed
    gradient_checkpointing=True,
    fp16=True,
    evaluation_strategy="steps",
    eval_steps=500,
    save_steps=500,
    logging_steps=25,
    report_to=["tensorboard"],
    predict_with_generate=True,
    generation_max_length=225,
    push_to_hub=True,
    hub_model_id="bilingotype/whisper-large-v3-turbo-fr-en",
)
```

### 2.4 Training Script

```
training/
├── train.py                       # Main fine-tuning script
├── train_config.yaml              # Hyperparameters (externalized)
├── eval.py                        # Evaluation on test set
├── merge_lora.py                  # Merge LoRA adapters into base model
├── convert_ct2.py                 # Convert to CTranslate2 format
├── requirements.txt               # Training dependencies
└── README.md                      # Training documentation
```

### 2.5 Cloud Training Options

**Option A: HuggingFace AutoTrain / Spaces**
- Upload dataset to HF Hub
- Use HF AutoTrain for no-code fine-tuning
- Or create HF Space with training script + GPU

**Option B: Google Colab Pro**
- T4 GPU (free tier) or A100 (Pro)
- Upload training notebook
- ~4-8h training time for 100h dataset with LoRA

**Option C: Lambda Labs / RunPod / Vast.ai**
- Rent A100/H100 by the hour
- Most cost-effective for large-scale training
- ~$1-3/hr for A100

---

## Phase 3: Model Conversion & Distribution

### 3.1 Merge LoRA Adapters

```python
# merge_lora.py
from peft import PeftModel
from transformers import WhisperForConditionalGeneration

base_model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-large-v3-turbo")
model = PeftModel.from_pretrained(base_model, "./bilingotype-whisper-fr-en/checkpoint-best")
merged_model = model.merge_and_unload()
merged_model.save_pretrained("./bilingotype-whisper-fr-en-merged")
```

### 3.2 Convert to CTranslate2

```bash
ct2-faster-whisper-converter \
    --model ./bilingotype-whisper-fr-en-merged \
    --output_dir ./bilingotype-whisper-fr-en-ct2 \
    --quantization int8_float16
```

This produces a CTranslate2 directory that faster-whisper can load directly via `customModelPath`.

### 3.3 Publish to HuggingFace Hub

```python
# Push both formats to HF Hub
from huggingface_hub import HfApi

api = HfApi()

# Push HF Transformers format (for Inference API)
merged_model.push_to_hub("bilingotype/whisper-large-v3-turbo-fr-en")

# Push CTranslate2 format (for direct download in app)
api.upload_folder(
    folder_path="./bilingotype-whisper-fr-en-ct2",
    repo_id="bilingotype/whisper-large-v3-turbo-fr-en-ct2",
    repo_type="model",
)
```

---

## Phase 4: App Integration

### 4.1 Model Download in App (New Feature)

Add the fine-tuned model to the model picker alongside standard Whisper models:

```
TranscriptionModelPicker options:
├── tiny          (39M)
├── base          (74M)
├── small         (244M)
├── medium        (769M)
├── large-v3      (1550M)
├── large-v3-turbo (809M)
└── ★ BilingoType FR/EN (809M)  ← NEW: auto-downloads from HF Hub
```

**Implementation:**
- Add `bilingotype-fr-en` to model list in `TranscriptionModelPicker.tsx`
- Download CTranslate2 model from HF Hub to `~/.cache/bilingotype/faster-whisper-models/bilingotype-fr-en/`
- No need for `customModelPath` — treat as a first-class model option

### 4.2 Default Language Behavior

When the BilingoType FR/EN model is selected:
- Set `language` to `null` (auto-detect) by default — the model is trained for this
- The model will natively handle code-switching without needing language hints
- Custom dictionary still works as `initialPrompt` for domain-specific terms

### 4.3 HuggingFace Cloud Inference

The HF Transformers model on Hub works automatically with existing HF backend:
- Set `hfModelId` to `bilingotype/whisper-large-v3-turbo-fr-en`
- Existing `hf_client.py` sends audio and receives transcription — no changes needed

---

## Phase 5: Evaluation

### 5.1 Evaluation Metrics

| Metric | Description |
|--------|-------------|
| **WER** | Word Error Rate (overall accuracy) |
| **CS-WER** | Code-Switching WER (accuracy at language boundaries) |
| **LID-F1** | Language Identification F1 at word level |
| **MER** | Mixed Error Rate (penalizes language confusion) |

### 5.2 Test Sets

Create held-out test sets:
- 50 utterances pure French
- 50 utterances pure English
- 100 utterances code-switching (manually verified)
- Compare against base whisper-large-v3-turbo

### 5.3 A/B Testing in App

Add benchmark mode to compare models:
- Transcribe same audio with base model and fine-tuned model
- Show side-by-side results
- Collect user preference data

---

## Project Structure

```
BilingoType/
├── stt/                          # Existing sidecar
│   └── src/bilingotype_stt/
│       └── engine.py             # Add bilingotype-fr-en to MODEL_SIZES
├── training/                     # NEW: Fine-tuning pipeline
│   ├── README.md
│   ├── requirements.txt          # transformers, datasets, peft, accelerate, etc.
│   ├── data/
│   │   ├── prepare_common_voice.py
│   │   ├── prepare_fleurs.py
│   │   ├── generate_synthetic.py
│   │   ├── create_dataset.py
│   │   └── audio_utils.py
│   ├── train.py                  # Main training script
│   ├── train_config.yaml         # Hyperparameters
│   ├── eval.py                   # Evaluation
│   ├── merge_lora.py             # Merge LoRA → full model
│   ├── convert_ct2.py            # Convert → CTranslate2
│   └── notebooks/
│       └── finetune_colab.ipynb  # Google Colab notebook
├── src/components/
│   └── TranscriptionModelPicker.tsx  # Add bilingotype-fr-en option
```

---

## Implementation Order

| Step | Task | Effort | Dependencies |
|------|------|--------|--------------|
| 1 | Set up `training/` directory with requirements and structure | 1 day | None |
| 2 | Dataset preparation scripts (Common Voice, FLEURS download + processing) | 2-3 days | Step 1 |
| 3 | Synthetic code-switching data generation | 2-3 days | Step 2 |
| 4 | Training script with LoRA on whisper-large-v3-turbo | 2 days | Step 2 |
| 5 | Run training (cloud GPU) | 4-8 hours | Step 3, 4 |
| 6 | Evaluation + iterate on data/hyperparameters | 2-3 days | Step 5 |
| 7 | Merge LoRA + convert to CTranslate2 | 1 day | Step 6 |
| 8 | Publish to HuggingFace Hub | 0.5 day | Step 7 |
| 9 | Add bilingotype-fr-en to app model picker | 1 day | Step 8 |
| 10 | End-to-end testing with app | 1 day | Step 9 |

**Total estimated effort: 2-3 weeks** (including iteration cycles)

---

## Key Decisions to Make

1. **Base model**: whisper-large-v3-turbo (recommended) vs whisper-large-v3
2. **Training data volume**: Start with 100h (fast iteration) or go for 500h (better quality)
3. **Synthetic data approach**: Sentence splicing (fast, mechanical) vs TTS generation (slower, more natural)
4. **HF organization**: Create `bilingotype` org on HuggingFace Hub or use personal account
5. **Model naming**: `bilingotype/whisper-large-v3-turbo-fr-en` or similar
