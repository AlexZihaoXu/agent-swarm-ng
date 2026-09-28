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

    def test_text_is_inert_and_byte_bounded(self):
        text, truncated = terminal.bounded_text('😀' * 20000 + '\n<html>\x1b\x00')
        self.assertTrue(truncated)
        self.assertLessEqual(len(text.encode()), 50000)
        self.assertTrue(text.endswith('\n<html>'))
        self.assertNotIn('\x1b', text)


if __name__ == '__main__': unittest.main()
