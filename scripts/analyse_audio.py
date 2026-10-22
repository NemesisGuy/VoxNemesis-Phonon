"""Analyse the diagnostic WAVs: where the NaNs are, and how the WebGPU output differs from
the CPU output.

    python scripts/analyse_audio.py
"""

from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np

DIR = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Reign\AppData\Local\Temp\voxnemesis-audio-diagnostic")


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return audio, rate


def analyse(path: Path) -> None:
    audio, rate = read_wav(path)
    nan = np.isnan(audio).sum()
    inf = np.isinf(audio).sum()
    finite = audio[np.isfinite(audio)]

    print(f"\n=== {path.name} ===")
    print(f"  samples={audio.size} rate={rate} duration={audio.size / rate:.2f}s")
    print(f"  NaN={nan}  Inf={inf}  rms={np.sqrt((finite ** 2).mean()) if finite.size else 0:.5f}")

    if nan:
        idx = np.where(np.isnan(audio))[0]
        # Contiguous runs of NaN.
        breaks = np.where(np.diff(idx) > 1)[0]
        starts = np.concatenate(([idx[0]], idx[breaks + 1]))
        ends = np.concatenate((idx[breaks], [idx[-1]]))
        print(f"  NaN runs: {len(starts)}")
        for s, e in list(zip(starts, ends))[:6]:
            print(f"    {s}..{e}  ({s / rate:.2f}s..{e / rate:.2f}s, {e - s + 1} samples)")
        if len(starts) > 6:
            print(f"    ... and {len(starts) - 6} more")
        first_nan = starts[0]
        print(f"  clean audio before the first NaN: {first_nan / rate:.2f}s")
        pre = audio[:first_nan]
        pre = pre[np.isfinite(pre)]
        if pre.size:
            print(f"  pre-NaN rms={np.sqrt((pre ** 2).mean()):.5f} peak={np.abs(pre).max():.5f}")


def compare(cpu_path: Path, gpu_path: Path) -> None:
    cpu, rate = read_wav(cpu_path)
    gpu, rate2 = read_wav(gpu_path)
    print(f"\n=== cpu vs webgpu ===")
    print(f"  cpu   {cpu.size} samples ({cpu.size / rate:.2f}s)")
    print(f"  gpu   {gpu.size} samples ({gpu.size / rate2:.2f}s)")
    print(f"  ratio gpu/cpu = {gpu.size / cpu.size:.4f}")

    # Cross-correlate the first clean second of each to see whether the GPU output is the
    # CPU output played at a different speed, or a different signal entirely.
    n = min(rate, cpu.size, gpu.size)
    a = cpu[:n].astype(np.float64)
    b = gpu[:n].astype(np.float64)
    b = np.nan_to_num(b)

    a = a - a.mean()
    b = b - b.mean()
    corr = float(np.corrcoef(a, b)[0, 1])
    print(f"  correlation over the first {n / rate:.1f}s: {corr:.4f}")

    # Is the GPU signal the CPU signal at 2x speed?  Resample the CPU by half and compare.
    half = cpu[: (cpu.size // 2) * 2].reshape(-1, 2).mean(axis=1)
    m = min(half.size, gpu.size)
    c = np.corrcoef(half[:m].astype(np.float64), np.nan_to_num(gpu[:m]).astype(np.float64))[0, 1]
    print(f"  correlation of cpu-decimated-by-2 vs gpu: {c:.4f}")

    # Where does the GPU audio diverge from the CPU audio?
    diff = np.abs(np.nan_to_num(gpu[:n]) - cpu[:n])
    running = np.cumsum(diff)
    total = running[-1] if running.size else 0
    if total > 0:
        for frac in (0.25, 0.5, 0.75):
            k = int(n * frac)
            print(f"  mean |diff| over the first {frac * 100:.0f}%: {running[k] / max(k, 1):.5f}")


def main() -> int:
    for path in sorted(DIR.glob("*.wav")):
        analyse(path)

    for label in ("short", "long"):
        cpu = DIR / f"cpu-{label}.wav"
        gpu = DIR / f"auto-{label}.wav"
        if cpu.exists() and gpu.exists():
            compare(cpu, gpu)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
