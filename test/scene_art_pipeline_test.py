import copy
from pathlib import Path
import runpy
import unittest
from PIL import Image


PIPELINE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "prepare-scene-art.py"))


class SceneArtPipelineTest(unittest.TestCase):
    def test_partial_batch_preserves_previously_approved_sources(self):
        previous = {
            "textures": [{"id": "weathered-plaster", "sourceSha256": "original"}],
            "files": [{"file": "weathered-plaster/color.webp", "sha256": "approved"}],
        }
        original = copy.deepcopy(previous)
        records, files = PIPELINE["merge_material_records"](
            previous, [{"id": "bark-elm", "sourceSha256": "new"}],
            [{"file": "bark-elm/color.webp", "sha256": "new-file"}],
        )
        self.assertEqual(records[0], previous["textures"][0])
        self.assertEqual(files[0], previous["files"][0])
        self.assertEqual(len(records), 2)
        self.assertEqual(previous, original)

    def test_processing_same_material_replaces_instead_of_duplicating_it(self):
        previous = {"textures": [{"id": "bark-elm", "sourceSha256": "old"}],
                    "files": [{"file": "bark-elm/color.webp", "sha256": "old"}]}
        records, files = PIPELINE["merge_material_records"](
            previous, [{"id": "bark-elm", "sourceSha256": "updated"}],
            [{"file": "bark-elm/color.webp", "sha256": "updated"}],
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(len(files), 1)
        self.assertEqual(records[0]["sourceSha256"], "updated")

    def test_nature_prompts_request_materials_not_lit_objects(self):
        self.assertEqual(len(PIPELINE["NATURE_NAMES"]), 5)
        for name in PIPELINE["NATURE_NAMES"]:
            prompt = PIPELINE["PROMPTS"][name]
            self.assertIn("no directional shadows", prompt)
            self.assertIn("seamless", prompt)
        self.assertIn("tire marks", PIPELINE["PROMPTS"]["dry-silt"])
        self.assertIn("1.6 meters", PIPELINE["PROMPTS"]["root-litter"])

    def test_litter_keeps_leaves_without_repainting_the_ground_as_a_circle(self):
        source = Image.new("RGB", (3, 1))
        source.putdata([(110, 90, 75), (190, 150, 90), (190, 185, 180)])
        result = PIPELINE["sparse_litter_color"](source)
        self.assertEqual(source.mode, "RGB")
        self.assertLess(result.getpixel((0, 0))[3], 12)
        self.assertGreater(result.getpixel((1, 0))[3], 220)
        self.assertLess(result.getpixel((2, 0))[3], 12)


if __name__ == "__main__":
    unittest.main()
