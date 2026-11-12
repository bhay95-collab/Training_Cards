"""Builds dist/TrainingCard.html: one self-contained file.

Inlines: course data (data/courses.json), the Aztec barcode bundle and the Inter font.
Usage: python3 build/build.py
"""
import base64
import datetime
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


def aztec_bundle():
    out = DIST / "aztec.js"
    subprocess.run(
        ["npx", "esbuild", "build/barcode-entry.mjs", "--bundle", "--minify",
         "--format=iife", f"--outfile={out}", "--log-level=warning"],
        cwd=ROOT, check=True)
    js = out.read_text()
    out.unlink()
    return js


def main():
    DIST.mkdir(exist_ok=True)
    data = json.loads((ROOT / "data" / "courses.json").read_text())
    data.setdefault("updated", datetime.date.today().strftime("%d %b %Y"))
    data_js = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")

    font = ROOT / "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"
    font_b64 = base64.b64encode(font.read_bytes()).decode()

    html = (ROOT / "src" / "index.html").read_text()
    blood_b64 = base64.b64encode((ROOT / "assets" / "blood-bag.png").read_bytes()).decode()

    for marker in ("/*__DATA__*/", "/*__AZTEC__*/", "__INTER_WOFF2__", "__BLOODBAG_PNG__"):
        assert html.count(marker) == 1, marker
    html = (html.replace("/*__AZTEC__*/", aztec_bundle().replace("</script", "<\\/script"))
                .replace("/*__DATA__*/", data_js)
                .replace("__INTER_WOFF2__", font_b64)
                .replace("__BLOODBAG_PNG__", blood_b64))

    out = DIST / "TrainingCard.html"
    out.write_text(html)
    print(f"Built {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
