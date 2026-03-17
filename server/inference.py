import tensorflow as tf
import sys
import types

try:
    import pkg_resources
except ImportError:
    from packaging.version import parse as _parse_version

    pkg_resources = types.ModuleType("pkg_resources")
    pkg_resources.parse_version = _parse_version
    sys.modules["pkg_resources"] = pkg_resources

import tensorflow_hub as hub
import numpy as np
import librosa
import csv
import io
import urllib.request
import json
import os
import shutil

# Load YAMNet from TF Hub
model_handle = 'https://tfhub.dev/google/yamnet/1'
print(f"Loading YAMNet model from {model_handle}...")
model = hub.load(model_handle)
print("Model loaded successfully.")

# Load class map (the names of the 521 classes)
class_map_path = model.class_map_path().numpy().decode('utf-8')
class_names = []
with tf.io.gfile.GFile(class_map_path) as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        class_names.append(row['display_name'])

ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
ACTIVE_PROFILE = "active"
LEGACY_PROFILE = "legacy"
SUPPORTED_PROFILES = {ACTIVE_PROFILE, LEGACY_PROFILE}
_active_profile = ACTIVE_PROFILE

PROFILE_SPECS = {
    ACTIVE_PROFILE: {
        "model_path": os.path.join(ARTIFACTS_DIR, "intent_head_active.keras"),
        "labels_path": os.path.join(ARTIFACTS_DIR, "intent_labels_active.json"),
    },
    LEGACY_PROFILE: {
        "model_path": os.path.join(ARTIFACTS_DIR, "intent_head_legacy.keras"),
        "labels_path": os.path.join(ARTIFACTS_DIR, "intent_labels_legacy.json"),
    },
}
LEGACY_SOURCE_CANDIDATES = [
    (
        os.path.join(ARTIFACTS_DIR, "intent_head.keras"),
        os.path.join(ARTIFACTS_DIR, "intent_labels.json"),
    ),
    (
        PROFILE_SPECS[ACTIVE_PROFILE]["model_path"],
        PROFILE_SPECS[ACTIVE_PROFILE]["labels_path"],
    ),
]
loaded_profiles = {
    ACTIVE_PROFILE: {"model": None, "labels": None},
    LEGACY_PROFILE: {"model": None, "labels": None},
}


def _load_profile(profile: str, force: bool = False):
    spec = PROFILE_SPECS[profile]
    state = loaded_profiles[profile]
    if not force and (state["model"] is not None or state["labels"] is not None):
        return state["model"], state["labels"]
    model_path = spec["model_path"]
    labels_path = spec["labels_path"]
    if not (os.path.exists(model_path) and os.path.exists(labels_path)):
        state["model"] = None
        state["labels"] = None
        return None, None
    try:
        state["model"] = tf.keras.models.load_model(model_path)
        with open(labels_path, "r", encoding="utf-8") as f:
            state["labels"] = json.load(f)
    except Exception as e:
        print(f"Warning: failed to load intent head artifacts({profile}): {e}")
        state["model"] = None
        state["labels"] = None
    return state["model"], state["labels"]


_load_profile(ACTIVE_PROFILE)
_load_profile(LEGACY_PROFILE)

def preprocess_audio(audio_bytes, sr=16000):
    """
    Convert raw audio bytes to a 1D float32 array at 16kHz, required by YAMNet.
    """
    # Try to load encoded audio bytes first (wav/mp3/...)
    try:
        y, _ = librosa.load(io.BytesIO(audio_bytes), sr=sr, mono=True)
    except Exception as e:
        # Fallback for raw PCM16 little-endian bytes from frontend realtime stream
        try:
            pcm16 = np.frombuffer(audio_bytes, dtype="<i2")
            if pcm16.size == 0:
                return None
            y = pcm16.astype(np.float32) / 32768.0
        except Exception:
            print(f"Error loading audio: {e}")
            return None
    
    # YAMNet requires values in [-1.0, 1.0]
    # librosa.load already normalizes float32 to this range, but just to be safe:
    if len(y) > 0:
        max_val = np.max(np.abs(y))
        if max_val > 1.0:
            y = y / max_val
            
    return y

