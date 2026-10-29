"""Generate a small Azure texture batch, or process saved candidates without paid calls."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "assets" / "materials" / "ai-scene"
MODEL = "gpt-image-2.5-flare"
VERSION = "2026-09-08"
SCENE_NAMES = ("weathered-plaster", "door-timber", "burlap", "crate-timber", "wall-grime")
NATURE_NAMES = ("bark-elm", "bark-poplar", "bark-willow", "root-litter", "dry-silt")
NAMES = SCENE_NAMES + NATURE_NAMES
COMMON = (
    "Create one original photorealistic base-color material texture for a browser game. "
    "Full-frame flat material surface, orthographic front view, even diffuse lighting, "
    "no directional shadows, no highlights, no ambient occlusion, no perspective, "
    "no vignette. No text, numbers, symbols, people, border, watermark, modern objects "
    "or cinematic composition. Make opposite edges match for seamless repeating. "
)
PROMPTS = {
    "bark-elm": COMMON + (
        "Mature elm tree bark, not cut timber or wooden boards. Neutral warm grey-brown, "
        "interlocking irregular vertical ridges and shallow broken fissures, small "
        "flaking scales, subtle pale dust in recesses. The square represents 80 cm "
        "of bark surface. Medium-light albedo, restrained contrast, fine tactile grain. "
        "No trunk silhouette, roots, leaves, knots, plank joins, moss or deep black grooves."
    ),
    "bark-poplar": COMMON + (
        "Living poplar tree bark, not cut wood or boards. Pale grey with a faint "
        "warm olive cast, mostly smooth weathered surface, sparse narrow broken "
        "vertical fissures and small dark lenticels. The square represents 80 cm "
        "of surface. Natural subtle variation, not birch paper, no horizontal stripes, "
        "no trunk silhouette, roots, leaves, knots, plank joins or green moss."
    ),
    "bark-willow": COMMON + (
        "Old willow bark, not cut timber or boards. Desaturated warm grey-brown, "
        "irregular narrow meandering vertical furrows and soft interwoven corky "
        "ridges. The square represents 80 cm of surface. Medium-light albedo "
        "and restrained shallow fissure contrast, no black channels, planks, "
        "trunk silhouette, roots, leaves, moss or dramatic decay."
    ),
    "root-litter": COMMON + (
        "Top-down ground material under a deciduous tree in a dry northern Chinese "
        "town. Mostly exposed dusty muted reddish grey-brown compact earth, "
        "small scattered curled dry tan leaves and broken leaf fragments in "
        "irregular sparse clusters, a little fine humus and tiny grit. The square "
        "represents 1.6 meters; whole leaves only 3 to 7 cm long, no dense leaf carpet. "
        "Earth must remain visible over at least 75 percent of the surface. "
        "No tree, trunk, roots, grass, rocks, circular stain, border or contact shadow."
    ),
    "dry-silt": COMMON + (
        "Top-down fine dry alluvial sediment from an abandoned shallow river channel. "
        "Light desaturated grey-tan dusty silt, small discontinuous drying cracks, "
        "sandy speckles and a few tiny rounded grains. The square represents "
        "2 meters of flat ground; details have no preferred direction and irregular "
        "sizes. Mostly fine uncracked powder with isolated small cracked mud islands. "
        "No long grooves, tracks, tire marks, parallel bands, ripples, ridges, "
        "uniform polygon grid, grass, large stones, wet mud or water."
    ),
    "door-timber": COMMON + (
        "Weathered unpainted wooden door boards in an ordinary northern Chinese town "
        "circa the 1930s. Five or six parallel VERTICAL wide planks filling the square, "
        "warm desaturated brown aged timber, fine vertical grain, a few subtle knots, "
        "small natural splits, faint pale wear and dirt. Narrow straight vertical "
        "joins only, no deep black gaps. No outer door frame, handles, nails, hinges "
        "or horizontal crossbars: those are separate 3D geometry in the game. "
        "The square covers about 1.9 meters horizontally and 2.45 meters vertically. "
        "No dramatic rot, no moss, no peeling paint, not a finished rendered doorway."
    ),
    "burlap": COMMON + (
        "A close, evenly lit patch of old coarse natural jute sack cloth, muted "
        "khaki tan, finely interwoven horizontal and vertical fibers, subtle irregular "
        "threads, mild dusty variation and occasional dark fibers. Flat woven fabric "
        "only, not a sack or sandbag object, no folds, no stitching, no seams, no holes. "
        "The square represents only 35 centimeters of cloth; individual threads "
        "must be fine enough not to look like rope or a wicker basket."
    ),
    "crate-timber": COMMON + (
        "Unpainted rough-sawn pine boards for ordinary wooden shipping crates "
        "and barrel staves in a 1930s Chinese town. Four broad parallel boards, "
        "wood grain running VERTICALLY, warm muted brown with sun-bleached fibers, "
        "worn wood grain, small knots, subtle scratches, uneven old surface. "
        "Narrow straight board joints, not black cracks. Not polished furniture, "
        "not dark burnt timber, no metal bands, no nails, no labels, no framing "
        "or corner battens: those are separate geometry. Surface only, not a "
        "rendering of a crate. The square represents about 80 centimeters."
    ),
    "wall-grime": (
        "Create an original grayscale game decal MASK atlas on a pure white "
        "1024x1024 background, arranged as four separate 512x512 square cells "
        "in a clean 2 by 2 layout. No labels, grid lines, color, wall texture, "
        "lighting, people, letters, borders, or watermark. Black represents "
        "opaque grime and white represents empty space. Every stain must fade "
        "smoothly to pure WHITE on ALL FOUR edges of its own cell, leaving a "
        "white margin. Top-left: broad irregular low wall damp patch, denser "
        "near its lower middle, thin vertical rising moisture marks. Top-right: "
        "several narrow vertical rain runoff trails, stronger in the upper "
        "middle and tapering down unevenly, for below a windowsill. Bottom-left: "
        "sparse mud splash specks and faint soil stains concentrated low. "
        "Bottom-right: soft irregular mottled mildew patch, scattered tiny "
        "spots with gaps, not a solid rectangle. Restrained weathered surfaces "
        "of ordinary old buildings; no cracks, bullets, craters or holes."
    ),
}


def save_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def checksum(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def verify_deployment_and_prices(endpoint, deployment):
    def cli(*arguments):
        return json.loads(subprocess.run(
            ["az.cmd" if os.name == "nt" else "az", *arguments, "-o", "json", "--only-show-errors"],
            capture_output=True, text=True, check=True,
        ).stdout)
    parsed = urllib.parse.urlsplit(endpoint)
    resource = parsed.hostname.removesuffix(".openai.azure.com")
    if parsed.scheme != "https" or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.port:
        raise ValueError("Use a plain Azure OpenAI HTTPS endpoint, without a path or credentials.")
    if not resource.replace("-", "").isalnum():
        raise ValueError("Invalid Azure resource name.")
    groups = cli("cognitiveservices", "account", "list",
                 "--query", f"[?name=='{resource}'].resourceGroup")
    if len(groups) != 1:
        raise ValueError("Cannot unambiguously locate the Azure resource in the active subscription.")
    actual = cli("cognitiveservices", "account", "deployment", "show",
                 "--name", resource, "--resource-group", groups[0], "--deployment-name", deployment)
    if actual["properties"]["model"]["name"] != MODEL or actual["properties"]["model"]["version"] != VERSION:
        raise ValueError("Deployment model/version differs from the recorded texture pipeline.")
    if actual["sku"]["name"] != "GlobalStandard":
        raise ValueError("The recorded pricing requires a GlobalStandard deployment.")
    account = cli("cognitiveservices", "account", "show", "--name", resource, "--resource-group", groups[0])
    if account["location"] != "eastus2":
        raise ValueError("Recheck regional pricing before using a different resource region.")
    query = urllib.parse.quote(
        "productName eq 'Azure OpenAI Media' and contains(skuName, 'Image-2.5-flare') "
        "and armRegionName eq 'eastus2' and priceType eq 'Consumption'"
    )
    with urllib.request.urlopen(f"https://prices.azure.com/api/retail/prices?$filter={query}", timeout=60) as response:
        rows = json.load(response)["Items"]
    for kind, rate in (("txt inp", 5), ("img inp", 8), ("img opt", 30)):
        matches = [row for row in rows if row["skuName"] == f"Image-2.5-flare {kind} Gl"]
        if not matches or any(row["retailPrice"] != rate or row["unitOfMeasure"] != "1M" or
                              row["currencyCode"] != "USD" for row in matches):
            raise ValueError("Azure retail rates changed or are unavailable; revise the budget before generation.")


def generate(args, names=None, prompts=PROMPTS, prior_estimate_usd=None):
    directory = args.source_dir
    directory.mkdir(parents=True, exist_ok=True)
    if args.reuse_plaster:
        original = json.loads(args.reuse_plaster.read_text(encoding="utf-8"))
        if original["model"] != MODEL or original["version"] != VERSION:
            raise ValueError("The reused plaster sample has a different model/version.")
        source_image = args.reuse_plaster.with_suffix(".png")
        if checksum(source_image)["sha256"] != original["sha256"]:
            raise ValueError("Existing plaster sample does not match its provenance.")
        target = directory / "weathered-plaster.json"
        if not target.exists():
            shutil.copyfile(source_image, directory / "weathered-plaster.png")
            save_json(target, original)
    if not args.endpoint or not args.deployment:
        raise ValueError("Generation requires --endpoint and --deployment; no key is stored.")
    if not args.endpoint.startswith("https://") or not args.endpoint.endswith(".openai.azure.com"):
        raise ValueError("Use an HTTPS Azure OpenAI endpoint without a trailing slash.")
    if not args.deployment.replace("-", "").isalnum():
        raise ValueError("Invalid deployment name.")
    verify_deployment_and_prices(args.endpoint, args.deployment)
    ledger_path = directory / "generation-ledger.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {
        "budgetUsd": 50, "reservedUsdPerAttempt": 10, "attempts": [],
        "priorSourceEstimateUsd": prior_estimate_usd if prior_estimate_usd is not None else
            (0.014442 if args.reuse_plaster else 0),
        "note": "Reservations are conservative workflow allocations, not an Azure billing hard cap. Failed/uncertain requests retain their full reservation. Never retries automatically.",
    }
    last_request = None
    for name in names if names is not None else args.materials:
        image_path, record_path = directory / f"{name}.png", directory / f"{name}.json"
        if image_path.exists() and record_path.exists():
            record = json.loads(record_path.read_text())
            if checksum(image_path)["sha256"] != record["sha256"]:
                raise ValueError(f"Corrupted saved source: {name}")
            continue
        if name not in prompts:
            raise ValueError("Supply the saved plaster sample with --reuse-plaster.")
        if any(attempt["name"] == name for attempt in ledger["attempts"]):
            raise ValueError(f"Prior uncertain/failed request for {name}; inspect ledger before spending again.")
        reserved = ledger.get("priorSourceEstimateUsd", ledger.get("priorPlasterEstimateUsd", 0)) + \
            sum(item["reservedUsd"] for item in ledger["attempts"])
        if reserved + 10 > min(args.budget_usd, 50):
            raise ValueError("Insufficient conservatively reserved budget; refusing generation.")
        if last_request is not None:
            time.sleep(max(0, 65 - (time.monotonic() - last_request)))
        token = subprocess.run(
            ["az.cmd" if os.name == "nt" else "az", "account", "get-access-token",
             "--resource", "https://cognitiveservices.azure.com", "--query", "accessToken",
             "-o", "tsv", "--only-show-errors"], capture_output=True, text=True, check=True,
        ).stdout.strip()
        if not token:
            raise ValueError("Azure CLI did not return a token.")
        body = {"prompt": prompts[name], "n": 1, "size": "1024x1024",
                "quality": "medium", "output_format": "png"}
        attempt = {"name": name, "status": "pending", "reservedUsd": 10,
                   "startedAt": datetime.now(timezone.utc).isoformat()}
        ledger["attempts"].append(attempt)
        save_json(ledger_path, ledger)
        print(f"Generating {name}; reserved USD {reserved + 10:.2f} / {min(args.budget_usd, 50):.2f}; no automatic retries.", flush=True)
        request = urllib.request.Request(
            f"{args.endpoint}/openai/deployments/{args.deployment}/images/generations?api-version=2025-04-01-preview",
            data=json.dumps(body).encode(), method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        last_request = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            attempt["status"] = f"http-{error.code}"
            save_json(ledger_path, ledger)
            raise RuntimeError(f"Azure image generation HTTP {error.code}: {error.read().decode()}") from error
        record = {"model": MODEL, "version": VERSION, "deployment": args.deployment,
                  "pricingVerifiedAt": datetime.now(timezone.utc).date().isoformat(),
                  "request": body, "created": payload.get("created"), "usage": payload.get("usage")}
        save_json(record_path, record)
        if len(payload.get("data", [])) != 1:
            raise ValueError("Expected one image. Request remains reserved in ledger.")
        data = base64.b64decode(payload["data"][0]["b64_json"], validate=True)
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Expected PNG. Request remains reserved in ledger.")
        image_path.write_bytes(data)
        record.update(checksum(image_path))
        usage = record["usage"]
        if not usage or not all(key in usage for key in ("input_tokens", "output_tokens")):
            raise ValueError("Missing usage; request remains reserved in ledger.")
        record["conservativeEstimatedUsd"] = (usage["input_tokens"] * 8 + usage["output_tokens"] * 30) / 1_000_000
        save_json(record_path, record)
        attempt.update(status="completed", conservativeEstimatedUsd=record["conservativeEstimatedUsd"])
        save_json(ledger_path, ledger)
        print(f"Generated {name}: conservative estimate USD {record['conservativeEstimatedUsd']:.6f}", flush=True)


def periodic(image, band=32):
    image = image.copy()
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(band):
            weight = .5 * (1 - x / band)
            a, b = pixels[x, y], pixels[width - 1 - x, y]
            pixels[x, y] = tuple(round(v * (1 - weight) + w * weight) for v, w in zip(a, b))
            pixels[width - 1 - x, y] = tuple(round(w * (1 - weight) + v * weight) for v, w in zip(a, b))
    for x in range(width):
        for y in range(band):
            weight = .5 * (1 - y / band)
            a, b = pixels[x, y], pixels[x, height - 1 - y]
            pixels[x, y] = tuple(round(v * (1 - weight) + w * weight) for v, w in zip(a, b))
            pixels[x, height - 1 - y] = tuple(round(w * (1 - weight) + v * weight) for v, w in zip(a, b))
    return image


def grime_atlas(image, target):
    source = image.convert("L")
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    colors = ((64, 55, 39), (73, 65, 50), (86, 66, 42), (65, 65, 47))
    for cell in range(4):
        x0, y0 = (cell % 2) * 512, (cell // 2) * 512
        gray = source.crop((x0, y0, x0 + 512, y0 + 512))
        pixels = []
        for y in range(512):
            for x in range(512):
                feather = min(1, x / 24, y / 24, (511 - x) / 24, (511 - y) / 24)
                strength = max(0, (247 - gray.getpixel((x, y))) / 247)
                pixels.append((*colors[cell], round(strength * feather * (210 if cell == 1 else 180))))
        patch = Image.new("RGBA", (512, 512))
        patch.putdata(pixels)
        atlas.paste(patch, (x0, y0))
    path = target / "atlas.webp"
    atlas.save(path, lossless=True, method=6)
    with Image.open(path) as decoded:
        alpha = decoded.getchannel("A")
        for edge in (0, 511, 512, 1023):
            if alpha.crop((edge, 0, edge + 1, 1024)).getextrema()[1] != 0 or \
                    alpha.crop((0, edge, 1024, edge + 1)).getextrema()[1] != 0:
                raise ValueError("Grime atlas borders must be fully transparent.")
        if alpha.getextrema()[1] < 60:
            raise ValueError("Grime atlas lacks usable mask contrast.")
    return {"file": "wall-grime/atlas.webp", **checksum(path), "width": 1024, "height": 1024,
            "colorSpace": "sRGB", "transparentCellBorders": True}


def merge_material_records(previous, records, files):
    textures_by_id = {record["id"]: record for record in previous.get("textures", [])}
    files_by_name = {file["file"]: file for file in previous.get("files", [])}
    textures_by_id.update({record["id"]: record for record in records})
    files_by_name.update({file["file"]: file for file in files})
    return list(textures_by_id.values()), list(files_by_name.values())


def sparse_litter_color(color):
    alpha = []
    pixels = color.tobytes()
    for i in range(0, len(pixels), 3):
        r, g, b = pixels[i:i + 3]
        light = max(0, min(1, (.2126 * r + .7152 * g + .0722 * b - 120) / 35))
        warm = max(0, min(1, (r - b - 40) / 30))
        alpha.append(round(255 * (.04 + .96 * light * warm)))
    mask = Image.new("L", color.size)
    mask.putdata(alpha)
    result = color.convert("RGBA")
    result.putalpha(mask)
    return result


def process(directory, names=SCENE_NAMES, budget_usd=50):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUTPUT / "source.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    if previous and (previous["model"] != MODEL or previous["version"] != VERSION or previous["isCC0"]):
        raise ValueError("Existing manifest has incompatible provenance; refusing to overwrite it.")
    records, files = [], []
    for name in names:
        record = json.loads((directory / f"{name}.json").read_text(encoding="utf-8"))
        if record["model"] != MODEL or record["version"] != VERSION:
            raise ValueError(f"Unexpected source model/version: {name}")
        source = directory / f"{name}.png"
        if checksum(source)["sha256"] != record["sha256"]:
            raise ValueError(f"Source hash mismatch: {name}")
        provenance = {"id": name, "sourceSha256": record["sha256"],
                      "model": record["model"], "version": record["version"],
                      "request": record["request"], "created": record["created"],
                      "usage": record["usage"],
                      "conservativeEstimatedUsd": record["conservativeEstimatedUsd"]}
        if "pricingVerifiedAt" in record:
            provenance["pricingVerifiedAt"] = record["pricingVerifiedAt"]
        target = OUTPUT / name
        target.mkdir(exist_ok=True)
        with Image.open(source) as image:
            if image.size != (1024, 1024):
                raise ValueError(f"Expected 1024-square source: {name}")
            if name == "wall-grime":
                files.append(grime_atlas(image, target))
                provenance["processing"] = "White-background grayscale masks converted to tinted alpha; each 512px cell has a 24px transparent feather and decoded transparent border check."
                records.append(provenance)
                continue
            color = periodic(image.convert("RGB"))
        if name == "root-litter":
            sparse_litter_color(color).save(target / "color.webp", quality=86, method=6)
            provenance["processing"] = "Warm/light color selection retains sparse pale leaf details over a 4% soil veil; not semantic segmentation. Separate runtime feather mask preserves the original ground instead of an opaque soil circle."
        else:
            color.save(target / "color.webp", quality=86, method=6)
        # These are subtle image-derived microdetail estimates, not measured PBR height.
        gray = color.resize((512, 512), Image.Resampling.LANCZOS).convert("L")
        blurred = gray.filter(ImageFilter.GaussianBlur(2))
        height = [a - b for a, b in zip(gray.tobytes(), blurred.tobytes())]
        size = gray.width
        normals = []
        for y in range(size):
            for x in range(size):
                dx = (height[y * size + (x + 1) % size] - height[y * size + (x - 1) % size]) * .008
                dy = (height[((y + 1) % size) * size + x] - height[((y - 1) % size) * size + x]) * .008
                length = math.sqrt(dx * dx + dy * dy + 1)
                normals.append(tuple(round((v / length * .5 + .5) * 255) for v in (-dx, dy, 1)))
        normal = Image.new("RGB", gray.size)
        normal.putdata(normals)
        periodic(normal, 8).save(target / "normal.webp", lossless=True, method=6)
        roughness = gray.point(lambda v: round(220 + v * .09)).convert("RGB")
        periodic(roughness, 8).save(target / "roughness.webp", lossless=True, method=6)
        for kind in ("color", "normal", "roughness"):
            path = target / f"{kind}.webp"
            files.append({"file": f"{name}/{kind}.webp", **checksum(path),
                          "width": 1024 if kind == "color" else 512,
                          "height": 1024 if kind == "color" else 512,
                          "colorSpace": "sRGB" if kind == "color" else "linear"})
        with Image.open(target / "color.webp") as decoded:
            p = decoded.convert("RGB")
            edge_x = sum(abs(a - b) for y in range(p.height) for a, b in
                         zip(p.getpixel((0, y)), p.getpixel((p.width - 1, y)))) / (p.height * 3)
            edge_y = sum(abs(a - b) for x in range(p.width) for a, b in
                         zip(p.getpixel((x, 0)), p.getpixel((x, p.height - 1)))) / (p.width * 3)
        if max(edge_x, edge_y) > 8:
            raise ValueError(f"Decoded color edge discontinuity too large: {name}")
        provenance["decodedColorEdgeMeanAbsoluteDifference"] = {"x": edge_x, "y": edge_y}
        records.append(provenance)
    records, files = merge_material_records(previous, records, files)
    checked_at = max([previous.get("pricing", {}).get("checkedAt", "2026-10-28")] +
                     [record.get("pricingVerifiedAt", "2026-10-28") for record in records])
    manifest = {
        "provider": "Azure OpenAI", "license": "Azure-generated-images", "isCC0": False,
        "source": "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/dall-e",
        "licenseUrl": "https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA",
        "model": MODEL, "version": VERSION, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "processing": "Material sets: 32px opposite-edge crossfade; 1024px WebP color Q86; 512px lossless WebP high-pass micro-normal and near-matte roughness estimates. Grime: four tinted alpha masks in one lossless 1024px atlas with transparent cell borders. No measured height, AO, metalness or historical reconstruction is claimed.",
        "budgetUsd": budget_usd,
        "conservativeEstimatedTotalUsd": sum(record["conservativeEstimatedUsd"] for record in records),
        "pricing": {"currency": "USD", "source": "https://prices.azure.com/api/retail/prices",
                    "checkedAt": checked_at, "region": "eastus2", "sku": "GlobalStandard",
                    "perMillionTextInputTokens": 5, "perMillionImageInputTokens": 8,
                    "perMillionImageOutputTokens": 30,
                    "estimateMethod": "All input tokens charged at image-input rate, output at image-output rate; conservative estimate, not final Azure invoice."},
        "textures": records, "files": files,
    }
    save_json(OUTPUT / "source.json", manifest)
    print(json.dumps({"runtimeBytes": sum(file["bytes"] for file in files),
                      "conservativeEstimatedTotalUsd": manifest["conservativeEstimatedTotalUsd"],
                      "edgeChecks": {record["id"]: record["decodedColorEdgeMeanAbsoluteDifference"]
                                     for record in records if "decodedColorEdgeMeanAbsoluteDifference" in record}}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--materials", nargs="+", choices=NAMES, default=SCENE_NAMES,
                        help="Process only these materials; keep all other manifest entries and files.")
    parser.add_argument("--generate", action="store_true", help="Makes paid Azure requests for missing sources only.")
    parser.add_argument("--reuse-plaster", type=Path)
    parser.add_argument("--endpoint", default=os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/"))
    parser.add_argument("--deployment", default=os.environ.get("AZURE_IMAGE_DEPLOYMENT", ""))
    parser.add_argument("--budget-usd", type=float, default=50)
    args = parser.parse_args()
    if not math.isfinite(args.budget_usd) or not 0 < args.budget_usd <= 50:
        parser.error("--budget-usd must be greater than zero and at most 50.")
    if args.generate:
        args.source_dir.mkdir(parents=True, exist_ok=True)
        lock = args.source_dir / "generation.lock"
        with lock.open("x"):
            pass
        try:
            generate(args)
        finally:
            lock.unlink()
    process(args.source_dir, args.materials, args.budget_usd)


if __name__ == "__main__":
    main()
