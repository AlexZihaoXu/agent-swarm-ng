import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load():
    spec = importlib.util.spec_from_file_location('computer_core_supervisor', HERE / 'computer-core.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StaleMarkerTests(unittest.TestCase):
    """An operation's durable marker holds the computer only while that operation may still run."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.core = load()
        self.core.ROOT = Path(self.tmp.name)
        self.marker = self.core.ROOT / 'active'
        self.children = []

    def tearDown(self):
        for child in self.children:
            child.kill(); child.wait()
        self.tmp.cleanup()

    def mark(self, pid, start):
        self.marker.write_text(json.dumps({'pid': pid, 'start': start}))

    def test_no_marker_is_free(self):
        self.assertFalse(self.core.busy())

    def test_a_live_supervisor_holds_the_computer(self):
        self.mark(os.getpid(), self.core.start_time(os.getpid()))
        self.assertTrue(self.core.busy())
        self.assertTrue(self.marker.exists())

    def test_a_dead_supervisor_without_workers_leaves_a_stale_marker_that_is_removed(self):
        child = subprocess.Popen([sys.executable, '-c', 'pass']); child.wait()
        self.mark(child.pid, '1')
        self.assertFalse(self.core.busy())
        self.assertFalse(self.marker.exists())

    def test_a_reused_pid_is_not_the_supervisor(self):
        # Same pid, other start time: a different process now has that pid.
        self.mark(os.getpid(), '0')
        self.assertFalse(self.core.busy())

    def test_a_live_worker_keeps_holding_even_when_the_supervisor_is_gone(self):
        worker = subprocess.Popen(
            [sys.executable, '-c', 'import time; time.sleep(30)', '/opt/swarm/computer-core-worker.py'])
        self.children.append(worker)
        self.mark(999999999, '1')
        self.assertTrue(self.core.busy())
        self.assertTrue(self.marker.exists())

    def test_an_unreadable_marker_keeps_holding(self):
        self.marker.write_text('not json')
        self.assertTrue(self.core.busy())


if __name__ == '__main__':
    unittest.main()
