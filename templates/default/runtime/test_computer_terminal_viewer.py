import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('viewer', Path(__file__).with_name('computer-terminal-viewer.py'))
viewer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(viewer)


class ViewerProtocol(unittest.TestCase):
    def test_input_is_exact_bytes_not_tmux_commands(self):
        self.assertEqual(viewer.input_bytes({'type': 'input', 'data': 'AxsN'}), b'\x03\x1b\r')
        self.assertEqual(viewer.input_bytes({'type': 'ping'}), b'')
        for value in ({'type': 'resize', 'cols': 80}, {'type': 'input', 'data': '??'},
                      {'type': 'input', 'data': 'YQ==', 'session': 'other'}, {'type': 'ping', 'data': ''}):
            with self.assertRaises(ValueError): viewer.input_bytes(value)


if __name__ == '__main__': unittest.main()
