#!/usr/bin/env python3
"""Focused standard-library tests for the passive Kibo snapshot tool."""
import importlib.util
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

# Keep this read-only reference test from creating bytecode beside the library.
sys.dont_write_bytecode = True
MODULE = Path(__file__).with_name("snapshot.py")
spec = importlib.util.spec_from_file_location("kibo_snapshot", MODULE)
assert spec and spec.loader
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotToolTests(unittest.TestCase):
    def test_rejects_unsafe_tree_paths(self) -> None:
        for path in ("", "/absolute", "../escape", "folder/../escape", "folder//file"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                snapshot.safe_tree_path(path)

    def test_accepts_safe_tree_path(self) -> None:
        self.assertEqual(str(snapshot.safe_tree_path("packages/patterns/a/b.tsx")), "packages/patterns/a/b.tsx")

    def test_extracts_only_literal_exported_pattern_titles(self) -> None:
        self.assertEqual(snapshot.title_from_source(b'export const title = "Notifications Button";'), "Notifications Button")
        self.assertIsNone(snapshot.title_from_source(b"export const title = makeTitle();"))

    def test_fetch_reuses_cache_with_expected_origin(self) -> None:
        cache = snapshot.project_root(snapshot.reference_root()) / '.cache/kibo-reference-fetch/git'
        replies = ['', str(cache), 'origin\n', snapshot.SOURCE_URL + '\n', '', snapshot.REVISION, 'commit\n']
        with patch.object(snapshot, 'run_git', side_effect=replies) as git:
            snapshot.fetch_repository(cache)
        self.assertIn(['fetch', '--no-tags', '--depth=1', 'origin', snapshot.REVISION], [c.args[0] for c in git.call_args_list])
        self.assertFalse(any(c.args[0][:2] == ['remote', 'add'] for c in git.call_args_list))

    def test_fetch_refuses_unexpected_origin(self) -> None:
        cache = snapshot.project_root(snapshot.reference_root()) / '.cache/kibo-reference-fetch/git'
        with patch.object(snapshot, 'run_git', side_effect=['', str(cache), 'origin\n', 'https://unexpected.invalid/repo.git\n']) as git:
            with self.assertRaisesRegex(RuntimeError, 'unexpected origin'):
                snapshot.fetch_repository(cache)
        self.assertFalse(any(c.args[0][0] == 'fetch' for c in git.call_args_list))

    def test_fetch_refuses_other_cache_location(self) -> None:
        with self.assertRaisesRegex(RuntimeError, 'project-local'):
            snapshot.fetch_repository(snapshot.reference_root() / 'not-a-cache')

    def test_rejects_symlink_tree_entries(self) -> None:
        with self.assertRaises(ValueError):
            snapshot.parse_tree(b"120000 blob deadbeef\tsymlink\0")


if __name__ == "__main__":
    unittest.main()
