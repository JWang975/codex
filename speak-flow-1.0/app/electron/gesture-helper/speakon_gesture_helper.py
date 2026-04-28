#!/usr/bin/env python3
"""
Speak flow gesture helper.

This helper is intentionally a small event source: it detects snap and open
palm triggers, then prints newline-delimited JSON events for Electron. It never
presses keys and never talks to Typeless or any external app.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
from typing import Callable, Optional


running = True


def emit(payload: dict) -> None:
    payload.setdefault("ts", time.time())
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


class TriggerGate:
    def __init__(self, cooldown_ms: int, startup_grace_ms: int):
        self.cooldown_s = max(2.5, cooldown_ms / 1000.0)
        self.ready_at = time.time() + max(1.0, startup_grace_ms / 1000.0)
        self.last_trigger_at = 0.0
        self.lock = threading.Lock()

    def trigger(self, source: str) -> bool:
        now = time.time()
        if now < self.ready_at:
            return False
        with self.lock:
            if now - self.last_trigger_at < self.cooldown_s:
                return False
            self.last_trigger_at = now
        emit({"type": "trigger", "source": source, "action": "toggle_recording"})
        return True


class SnapDetector:
    def __init__(self, on_trigger: Callable[[str], bool]):
        self.on_trigger = on_trigger
        self.stream = None
        self.detect_buffer = None
        self.sample_rate = 16000
        self.chunk_size = 1024
        self.detect_buffer_size = 8192
        self.onset_threshold = 0.82
        self.high_freq_threshold = 0.50
        self.very_high_freq_threshold = 0.16
        self.minimum_peak = 0.22
        self.minimum_rms = 0.032
        self.minimum_peak_to_rms = 4.8
        self.minimum_impulse_energy_ratio = 0.22
        self.local_cooldown_s = 3.0
        self.last_onset_at = 0.0

    def start(self) -> bool:
        try:
            import numpy as np
            import sounddevice as sd

            # Import here so the helper can degrade cleanly when librosa is absent.
            import librosa  # noqa: F401

            self.np = np
            self.sd = sd
            self.librosa = librosa
            self.detect_buffer = np.array([], dtype=np.float32)
            self.stream = sd.InputStream(
                channels=1,
                samplerate=self.sample_rate,
                blocksize=self.chunk_size,
                callback=self._audio_callback,
            )
            self.stream.start()
            return True
        except Exception as exc:
            log(f"snap detector unavailable: {exc}")
            return False

    def _audio_callback(self, indata, _frames, _time_info, status) -> None:
        if status:
            log(f"audio status: {status}")
        try:
            audio = indata[:, 0].astype("float32", copy=False)
            self.detect_buffer = self.np.concatenate([self.detect_buffer, audio])
            if len(self.detect_buffer) < self.detect_buffer_size:
                return
            window = self.detect_buffer[: self.detect_buffer_size]
            self.detect_buffer = self.detect_buffer[self.detect_buffer_size // 4 :]
            if self._detect_snap(window):
                self.on_trigger("snap")
        except Exception as exc:
            log(f"snap callback error: {exc}")

    def _detect_snap(self, audio_data) -> bool:
        now = time.time()
        if now - self.last_onset_at < self.local_cooldown_s:
            return False
        if len(audio_data) < 256:
            return False

        peak = float(self.np.max(self.np.abs(audio_data)))
        rms = float(self.np.sqrt(self.np.mean(audio_data ** 2)))
        if peak < self.minimum_peak or rms < self.minimum_rms:
            return False
        if peak / max(rms, 1e-6) < self.minimum_peak_to_rms:
            return False

        abs_audio = self.np.abs(audio_data)
        peak_index = int(self.np.argmax(abs_audio))
        impulse_start = max(0, peak_index - int(self.sample_rate * 0.008))
        impulse_end = min(len(audio_data), peak_index + int(self.sample_rate * 0.032))
        impulse_energy = float(self.np.sum(audio_data[impulse_start:impulse_end] ** 2))
        total_time_energy = float(self.np.sum(audio_data ** 2))
        if total_time_energy <= 0 or impulse_energy / total_time_energy < self.minimum_impulse_energy_ratio:
            return False

        onset = self.librosa.onset.onset_strength(
            y=audio_data,
            sr=self.sample_rate,
            hop_length=512,
            n_fft=1024,
        )
        max_onset = float(self.np.max(onset)) if len(onset) else 0.0
        if max_onset <= self.onset_threshold:
            return False

        spectrum = self.np.abs(self.librosa.stft(audio_data, n_fft=1024))
        freq_bins = self.librosa.fft_frequencies(sr=self.sample_rate, n_fft=1024)
        high_freq_mask = freq_bins > 2000
        if not self.np.any(high_freq_mask):
            return False

        high_freq_energy = self.np.mean(spectrum[high_freq_mask, :])
        very_high_freq_mask = freq_bins > 4200
        very_high_freq_energy = self.np.mean(spectrum[very_high_freq_mask, :]) if self.np.any(very_high_freq_mask) else 0.0
        total_energy = self.np.mean(spectrum)
        if total_energy <= 0:
            return False

        high_freq_ratio = high_freq_energy / total_energy
        very_high_freq_ratio = very_high_freq_energy / total_energy
        if high_freq_ratio > self.high_freq_threshold and very_high_freq_ratio > self.very_high_freq_threshold:
            self.last_onset_at = now
            return True
        return False

    def stop(self) -> None:
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None


class OpenPalmDetector:
    def __init__(self, models_dir: str, hold_ms: int, camera_index: int, on_trigger: Callable[[str], bool]):
        self.models_dir = models_dir
        self.hold_s = max(0.25, hold_ms / 1000.0)
        self.requested_camera_index = camera_index
        self.camera_index: Optional[int] = None
        self.camera_name: Optional[str] = None
        self.on_trigger = on_trigger
        self.thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        self.cap = None

    def start(self) -> bool:
        try:
            import cv2
            import mediapipe as mp
            from mediapipe.tasks.python.core.base_options import BaseOptions
            from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions
            from mediapipe.tasks.python.vision import RunningMode

            model_path = os.path.join(self.models_dir, "hand_landmarker.task")
            if not os.path.exists(model_path):
                raise FileNotFoundError(model_path)

            self.cv2 = cv2
            self.mp = mp
            self.HandLandmarker = HandLandmarker
            self.HandLandmarkerOptions = HandLandmarkerOptions
            self.BaseOptions = BaseOptions
            self.RunningMode = RunningMode
            self.model_path = model_path
            self.cap = self._open_camera()
            if self.cap is None:
                raise RuntimeError("Camera unavailable.")

            self.thread = threading.Thread(target=self._run, name="OpenPalmDetector", daemon=True)
            self.thread.start()
            return True
        except Exception as exc:
            log(f"open palm detector unavailable: {exc}")
            return False

    def _open_camera(self):
        candidates = self._camera_candidates()
        for index in candidates:
            cap = self.cv2.VideoCapture(index)
            if cap.isOpened():
                for _ in range(5):
                    ok, frame = cap.read()
                    if ok and self._is_usable_frame(frame):
                        self.camera_index = index
                        self.camera_name = self._camera_name_for_index(index)
                        cap.set(self.cv2.CAP_PROP_FRAME_WIDTH, 640)
                        cap.set(self.cv2.CAP_PROP_FRAME_HEIGHT, 480)
                        return cap
                    time.sleep(0.03)
            cap.release()
        return None

    def _camera_candidates(self) -> list[int]:
        if self.requested_camera_index >= 0:
            candidates = [self.requested_camera_index]
            candidates.extend(index for index in range(10) if index != self.requested_camera_index)
            return candidates

        macos_candidates = self._macos_camera_candidates()
        if macos_candidates:
            return macos_candidates

        if sys.platform == "darwin":
            return [1, 0, 2, 3, 4, 5, 6, 7, 8, 9]

        return list(range(10))

    @staticmethod
    def _negative_camera_name(name: str) -> bool:
        lower = name.lower()
        return any(word in lower for word in ("obs", "virtual", "screen", "capture", "camo", "snap camera"))

    @staticmethod
    def _preferred_camera_name(name: str) -> bool:
        lower = name.lower()
        return any(word in lower for word in ("facetime", "built-in", "built in", "macbook", "isight", "高清相机", "内置"))

    @classmethod
    def _system_profiler_cameras(cls) -> list[tuple[int, str]]:
        if sys.platform != "darwin":
            return []
        try:
            proc = subprocess.run(
                ["system_profiler", "SPCameraDataType", "-json"],
                capture_output=True,
                text=True,
                timeout=2.5,
                check=False,
            )
            data = json.loads(proc.stdout or "{}")
            items = data.get("SPCameraDataType") or []
            return [(index, str(item.get("_name") or "")) for index, item in enumerate(items) if item.get("_name")]
        except Exception:
            return []

    @classmethod
    def _macos_camera_candidates(cls) -> list[int]:
        ffmpeg_devices = cls._ffmpeg_camera_devices()
        if ffmpeg_devices:
            preferred = [index for index, name in ffmpeg_devices if cls._preferred_camera_name(name) and not cls._negative_camera_name(name)]
            other_real = [index for index, name in ffmpeg_devices if index not in preferred and not cls._negative_camera_name(name)]
            return preferred + other_real

        profiler_devices = cls._system_profiler_cameras()
        if profiler_devices:
            preferred = [index for index, name in profiler_devices if cls._preferred_camera_name(name) and not cls._negative_camera_name(name)]
            other_real = [index for index, name in profiler_devices if index not in preferred and not cls._negative_camera_name(name)]
            return preferred + other_real
        return []

    @classmethod
    def _ffmpeg_camera_devices(cls) -> list[tuple[int, str]]:
        if sys.platform != "darwin":
            return []
        try:
            proc = subprocess.run(
                ["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
                capture_output=True,
                text=True,
                timeout=2.5,
                check=False,
            )
        except Exception:
            return []

        devices: list[tuple[int, str]] = []
        for line in (proc.stderr + "\n" + proc.stdout).splitlines():
            if "] [" not in line:
                continue
            try:
                rest = line.split("] [", 1)[1]
                idx_text, name = rest.split("]", 1)
                devices.append((int(idx_text), name.strip()))
            except Exception:
                continue
        return devices

    @classmethod
    def _camera_name_for_index(cls, index: int) -> Optional[str]:
        for device_index, name in cls._ffmpeg_camera_devices() + cls._system_profiler_cameras():
            if device_index == index:
                return name
        return None

    @staticmethod
    def _is_usable_frame(frame) -> bool:
        if frame is None or not hasattr(frame, "size") or frame.size == 0:
            return False
        return float(frame.mean()) > 5.0 and float(frame.std()) > 2.0

    def _run(self) -> None:
        options = self.HandLandmarkerOptions(
            base_options=self.BaseOptions(model_asset_path=self.model_path),
            num_hands=1,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            running_mode=self.RunningMode.VIDEO,
        )

        open_started_at: Optional[float] = None
        last_frame_at = 0.0
        frame_interval = 1.0 / 15.0

        try:
            with self.HandLandmarker.create_from_options(options) as landmarker:
                while running and not self.stop_event.is_set():
                    now = time.time()
                    if now - last_frame_at < frame_interval:
                        time.sleep(0.01)
                        continue
                    last_frame_at = now

                    ok, frame = self.cap.read()
                    if not ok:
                        time.sleep(0.05)
                        continue

                    rgb = self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB)
                    mp_image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
                    result = landmarker.detect_for_video(mp_image, int(now * 1000))
                    landmarks = result.hand_landmarks[0] if result.hand_landmarks else None

                    if landmarks and self._is_open_palm(landmarks):
                        if open_started_at is None:
                            open_started_at = now
                        elif now - open_started_at >= self.hold_s:
                            if self.on_trigger("open_palm"):
                                open_started_at = None
                    else:
                        open_started_at = None
        except Exception as exc:
            log(f"open palm detector error: {exc}")
        finally:
            if self.cap:
                self.cap.release()
                self.cap = None

    @staticmethod
    def _is_open_palm(landmarks) -> bool:
        if len(landmarks) < 21:
            return False

        wrist = landmarks[0]
        fingers = [(8, 5), (12, 9), (16, 13), (20, 17)]
        extended_count = 0

        for tip_idx, mcp_idx in fingers:
            tip = landmarks[tip_idx]
            mcp = landmarks[mcp_idx]
            tip_dist = ((tip.x - wrist.x) ** 2 + (tip.y - wrist.y) ** 2) ** 0.5
            mcp_dist = ((mcp.x - wrist.x) ** 2 + (mcp.y - wrist.y) ** 2) ** 0.5
            if tip_dist > mcp_dist * 1.1:
                extended_count += 1

        thumb_tip = landmarks[4]
        thumb_dist = ((thumb_tip.x - wrist.x) ** 2 + (thumb_tip.y - wrist.y) ** 2) ** 0.5
        return extended_count >= 4 and thumb_dist > 0.15

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.5)
        if self.cap:
            self.cap.release()
            self.cap = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snap", choices=("0", "1"), default="1")
    parser.add_argument("--open-palm", choices=("0", "1"), default="1")
    parser.add_argument("--hold-ms", type=int, default=1200)
    parser.add_argument("--cooldown-ms", type=int, default=3000)
    parser.add_argument("--startup-grace-ms", type=int, default=3000)
    parser.add_argument("--camera-index", type=int, default=-1)
    parser.add_argument("--models-dir", default=os.path.join(os.path.dirname(__file__), "models"))
    return parser.parse_args()


def handle_signal(_signum, _frame) -> None:
    global running
    running = False


def main() -> int:
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    args = parse_args()
    gate = TriggerGate(args.cooldown_ms, args.startup_grace_ms)
    detectors = []
    requested = []
    capabilities = []
    problems = []
    camera_index: Optional[int] = None
    camera_name: Optional[str] = None

    if args.snap == "1":
        requested.append("snap")
        snap = SnapDetector(gate.trigger)
        if snap.start():
            detectors.append(snap)
            capabilities.append("snap")
        else:
            problems.append("响指不可用，请检查麦克风权限和 sounddevice/librosa。")

    if args.open_palm == "1":
        requested.append("open_palm")
        palm = OpenPalmDetector(args.models_dir, args.hold_ms, args.camera_index, gate.trigger)
        if palm.start():
            detectors.append(palm)
            capabilities.append("open_palm")
            camera_index = palm.camera_index
            camera_name = palm.camera_name
        else:
            problems.append(f"手掌不可用，摄像头 {args.camera_index} 无法启动。")

    if not capabilities:
        emit({
            "type": "status",
            "status": "error",
            "capabilities": [],
            "cameraIndex": camera_index if camera_index is not None else args.camera_index,
            "cameraName": camera_name,
            "message": "没有可用的手势能力。" + " ".join(problems),
        })
        return 2

    status = "ready" if set(capabilities) == set(requested) else "degraded"
    emit({
        "type": "status",
        "status": status,
        "capabilities": capabilities,
        "cameraIndex": camera_index,
        "cameraName": camera_name,
        "message": "手势 helper 已就绪。" if status == "ready" else "手势 helper 部分可用。" + " ".join(problems),
    })

    try:
        while running:
            time.sleep(0.25)
    finally:
        for detector in detectors:
            detector.stop()
        emit({"type": "status", "status": "stopped", "capabilities": [], "message": "手势 helper 已停止。"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
