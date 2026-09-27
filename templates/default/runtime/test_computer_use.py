"""Pure validation/executor regressions. Run: python3 -m unittest discover -s templates/default/runtime -p 'test_computer_use.py'."""
import importlib.util
import json
import os
import select
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch

from computer_use_protocol import bezier_points, capture_geometry, validate_combo

spec = importlib.util.spec_from_file_location('computer_use', Path(__file__).with_name('computer-use.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
STATE = (1920, 1080, 0, 0)


class FakeX11:
    def __init__(self, fail=False):
        self.events, self.fail = [], fail

    def state(self):
        return STATE

    def keycode(self, key):
        return ord(key) if len(key) == 1 else 30

    def spare_mapping(self):
        return {'code': 200, 'symbols': [0, 0]}

    def mapping(self, code, symbols):
        self.events.append(('mapping', code, symbols))

    def transition(self, device, code, down):
        self.events.append((device, code, down))
        if down and self.fail:
            raise RuntimeError('partial input')

    def move(self, x, y):
        self.events.append(('move', x, y))


class ProtocolTests(unittest.TestCase):
    def test_unicode_codepoint_time_and_between_only_pause(self):
        self.assertAlmostEqual(validate_combo({'actions': [{'type': 'keyboard.type', 'text': '😀e\u0301'}]}, STATE)['totalSeconds'], .225)
        self.assertAlmostEqual(validate_combo({'actions': [{'type': 'mouse.left_click'}, {'type': 'keyboard.type', 'text': 'hello world'}]}, STATE)['totalSeconds'], .945)

    def test_invalid_combos(self):
        for combo in [
            {'actions': [{'type': 'keyboard.down', 'key': 'a'}]},
            {'actions': [{'type': 'keyboard.up', 'key': 'a'}]},
            {'actions': [{'type': 'mouse.down', 'button': 'left'}, {'type': 'mouse.down', 'button': 'left'}]},
            {'actions': [{'type': 'mouse.left_click'}] * 17},
            {'actions': [{'type': 'mouse.move_to', 'x': 999, 'y': 999, 'speed': 24001}]},
            {'actions': [{'type': 'keyboard.type', 'text': 'x', 'cpm': 3201}]},
            {'actions': [{'type': 'keyboard.type', 'text': 'x' * 67}]},
            {'actions': [{'type': 'keyboard.type', 'text': '\ud800'}]},
            {'actions': [{'type': 'mouse.scroll', 'direction': 'up', 'amount': .5}]},
            {'actions': [{'type': 'mouse.left_click'}] * 2, 'per_action_pause': 10},
            {'actions': [{'type': 'mouse.move_to', 'x': True, 'y': 0}]},
        ]:
            with self.subTest(combo=combo), self.assertRaises(ValueError):
                validate_combo(combo, STATE)

    def test_crop_shift_rounding_and_full_axis(self):
        self.assertEqual(capture_geometry({'kind': 'look_at', 'x': 0, 'y': 500, 'size': 100}, 999, 999)['bounds'], [0, 400, 200, 600])
        self.assertEqual(capture_geometry({'kind': 'look_at', 'x': 0, 'y': 999, 'size': 500}, 1920, 1080)['bounds'], [0, 0, 999, 999])
        self.assertEqual(capture_geometry({'kind': 'glance'}, 1920, 1080)['width'], 634)
        self.assertEqual(capture_geometry({'kind': 'look_at', 'x': 999, 'y': 999, 'size': .0001}, 1920, 1080)['width'], 1)
        for value in [{'kind': 'look_at', 'x': -1, 'y': 0, 'size': 1}, {'kind': 'look_at', 'x': 0, 'y': 0, 'size': 0}, {'kind': 'glance', 'quality': 'native'}]:
            with self.assertRaises(ValueError):
                capture_geometry(value, 1920, 1080)

    def test_bezier_is_bounded_precomputed_and_endpoint_exact(self):
        points = bezier_points((0, 0), (1919, 1079), 5, 1920, 1080)
        self.assertEqual(len(points), 600)
        self.assertEqual(points[-1], (5, 1919, 1079))
        self.assertTrue(all(0 <= x < 1920 and 0 <= y < 1080 for _, x, y in points))


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = patch.object(runtime, 'ROOT', Path(self.directory.name))
        self.root.start()
        self.token = runtime.generation()

    def tearDown(self):
        signal.setitimer(signal.ITIMER_REAL, 0)
        self.root.stop()
        self.directory.cleanup()

    @unittest.skipUnless(hasattr(os, 'fork'), 'guest capture runs on Linux')
    def test_hard_killed_capture_leaves_no_named_image(self):
        read_fd, write_fd = os.pipe()
        pid = os.fork()
        if pid == 0:
            os.close(read_fd)
            def write_frame(argv, **kwargs):
                path = next(arg.split('=', 1)[1] for arg in argv if arg.startswith('location='))
                with open(path, 'wb') as image:
                    image.write(b'\xff\xd8\xff\xd9')
                os.write(write_fd, b'1')
                signal.pause()
            with patch.object(runtime.subprocess, 'run', write_frame):
                runtime.capture({'kind': 'glance'}, FakeX11())
            os._exit(0)
        os.close(write_fd)
        try:
            self.assertTrue(select.select([read_fd], [], [], 5)[0], 'capture did not write')
            self.assertEqual(os.read(read_fd, 1), b'1')
            self.assertFalse(list(runtime.ROOT.glob('*.jpg')))
        finally:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            os.close(read_fd)
        self.assertFalse(list(runtime.ROOT.glob('*.jpg')))

    def test_entire_combo_rejected_before_input(self):
        x11 = FakeX11()
        result = runtime.execute({'validationToken': self.token, 'actions': [{'type': 'mouse.left_click'}, {'type': 'keyboard.down', 'key': 'a'}]}, x11)
        self.assertFalse(result['started'])
        self.assertEqual(x11.events, [])

    def test_cancel_fence_rejects_delayed_execution(self):
        runtime.generation(rotate=True)
        x11 = FakeX11()
        result = runtime.execute({'validationToken': self.token, 'actions': [{'type': 'mouse.left_click'}]}, x11)
        self.assertFalse(result['started'])
        self.assertIn('cancelled', result['error'])
        self.assertEqual(x11.events, [])

    def test_partial_failure_releases_held_input(self):
        x11 = FakeX11(fail=True)
        result = runtime.execute({'validationToken': self.token, 'actions': [{'type': 'mouse.left_click'}]}, x11)
        self.assertTrue(result['started'])
        self.assertEqual(result['completed'], 0)
        self.assertEqual(x11.events, [('buttons', 1, True), ('buttons', 1, False)])
        self.assertEqual(json.loads((runtime.ROOT / 'held.json').read_text()), {'keys': [], 'buttons': [], 'mapping': None})

    def test_cancel_during_hold_joins_cleanup(self):
        x11 = FakeX11()
        original = x11.transition
        def transition(device, code, down):
            original(device, code, down)
            if down:
                runtime.generation(rotate=True)
        x11.transition = transition
        result = runtime.execute({'validationToken': self.token, 'actions': [{'type': 'mouse.left_click'}]}, x11)
        self.assertTrue(result['started'])
        self.assertIn('cancelled', result['error'])
        self.assertEqual(x11.events[-1], ('buttons', 1, False))

    def test_new_execution_does_not_erase_crash_cleanup_ledger(self):
        residue = {'keys': [42], 'buttons': [], 'mapping': None}
        runtime.atomic(runtime.ROOT / 'held.json', json.dumps(residue))
        x11 = FakeX11()
        result = runtime.execute({'validationToken': self.token, 'actions': [{'type': 'mouse.left_click'}]}, x11)
        self.assertFalse(result['started'])
        self.assertIn('cancel-and-settle', result['error'])
        self.assertEqual(x11.events, [])
        self.assertEqual(json.loads((runtime.ROOT / 'held.json').read_text()), residue)

    def test_crash_ledger_repairs_held_input_and_mapping(self):
        runtime.atomic(runtime.ROOT / 'held.json', json.dumps({'keys': [42], 'buttons': [1], 'mapping': {'code': 200, 'symbols': [0, 0]}}))
        x11 = FakeX11()
        runtime.repair(x11)
        self.assertEqual(x11.events, [('keys', 42, False), ('buttons', 1, False), ('mapping', 200, [0, 0])])


if __name__ == '__main__':
    unittest.main()
