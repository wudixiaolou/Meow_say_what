import argparse
import json
import os
import sys
import types
from typing import List, Tuple

import numpy as np

try:
    import pkg_resources
except ImportError:
    from packaging.version import parse as _parse_version

    pkg_resources = types.ModuleType("pkg_resources")
    pkg_resources.parse_version = _parse_version
    sys.modules["pkg_resources"] = pkg_resources

SAMPLE_RATE = 16000
AUDIO_EXTENSIONS = (".wav", ".mp3", ".ogg", ".flac", ".m4a")


def parse_args():
    parser = argparse.ArgumentParser(description="Train lightweight cat intent head on top of YAMNet embeddings.")
    parser.add_argument("--data-dir", required=True, help="Directory with class subfolders containing wav files.")
    parser.add_argument("--output-dir", default="artifacts", help="Output directory for model artifacts.")
    parser.add_argument("--model-name", default="intent_head_active.keras")
    parser.add_argument("--labels-name", default="intent_labels_active.json")
    parser.add_argument("--classes", nargs="+", default=None, help="Ordered label names.")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def load_yamnet():
    import tensorflow_hub as hub

    return hub.load("https://tfhub.dev/google/yamnet/1")


def load_waveform(path: str) -> np.ndarray:
    import librosa

    wav, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    if wav.size == 0:
        return np.zeros((SAMPLE_RATE,), dtype=np.float32)
    max_abs = np.max(np.abs(wav))
    if max_abs > 1.0:
        wav = wav / max_abs
    return wav.astype(np.float32)


def discover_leaf_class_dirs(data_dir: str) -> dict[str, str]:
    discovered: dict[str, str] = {}
    suffix_counter: dict[str, int] = {}
    for root, _, files in os.walk(data_dir):
        has_audio = any(name.lower().endswith(AUDIO_EXTENSIONS) for name in files)
        if not has_audio:
            continue
        name = os.path.basename(root).strip()
        if not name:
            continue
        if name in discovered and os.path.normcase(discovered[name]) != os.path.normcase(root):
            suffix_counter[name] = suffix_counter.get(name, 1) + 1
            name = f"{name}__{suffix_counter[name]}"
        discovered[name] = root
    return dict(sorted(discovered.items(), key=lambda kv: kv[0].lower()))


def resolve_class_dirs(data_dir: str, classes: List[str] | None) -> dict[str, str]:
    discovered = discover_leaf_class_dirs(data_dir)
    if not discovered:
        raise RuntimeError(f"No class folders with audio files found under: {data_dir}")
    if not classes:
        return discovered
    selected: dict[str, str] = {}
    for label in classes:
        if label in discovered:
            selected[label] = discovered[label]
            continue
        direct_folder = os.path.join(data_dir, label)
        if os.path.isdir(direct_folder):
            selected[label] = direct_folder
            continue
        raise RuntimeError(f"Class folder not found for label: {label}")
    return selected


def build_dataset(class_dirs: List[Tuple[str, str]], yamnet) -> Tuple[np.ndarray, np.ndarray]:
    x_list: List[np.ndarray] = []
    y_list: List[int] = []
    for idx, (_, folder) in enumerate(class_dirs):
        for name in os.listdir(folder):
            if not name.lower().endswith(AUDIO_EXTENSIONS):
                continue
            fp = os.path.join(folder, name)
            waveform = load_waveform(fp)
            _, embeddings, _ = yamnet(waveform)
            emb = np.mean(embeddings.numpy(), axis=0)
            x_list.append(emb.astype(np.float32))
            y_list.append(idx)
    if not x_list:
        raise RuntimeError("No training samples found. Check data directory and class folders.")
    x = np.vstack(x_list).astype(np.float32)
    y = np.array(y_list, dtype=np.int32)
    return x, y


def split_train_val(x: np.ndarray, y: np.ndarray, val_ratio: float, seed: int):
    rng = np.random.default_rng(seed)
    indices = np.arange(len(x))
    rng.shuffle(indices)
    x = x[indices]
    y = y[indices]
    split = max(1, int(len(x) * (1 - val_ratio)))
    x_train, x_val = x[:split], x[split:]
    y_train, y_val = y[:split], y[split:]
    if len(x_val) == 0:
        x_val, y_val = x_train[-1:], y_train[-1:]
    return x_train, y_train, x_val, y_val


def build_head(num_classes: int):
    import tensorflow as tf

    return tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(1024,), dtype=tf.float32),
            tf.keras.layers.Dense(256, activation="relu"),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(num_classes),
        ],
        name="meow_intent_head",
    )


def main():
    import tensorflow as tf

    args = parse_args()
    class_map = resolve_class_dirs(args.data_dir, args.classes)
    class_dirs = list(class_map.items())
    class_names = [name for name, _ in class_dirs]
    tf.keras.utils.set_random_seed(args.seed)
    yamnet = load_yamnet()
    x, y = build_dataset(class_dirs, yamnet)
    x_train, y_train, x_val, y_val = split_train_val(x, y, args.val_ratio, args.seed)

    model = build_head(num_classes=len(class_names))
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True),
        metrics=["accuracy"],
    )
    model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=args.epochs,
        batch_size=args.batch_size,
        callbacks=[tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=4, restore_best_weights=True)],
        verbose=1,
    )

    os.makedirs(args.output_dir, exist_ok=True)
    model_path = os.path.join(args.output_dir, args.model_name)
    labels_path = os.path.join(args.output_dir, args.labels_name)
    model.save(model_path)
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump({str(i): label for i, label in enumerate(class_names)}, f, ensure_ascii=False, indent=2)
    print(f"Saved model: {model_path}")
    print(f"Saved labels: {labels_path}")


if __name__ == "__main__":
    main()