def classify_audio(audio_bytes, profile: str | None = None):
    """
    Run YAMNet classification on audio bytes and return whether a cat was detected.
    """
    resolved_profile = (profile or _active_profile).strip().lower()
    if resolved_profile not in SUPPORTED_PROFILES:
        raise ValueError(f"unsupported profile: {resolved_profile}")
    intent_model, intent_labels = _load_profile(resolved_profile)
    waveform = preprocess_audio(audio_bytes)
    if waveform is None or len(waveform) < 16000 * 0.5: # At least half a second
        return {
            "detected": False,
            "confidence": 0.0,
            "top_class": "none",
            "intent_label": "unknown",
            "intent_confidence": 0.0,
            "intent_topk": [],
            "model_profile": resolved_profile,
        }
    
    # Run the model
    scores, embeddings, spectrogram = model(waveform)
    
    # Average the scores over all frames
    mean_scores = np.mean(scores, axis=0)
    
    # Top 5 predictions
    top_n = 5
    top_class_indices = np.argsort(mean_scores)[::-1][:top_n]
    
    # Check if "Cat" or any cat-related class is in the top predictions
    cat_detected = False
    max_cat_prob = 0.0
    top_predicted_class = class_names[top_class_indices[0]]
    
    cat_related_classes = [
        'Cat', 'Meow', 'Purr', 'Caterwaul', 'Hiss', 'Animal'
    ]
    
    for i in top_class_indices:
        class_name = class_names[i]
        prob = float(mean_scores[i])
        
        if any(cat_keyword in class_name for cat_keyword in cat_related_classes):
            cat_detected = True
            if prob > max_cat_prob:
                max_cat_prob = prob
                top_predicted_class = class_name
                
    intent_label = "unknown"
    intent_confidence = 0.0
    intent_topk = []
    if intent_model is not None and intent_labels and embeddings is not None:
        try:
            embedding_mean = np.mean(embeddings.numpy(), axis=0, keepdims=True).astype(np.float32)
            logits = intent_model(embedding_mean).numpy()[0]
            probs = tf.nn.softmax(logits).numpy()
            topk = int(min(3, len(probs)))
            top_idx = np.argsort(probs)[::-1][:topk]
            intent_topk = [
                {"label": str(intent_labels.get(str(i), i)), "score": float(probs[i])}
                for i in top_idx
            ]
            best_i = int(top_idx[0]) if len(top_idx) else int(np.argmax(probs))
            intent_label = str(intent_labels.get(str(best_i), best_i))
            intent_confidence = float(probs[best_i])
        except Exception as e:
            print(f"Warning: intent head prediction failed: {e}")

    return {
        "detected": cat_detected,
        "confidence": max_cat_prob if cat_detected else float(mean_scores[top_class_indices[0]]),
        "top_class": top_predicted_class,
        "all_top_classes": [{"class": class_names[i], "score": float(mean_scores[i])} for i in top_class_indices],
        "intent_label": intent_label,
        "intent_confidence": intent_confidence,
        "intent_topk": intent_topk,
        "model_profile": resolved_profile,
    }


def set_active_profile(profile: str):
    global _active_profile
    target = profile.strip().lower()
    if target not in SUPPORTED_PROFILES:
        raise ValueError(f"unsupported profile: {target}")
    _active_profile = target
    return {"active_profile": _active_profile}


def archive_current_as_legacy(overwrite: bool = False):
    src_model = ""
    src_labels = ""
    for model_path, labels_path in LEGACY_SOURCE_CANDIDATES:
        if os.path.exists(model_path) and os.path.exists(labels_path):
            src_model = model_path
            src_labels = labels_path
            break
    dst_model = PROFILE_SPECS[LEGACY_PROFILE]["model_path"]
    dst_labels = PROFILE_SPECS[LEGACY_PROFILE]["labels_path"]
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    if not (src_model and src_labels):
        return {
            "ok": False,
            "archived": False,
            "reason": "active_artifacts_missing",
            "legacy_model_path": dst_model,
            "legacy_labels_path": dst_labels,
            "source_model_path": "",
            "source_labels_path": "",
            "overwrite": bool(overwrite),
        }
    if not overwrite and os.path.exists(dst_model) and os.path.exists(dst_labels):
        _load_profile(LEGACY_PROFILE, force=True)
        return {
            "ok": True,
            "archived": False,
            "reason": "legacy_already_exists",
            "legacy_model_path": dst_model,
            "legacy_labels_path": dst_labels,
            "source_model_path": src_model,
            "source_labels_path": src_labels,
            "overwrite": bool(overwrite),
        }
    shutil.copy2(src_model, dst_model)
    shutil.copy2(src_labels, dst_labels)
    _load_profile(LEGACY_PROFILE, force=True)
    return {
        "ok": True,
        "archived": True,
        "reason": "archived_from_active",
        "legacy_model_path": dst_model,
        "legacy_labels_path": dst_labels,
        "source_model_path": src_model,
        "source_labels_path": src_labels,
        "overwrite": bool(overwrite),
    }


def get_runtime_status():
    active_model, active_labels = _load_profile(ACTIVE_PROFILE)
    legacy_model, legacy_labels = _load_profile(LEGACY_PROFILE)
    return {
        "yamnet_loaded": True,
        "active_profile": _active_profile,
        "intent_head_loaded": active_model is not None,
        "intent_labels_loaded": bool(active_labels),
        "legacy_head_loaded": legacy_model is not None,
        "legacy_labels_loaded": bool(legacy_labels),
        "intent_model_path": PROFILE_SPECS[ACTIVE_PROFILE]["model_path"],
        "intent_labels_path": PROFILE_SPECS[ACTIVE_PROFILE]["labels_path"],
        "legacy_model_path": PROFILE_SPECS[LEGACY_PROFILE]["model_path"],
        "legacy_labels_path": PROFILE_SPECS[LEGACY_PROFILE]["labels_path"],
    }
