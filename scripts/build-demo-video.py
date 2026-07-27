#!/usr/bin/env python3

from pathlib import Path
import io
import struct

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "output" / "playwright" / "delta-coinbase-guard-v1"
OUTPUT_DIR = ROOT / "output" / "video"
OUTPUT = OUTPUT_DIR / "delta-coinbase-guard-demo.avi"
NAMES = [
    "step-01-intent.png",
    "step-02-policy.png",
    "step-03-confirm.png",
    "step-04-propose.png",
    "step-05-preview.png",
    "step-06-verify.png",
    "step-07-execute.png",
]


def main() -> None:
    images = []
    for name in NAMES:
        path = FRAMES / name
        if not path.is_file():
            raise SystemExit(
                f"Missing {path}. Run the workflow screenshot generator first."
            )
        images.append(Image.open(path).convert("RGB"))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_mjpeg_avi(images, OUTPUT)
    if not OUTPUT.is_file() or OUTPUT.stat().st_size == 0:
        raise SystemExit("Demo video encoding produced no output")
    print(f"Demo video written to {OUTPUT}")


def chunk(name: bytes, payload: bytes) -> bytes:
    padding = b"\0" if len(payload) % 2 else b""
    return name + struct.pack("<I", len(payload)) + payload + padding


def list_chunk(name: bytes, payload: bytes) -> bytes:
    body = name + payload
    return b"LIST" + struct.pack("<I", len(body)) + body


def jpeg_frame(image: Image.Image) -> bytes:
    canvas = Image.new("RGB", (1280, 720), "black")
    resized = image.resize((1152, 720), Image.Resampling.LANCZOS)
    canvas.paste(resized, (64, 0))
    buffer = io.BytesIO()
    canvas.save(buffer, format="JPEG", quality=88, optimize=True)
    return buffer.getvalue()


def write_mjpeg_avi(images: list[Image.Image], path: Path) -> None:
    frames_per_second = 2
    repeats_per_step = 4
    frames = [
        jpeg_frame(image)
        for image in images
        for _ in range(repeats_per_step)
    ]
    maximum_frame = max(map(len, frames))
    total_frames = len(frames)
    avih = struct.pack(
        "<14I",
        1_000_000 // frames_per_second,
        maximum_frame * frames_per_second,
        0,
        0x10,
        total_frames,
        0,
        1,
        maximum_frame,
        1280,
        720,
        0,
        0,
        0,
        0,
    )
    strh = struct.pack(
        "<4s4sIHH8Ihhhh",
        b"vids",
        b"MJPG",
        0,
        0,
        0,
        0,
        1,
        frames_per_second,
        0,
        total_frames,
        maximum_frame,
        0xFFFFFFFF,
        0,
        0,
        0,
        1280,
        720,
    )
    strf = struct.pack(
        "<IiiHH4sIiiII",
        40,
        1280,
        720,
        1,
        24,
        b"MJPG",
        maximum_frame,
        0,
        0,
        0,
        0,
    )
    hdrl = list_chunk(
        b"hdrl",
        chunk(b"avih", avih)
        + list_chunk(b"strl", chunk(b"strh", strh) + chunk(b"strf", strf)),
    )

    movie_payload = bytearray()
    index_payload = bytearray()
    offset = 4
    for frame in frames:
        frame_chunk = chunk(b"00dc", frame)
        movie_payload.extend(frame_chunk)
        index_payload.extend(
            struct.pack("<4sIII", b"00dc", 0x10, offset, len(frame))
        )
        offset += len(frame_chunk)
    body = b"AVI " + hdrl + list_chunk(b"movi", bytes(movie_payload))
    body += chunk(b"idx1", bytes(index_payload))
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)


if __name__ == "__main__":
    main()
