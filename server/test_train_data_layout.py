import os
import shutil
import sys
import tempfile
import unittest

SERVER_DIR = os.path.dirname(__file__)
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import train_intent_head as train_script


class TrainDataLayoutTests(unittest.TestCase):
    def test_discover_leaf_class_dirs_from_nested_structure(self):
        root = tempfile.mkdtemp(prefix="meow_train_layout_")
        try:
            os.makedirs(os.path.join(root, "A", "A1"), exist_ok=True)
            os.makedirs(os.path.join(root, "A", "A2"), exist_ok=True)
            os.makedirs(os.path.join(root, "B", "B1"), exist_ok=True)
            with open(os.path.join(root, "A", "A1", "x.mp3"), "wb") as f:
                f.write(b"1")
            with open(os.path.join(root, "A", "A2", "x.wav"), "wb") as f:
                f.write(b"1")
            with open(os.path.join(root, "B", "B1", "x.flac"), "wb") as f:
                f.write(b"1")
            classes = train_script.discover_leaf_class_dirs(root)
            self.assertIn("A1", classes)
            self.assertIn("A2", classes)
            self.assertIn("B1", classes)
            self.assertEqual(len(classes), 3)
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
