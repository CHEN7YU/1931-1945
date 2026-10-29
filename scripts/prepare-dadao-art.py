"""Prepare local dadao textures; paid generation requires the explicit --generate flag."""
import argparse
from datetime import datetime, timezone
import importlib.util
import math
import os
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("scene_art", ROOT / "scripts" / "prepare-scene-art.py")
scene_art = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scene_art)
OUTPUT = ROOT / "public" / "assets" / "materials" / "ai-dadao"
CLOTH_TILE_METERS = 0.08
COMMON = (
    "Create one original photorealistic material BASE COLOR texture, not an object "
    "render or concept art. Fill the entire 1024-square frame with a flat surface "
    "seen straight on. Neutral even diffuse illumination; no highlights, shadows, "
    "ambient occlusion, perspective, gradients, vignette, text, watermarks or border. "
    "Opposite edges must tile seamlessly. Fine restrained detail, not stylized. "
)
PROMPTS = {
    "steel": COMMON + (
        "Ordinary old carbon steel for a utilitarian Chinese dadao blade. Subtle "
        "neutral gray steel, very fine mostly VERTICAL longitudinal grinding marks, "
        "scattered short hairline scratches, faint uneven gray patina and only a "
        "few tiny muted brown oxidation freckles. Mostly clean bare metal, no "
        "heavy rust, hammered dimples, Damascus waves, wood grain or shiny chrome. "
        "The surface covers about 10 cm across and 60 cm vertically, shown compressed "
        "into this square. No blade silhouette, cutting edge, handle or weapon. "
        "Do not draw a bright stripe: the real 3D bevel and game lighting create it."
    ),
    "cotton": COMMON + (
        "A flat 8 by 8 centimeter patch of finely plain-woven old cotton tape used "
        "to wrap a tool grip. Muted dark olive khaki brown dye, densely woven small "
        "threads, fine crosswise fibers, mild rubbed and faded variation. No coarse "
        "jute, burlap, rope, knitted loops, large weave, folds, seams, holes, blood, "
        "objects or bandage roll. Not a picture of a wrapped handle. The texture "
        "will be applied to actual narrow overlapping 3D cotton strips."
    ),
}


def prepare_color(image, kind):
    image = image.convert("RGB")
    gray = image.convert("L")
    mean = ImageStat.Stat(gray).mean[0]
    pixels = []
    data = image.tobytes()
    for r, g, b in zip(data[0::3], data[1::3], data[2::3]):
        value = (r + g + b) / 3
        detail = max(-28, min(28, (value - mean) * (0.65 if kind == "steel" else 0.5)))
        oxide = max(0, min(1, (r - b - 5) / 35)) if kind == "steel" else 0
        base = (174, 176, 175) if kind == "steel" else (104, 96, 75)
        pixels.append(tuple(round(base[c] + detail - oxide * (5, 12, 16)[c]) for c in range(3)))
    image.putdata(pixels)
    return scene_art.periodic(image)


def prepare_maps(color, kind, target):
    size = (256, 1024) if kind == "steel" else (256, 256)
    small = color.resize(size, Image.Resampling.LANCZOS)
    gray = small.convert("L")
    blurred = gray.filter(ImageFilter.GaussianBlur(1.5))
    high = [a - b for a, b in zip(gray.tobytes(), blurred.tobytes())]
    width, height = size
    roughness, metalness, normals = [], [], []
    for y in range(height):
        for x in range(width):
            at = y * width + x
            dx = (high[y * width + (x + 1) % width] - high[y * width + (x - 1) % width]) * .025
            dy = (high[((y + 1) % height) * width + x] - high[((y - 1) % height) * width + x]) * .025
            if kind == "steel":
                bevel = max(0, min(1, (x / (width - 1) - .73) / .27))
                r, g, b = small.getpixel((x, y))
                oxide = max(0, min(1, (r - b + 1) / 12))
                roughness.append(round(max(65, min(175, 127 - bevel * 38 + high[at] * .7 + oxide * 24))))
                metalness.append(round(248 - oxide * 50))
            else:
                roughness.append(round(max(218, min(246, 232 + high[at] * .5))))
            length = math.sqrt(dx * dx + dy * dy + 1)
            normals.append(tuple(round((v / length * .5 + .5) * 255) for v in (-dx, dy, 1)))
    normal = Image.new("RGB", size)
    normal.putdata(normals)
    scene_art.periodic(normal, 8).save(target / "normal.webp", lossless=True, method=6)
    for name, pixels in (("roughness", roughness), ("metalness", metalness)):
        if not pixels:
            continue
        image = Image.new("L", size)
        image.putdata(pixels)
        if kind != "steel":
            image = scene_art.periodic(image.convert("RGB"), 8)
        image.save(target / f"{name}.webp", lossless=True, method=6)


