"""Chat-to-video converter.

Converts a ChatSync conversation into an MP4 video with:
  - TTS narration per message (macOS `say`)
  - Text slides per message (Pillow PNG -> ffmpeg video)
  - Scene concatenation into a final MP4 (1920x1080, 30fps)

This runs on the ChatSync backend (local macOS) because it needs `say`
and `ffmpeg`. When ChatSync is exposed via a tunnel, remote clients
(e.g. SixBrowse on Netlify) can call POST /api/video/convert and receive
the generated MP4.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
import textwrap
from pathlib import Path
from typing import Optional

from models import Conversation, Message, MessageRole, Source, SyncStatus


SLIDE_SCRIPT = Path(__file__).parent / "make_slide.py"


async def _run(cmd: list[str], timeout: int = 30) -> tuple[int, bytes, bytes]:
    """Run a command asynchronously with timeout."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode, stdout, stderr
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise TimeoutError(f"Command timed out: {' '.join(cmd[:3])}")


def _build_scenes(conversation: Conversation) -> list[dict]:
    """Build scene descriptors from a conversation."""
    scenes = []
    title = conversation.title or "Untitled Chat"
    # Clean title for display.
    title = re.sub(r"[\x00-\x1f\x7f-\uffff]+", " ", title).strip()
    title = re.sub(r"\s+", " ", title)[:80]

    # Intro scene.
    scenes.append({
        "type": "title",
        "role": "",
        "content": f"Welcome. In this video, we explore: {title}.",
        "bg": "0x0a0a0b",
        "accent": "0x38bdf8",
    })

    messages = (conversation.messages or [])[:20]
    for msg in messages:
        content = (msg.content or "").strip()
        if not content:
            continue
        # Clean content.
        content = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\uffff]+", " ", content).strip()
        if len(content) < 5:
            continue

        narration = content[:500] + ("..." if len(content) > 500 else "")
        display = content[:300] + ("..." if len(content) > 300 else "")
        is_user = msg.role == MessageRole.USER

        scenes.append({
            "type": "message",
            "role": msg.role.value.upper(),
            "content": narration,
            "displayContent": display,
            "bg": "0x0c1424" if is_user else "0x0c1a14",
            "accent": "0x38bdf8" if is_user else "0x34d399",
        })

    # Outro.
    scenes.append({
        "type": "outro",
        "role": "",
        "content": "Thanks for watching. Like and subscribe for more.",
        "bg": "0x14101c",
        "accent": "0xc084fc",
    })

    return scenes


async def _generate_tts(text: str, output_path: str, voice: str = "Alex") -> None:
    """Generate TTS audio via macOS `say` -> ffmpeg MP3."""
    aiff_path = output_path.replace(".mp3", ".aiff")
    rc, _, stderr = await _run(["say", "-v", voice, "-o", aiff_path, text], timeout=30)
    if rc != 0:
        raise RuntimeError(f"say failed: {stderr.decode()[:200]}")
    rc, _, stderr = await _run(
        ["ffmpeg", "-y", "-i", aiff_path, "-codec:a", "libmp3lame", "-b:a", "128k", output_path],
        timeout=30,
    )
    if rc != 0:
        raise RuntimeError(f"ffmpeg audio failed: {stderr.decode()[:200]}")


async def _get_audio_duration(mp3_path: str) -> float:
    """Get audio duration in seconds via ffprobe."""
    rc, stdout, _ = await _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", mp3_path],
        timeout=10,
    )
    if rc != 0:
        return 5.0
    try:
        return float(stdout.decode().strip()) or 5.0
    except ValueError:
        return 5.0


async def _generate_slide(scene: dict, duration: float, output_path: str, work_dir: str) -> None:
    """Generate a slide video clip from a scene."""
    role_label = scene.get("role", "")
    display_text = scene.get("displayContent") or scene.get("content", "")
    bg = scene.get("bg", "0x0a0a0b")
    accent = scene.get("accent", "0x38bdf8")

    png_path = os.path.join(work_dir, f"slide_{Path(output_path).stem}.png")

    # Generate PNG via make_slide.py.
    rc, _, stderr = await _run(
        ["python3", str(SLIDE_SCRIPT), png_path, role_label, display_text[:400], bg, accent],
        timeout=15,
    )
    if rc != 0:
        raise RuntimeError(f"make_slide.py failed: {stderr.decode()[:200]}")

    # Convert PNG to video clip.
    rc, _, stderr = await _run(
        ["ffmpeg", "-y", "-loop", "1", "-i", png_path,
         "-t", f"{duration:.2f}", "-r", "30",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast",
         "-vf", "scale=1920:1080", output_path],
        timeout=30,
    )
    if rc != 0:
        raise RuntimeError(f"ffmpeg slide failed: {stderr.decode()[:200]}")


async def _combine_scene(slide_path: str, audio_path: str, output_path: str) -> None:
    """Combine slide video + audio into a scene clip."""
    rc, _, stderr = await _run(
        ["ffmpeg", "-y", "-i", slide_path, "-i", audio_path,
         "-c:v", "copy", "-c:a", "aac", "-shortest", output_path],
        timeout=60,
    )
    if rc != 0:
        raise RuntimeError(f"ffmpeg combine failed: {stderr.decode()[:200]}")


async def _concatenate_scenes(scene_paths: list[str], output_path: str) -> None:
    """Concatenate scene clips into the final video."""
    list_file = os.path.join(os.path.dirname(output_path), "concat_list.txt")
    with open(list_file, "w") as f:
        for p in scene_paths:
            f.write(f"file '{p}'\n")

    rc, _, stderr = await _run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file,
         "-c", "copy", output_path],
        timeout=60,
    )
    if rc != 0:
        raise RuntimeError(f"ffmpeg concat failed: {stderr.decode()[:200]}")


async def convert_conversation_to_video(
    conversation: Conversation,
    voice: str = "Alex",
) -> bytes:
    """Convert a conversation to an MP4 video and return the file bytes.

    Raises RuntimeError if ffmpeg or say are not available.
    """
    # Check dependencies.
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found. Install with: brew install ffmpeg")
    if not shutil.which("say"):
        raise RuntimeError("say not found. This endpoint requires macOS.")
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe not found. Install with: brew install ffmpeg")
    if not SLIDE_SCRIPT.exists():
        raise RuntimeError(f"make_slide.py not found at {SLIDE_SCRIPT}")
    if not shutil.which("python3"):
        raise RuntimeError("python3 not found")

    scenes = _build_scenes(conversation)
    if len(scenes) < 2:
        raise ValueError("Not enough content to generate video")

    work_dir = tempfile.mkdtemp(prefix="chatsync-video-")
    scene_paths: list[str] = []

    try:
        for i, scene in enumerate(scenes):
            audio_path = os.path.join(work_dir, f"scene_{i}.mp3")
            slide_path = os.path.join(work_dir, f"slide_{i}.mp4")
            scene_path = os.path.join(work_dir, f"final_{i}.mp4")

            # TTS.
            await _generate_tts(scene["content"], audio_path, voice)
            # Duration from audio.
            duration = await _get_audio_duration(audio_path)
            # Slide video.
            await _generate_slide(scene, duration, slide_path, work_dir)
            # Combine.
            await _combine_scene(slide_path, audio_path, scene_path)
            scene_paths.append(scene_path)

        # Concatenate.
        final_path = os.path.join(work_dir, "final_video.mp4")
        await _concatenate_scenes(scene_paths, final_path)

        with open(final_path, "rb") as f:
            return f.read()

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
