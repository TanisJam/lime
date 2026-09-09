import copy
import importlib.util
import sys
import types
import unittest
from pathlib import Path


CANDIDATES = ["Funk/R&B", "Jazz", "Blues", "Rock", "Pop", "Electronic"]
TAG_PATH = Path(__file__).parents[1] / "tag-essentia.py"


def load_tag_essentia():
    numpy = types.ModuleType("numpy")
    numpy.ndarray = object
    standard = types.ModuleType("essentia.standard")
    for name in (
        "MonoLoader",
        "TensorflowPredict2D",
        "TensorflowPredictEffnetDiscogs",
        "TensorflowPredictMAEST",
    ):
        setattr(standard, name, type(name, (), {}))
    essentia = types.ModuleType("essentia")
    essentia.standard = standard
    saved = {name: sys.modules.get(name) for name in ("numpy", "essentia", "essentia.standard")}
    sys.modules.update({"numpy": numpy, "essentia": essentia, "essentia.standard": standard})
    sys.path.insert(0, str(TAG_PATH.parent))
    try:
        spec = importlib.util.spec_from_file_location("tag_essentia_under_test", TAG_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.pop(0)
        for name, value in saved.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value


TAG_ESSENTIA = load_tag_essentia()


def manifest():
    return {
        "calibration": True,
        "reference": True,
        "task": "genre",
        "candidates": list(CANDIDATES),
        "clips": [
            {"truth": candidate}
            for candidate in CANDIDATES
            for _ in range(8)
        ],
    }


class CalibrationManifestEligibilityTests(unittest.TestCase):
    def test_exact_balanced_calibration_manifest_is_eligible(self):
        self.assertTrue(TAG_ESSENTIA.can_establish_essentia_calibration(manifest()))

    def test_saved_calibration_can_be_applied_to_an_unbalanced_batch_without_eligibility(self):
        value = manifest()
        value["clips"] = [{"truth": "Funk/R&B"}]
        self.assertFalse(TAG_ESSENTIA.can_establish_essentia_calibration(value))

    def test_non_calibration_or_incomplete_metadata_cannot_establish_normalizer(self):
        for field, value in (
            ("calibration", False),
            ("reference", False),
            ("task", "sweep"),
            ("candidates", ["Jazz", "Funk/R&B", "Blues", "Rock", "Pop", "Electronic"]),
        ):
            changed = copy.deepcopy(manifest())
            changed[field] = value
            self.assertFalse(TAG_ESSENTIA.can_establish_essentia_calibration(changed), field)

    def test_wrong_class_balance_cannot_establish_or_replace_normalizer(self):
        changed = manifest()
        changed["clips"] = changed["clips"][:-1]
        self.assertFalse(TAG_ESSENTIA.can_establish_essentia_calibration(changed))


if __name__ == "__main__":
    unittest.main()