def process(directory):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    sources, files = [], []
    for kind in PROMPTS:
        record = scene_art.json.loads((directory / f"{kind}.json").read_text(encoding="utf-8"))
        path = directory / f"{kind}.png"
        if record["model"] != scene_art.MODEL or record["version"] != scene_art.VERSION or \
                scene_art.checksum(path)["sha256"] != record["sha256"]:
            raise ValueError(f"Unverified original image: {kind}")
        if not record.get("usage") or record["request"]["prompt"] != PROMPTS[kind]:
            raise ValueError(f"Missing usage or unexpected prompt: {kind}")
        target = OUTPUT / kind
        target.mkdir(exist_ok=True)
        with Image.open(path) as image:
            if image.size != (1024, 1024):
                raise ValueError(f"Expected a 1024-square source: {kind}")
            color = prepare_color(image, kind)
        color.resize((512, 2048) if kind == "steel" else (512, 512), Image.Resampling.LANCZOS) \
            .save(target / "color.webp", quality=90, method=6)
        prepare_maps(color, kind, target)
        with Image.open(target / "color.webp") as decoded:
            pixels = decoded.convert("RGB")
            width, height = pixels.size
            edge_x = sum(abs(a - b) for y in range(height) for a, b in
                         zip(pixels.getpixel((0, y)), pixels.getpixel((width - 1, y)))) / (height * 3)
            edge_y = sum(abs(a - b) for x in range(width) for a, b in
                         zip(pixels.getpixel((x, 0)), pixels.getpixel((x, height - 1)))) / (width * 3)
            if max(edge_x, edge_y) > 8:
                raise ValueError(f"Decoded color seam exceeds tolerance: {kind}")
        sources.append({"id": kind, "sourceSha256": record["sha256"], "request": record["request"],
                        "usage": record["usage"], "created": record["created"],
                        "conservativeEstimatedUsd": record["conservativeEstimatedUsd"],
                        "decodedColorEdgeMeanAbsoluteDifference": {"x": edge_x, "y": edge_y}})
        for name in ("color", "normal", "roughness", "metalness") if kind == "steel" else ("color", "normal", "roughness"):
            path = target / f"{name}.webp"
            with Image.open(path) as image:
                width, height = image.size
            files.append({"file": f"{kind}/{name}.webp", **scene_art.checksum(path),
                          "width": width, "height": height,
                          "colorSpace": "sRGB" if name == "color" else "linear"})
    scene_art.save_json(OUTPUT / "source.json", {
        "provider": "Azure OpenAI", "license": "Azure-generated-images", "isCC0": False,
        "source": "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/dall-e",
        "licenseUrl": "https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA",
        "model": scene_art.MODEL, "version": scene_art.VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(), "budgetUsd": 50,
        "conservativeEstimatedTotalUsd": sum(item["conservativeEstimatedUsd"] for item in sources),
        "processing": "Original base-color candidates with restrained contrast and normalized steel/cotton tones. "
                      "Opposite edges blended before WebP encoding; decoded color seams checked. "
                      "Low-strength image-derived micro-normals; authored roughness and metalness estimates. "
                      "Steel bevel roughness follows the actual blade UV, not a painted bright outline. "
                      "Not measured/scanned PBR, historical evidence, or a generated 3D model.",
        "cottonMetersPerTile": CLOTH_TILE_METERS, "textures": sources, "files": files,
    })
    print(scene_art.json.dumps({"files": len(files), "runtimeBytes": sum(item["bytes"] for item in files),
                               "conservativeEstimatedUsd": sum(item["conservativeEstimatedUsd"] for item in sources)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--generate", action="store_true", help="Makes two paid Azure requests at most; no automatic retries.")
    parser.add_argument("--endpoint", default=os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/"))
    parser.add_argument("--deployment", default=os.environ.get("AZURE_IMAGE_DEPLOYMENT", ""))
    parser.add_argument("--budget-usd", type=float, default=50)
    parser.set_defaults(reuse_plaster=None)
    args = parser.parse_args()
    if not math.isfinite(args.budget_usd) or not 0 < args.budget_usd <= 50:
        parser.error("--budget-usd must be greater than zero and at most 50.")
    if args.generate:
        args.source_dir.mkdir(parents=True, exist_ok=True)
        lock = args.source_dir / "generation.lock"
        with lock.open("x"):
            pass
        try:
            scene_art.generate(args, names=tuple(PROMPTS), prompts=PROMPTS, prior_estimate_usd=0)
        finally:
            lock.unlink()
    process(args.source_dir)


if __name__ == "__main__":
    main()
