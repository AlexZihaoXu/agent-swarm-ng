#!/usr/bin/python3
"""Pure selection tests for the managed GNOME/Selkies PipeWire bridge."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True

source = Path(__file__).resolve().parents[1] / 'templates/default/runtime/link-selkies.py'
spec = importlib.util.spec_from_file_location('computer_link_selkies', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def node(id, name, kind):
    return {'type': 'PipeWire:Interface:Node', 'id': id, 'info': {'props': {'node.name': name, 'media.class': kind}}}


def port(id, node_id, name):
    return {'type': 'PipeWire:Interface:Port', 'id': id, 'info': {'props': {'node.id': str(node_id), 'port.name': name}}}


class LinkTests(unittest.TestCase):
    def setUp(self):
        self.objects = [
            node(34, 'gnome-shell', 'Stream/Output/Video'), port(35, 34, 'output_1'),
            node(38, 'gnome-shell', 'Stream/Output/Video'), port(39, 38, 'output_1'),
            node(40, 'python3.12', 'Stream/Input/Video'), port(42, 40, 'input_1'),
        ]

    def test_only_links_the_portal_output_not_private_preview(self):
        self.assertEqual(module.port_pair(self.objects, 34), (39, 42))
        self.assertEqual(module.port_pair(self.objects, 38), (35, 42))

    def test_refuses_missing_or_ambiguous_sessions(self):
        for objects in (self.objects[:-1], self.objects[2:],
                        self.objects + [node(50, 'gnome-shell', 'Stream/Output/Video'), port(51, 50, 'output_1')],
                        self.objects + [port(43, 40, 'input_1')]):
            self.assertIsNone(module.port_pair(objects, 34))
        self.assertIsNone(module.port_pair(self.objects, 99))

    def test_never_links_an_audio_or_unrelated_input(self):
        objects = self.objects[:-2] + [node(40, 'python3.12', 'Stream/Input/Audio'), port(42, 40, 'input_1')]
        self.assertIsNone(module.port_pair(objects, 34))


if __name__ == '__main__':
    unittest.main()
