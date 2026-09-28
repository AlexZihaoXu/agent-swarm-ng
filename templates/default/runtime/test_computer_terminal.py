import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('terminal', Path(__file__).with_name('computer-terminal.py'))
terminal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terminal)


class TerminalValidation(unittest.TestCase):
    def test_operations_and_exact_session_references(self):
        terminal.validate({'operation': 'create', 'name': 'build-1', 'command': 'printf hello', 'cwd': '~/src'})
        terminal.validate({'operation': 'list'})
        for operation in ('view', 'status', 'interrupt', 'delete'):
            terminal.validate({'operation': operation, 'session': '12345678-1234-1234-1234-123456789abc'})
        for value in ({'operation': 'list', 'command': 'oops'}, {'operation': 'create', 'name': '-bad'},
                      {'operation': 'create', 'name': 'a\nnew'}, {'operation': 'press', 'session': '%1', 'key': 'Enter'},
                      {'operation': 'view', 'session': 'prefix'}, {'operation': 'create', 'name': 'a', 'cwd': '\0'}):
            with self.assertRaises(ValueError): terminal.validate(value)

    def test_literal_text_and_enumerated_keys(self):
        target = {'session': '12345678-1234-1234-1234-123456789abc'}
        terminal.validate(dict(target, operation='type', text='hello\n世界\t$HOME'))
        for key in ('Enter', 'C-c', 'Escape', 'Up', 'F12', 'M-b'):
            terminal.validate(dict(target, operation='press', key=key))
        for key in (';', 'run-shell', 'C-Enter', 'C-\\', '-R', 'MouseDown1Pane'):
            with self.assertRaises(ValueError): terminal.validate(dict(target, operation='press', key=key))
        for text in ('\0', '\x1b[31m', 'a' * 33000):
            with self.assertRaises(ValueError): terminal.validate(dict(target, operation='type', text=text))

    def test_view_scrolls_by_rows_above_the_live_bottom(self):
        session = {'operation': 'view', 'session': '12345678-1234-1234-1234-123456789abc'}
        terminal.validate(dict(session, rows=200, up=10000))
        for extra in ({'rows': 0}, {'rows': 201}, {'up': -1}, {'up': 10001}, {'rows': True}, {'up': '3'}):
            with self.assertRaises(ValueError): terminal.validate(dict(session, **extra))
        # 100 history rows + a 36-row screen = 136 buffer rows.
        self.assertEqual(terminal.view_window(136, 36), (100, 136, 0))
        self.assertEqual(terminal.view_window(136, 36, up=36), (64, 100, 36))
        self.assertEqual(terminal.view_window(136, 36, rows=10, up=5), (121, 131, 5))
        self.assertEqual(terminal.view_window(136, 36, up=10000), (0, 36, 100))
        self.assertEqual(terminal.view_window(136, 36, rows=200), (0, 136, 0))
        self.assertEqual(terminal.view_window(36, 36, up=5), (0, 36, 0))

    def test_text_is_inert_and_byte_bounded(self):
        text, truncated = terminal.bounded_text('😀' * 20000 + '\n<html>\x1b\x00')
        self.assertTrue(truncated)
        self.assertLessEqual(len(text.encode()), 50000)
        self.assertTrue(text.endswith('\n<html>'))
        self.assertNotIn('\x1b', text)


if __name__ == '__main__': unittest.main()
