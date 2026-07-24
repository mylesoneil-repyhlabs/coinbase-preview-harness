#!/usr/bin/env python3
from pathlib import Path

from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "output" / "playwright" / "delta-coinbase-guard-v1"
OUTPUT_PATH = ROOT / "output" / "pdf" / "delta-coinbase-guard-v1-workflow.pdf"
PAGE_SIZE = (1440, 900)
SCREENSHOTS = [
    "step-01-intent.png",
    "step-02-policy.png",
    "step-03-confirm.png",
    "step-04-propose.png",
    "step-05-preview.png",
    "step-06-verify.png",
    "step-07-execute.png",
]


def main() -> None:
    missing = [
        name for name in SCREENSHOTS if not (SCREENSHOT_DIR / name).is_file()
    ]
    if missing:
        raise SystemExit(f"Missing workflow screenshots: {', '.join(missing)}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    pdf = Canvas(str(OUTPUT_PATH), pagesize=PAGE_SIZE, pageCompression=1)
    pdf.setTitle("Delta Coinbase Guard V1: Mandate-Gated Execution Workflow")
    pdf.setAuthor("delta")
    pdf.setSubject(
        "Seven-step simulation of policy authorization, Delta verification, "
        "payload-bound execution, and reconciliation."
    )
    pdf.setKeywords(
        "delta, Coinbase, agentic finance, policy enforcement, simulation"
    )

    for name in SCREENSHOTS:
        pdf.drawImage(
            ImageReader(str(SCREENSHOT_DIR / name)),
            0,
            0,
            width=PAGE_SIZE[0],
            height=PAGE_SIZE[1],
            preserveAspectRatio=True,
            anchor="c",
        )
        pdf.showPage()

    pdf.save()
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
