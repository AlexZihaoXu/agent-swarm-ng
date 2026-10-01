import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('recording', Path(__file__).with_name('recording.py'))
recording = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recording)

START = 1_790_000_000.0


def event(at, kind, length=0.0, **fields):
    return dict(fields, t0=START + at, t1=START + at + length, type=kind)


class ClipPlanning(unittest.TestCase):
    rules = {'mouse.move_to': {'before': 2.5, 'after': 2.5}, 'keyboard.type': {'before': 1.5, 'after': 3}, 'mark': {}}

    def test_pads_each_event_by_its_own_rule_around_its_whole_duration(self):
        clips = recording.plan_clips([event(10, 'mouse.move_to', 0.4), event(30, 'keyboard.type', 2)],
                                     self.rules, (10, 5), START, START + 60)
        self.assertEqual([(c['from'], c['to']) for c in clips], [(7.5, 12.9), (28.5, 35.0)])

    def test_merges_overlapping_or_close_clips_and_ignores_types_without_a_rule(self):
        clips = recording.plan_clips([event(10, 'mouse.move_to'), event(14, 'mouse.move_to'),
                                      event(40, 'mouse.left_click'), event(50, 'mark', label='x')],
                                     self.rules, (10, 5), START, START + 52)
        self.assertEqual([(c['from'], c['to'], len(c['events'])) for c in clips], [(7.5, 16.5, 2), (40.0, 52.0, 1)])

    def test_rule_star_matches_every_type_and_padding_is_capped(self):
        clips = recording.plan_clips([event(100, 'mouse.scroll')], {'*': {'before': 99, 'after': 1}}, (2.5, 2.5),
                                     START, START + 200)
        self.assertEqual((clips[0]['from'], clips[0]['to']), (70.0, 101.0))

    def test_keep_start_and_keep_end_extend_the_first_and_last_clips(self):
        events = [event(20, 'mouse.move_to'), event(40, 'mouse.move_to')]
        spans = lambda **keep: [(c['from'], c['to']) for c in recording.plan_clips(
            events, self.rules, (0.5, 0.5), START, START + 60, **keep)]
        self.assertEqual(spans(), [(17.5, 22.5), (37.5, 42.5)])
        self.assertEqual(spans(keep_start=True), [(0.0, 22.5), (37.5, 42.5)])
        self.assertEqual(spans(keep_end=True), [(17.5, 22.5), (37.5, 60.0)])
        self.assertEqual(spans(keep_start=True, keep_end=True), [(0.0, 22.5), (37.5, 60.0)])
        # No events: both kept is the whole recording; one alone keeps nothing.
        self.assertEqual([(c['from'], c['to']) for c in recording.plan_clips([], {}, (0.5, 0.5), START, START + 60,
                                                                              keep_start=True, keep_end=True)], [(0.0, 60.0)])
        self.assertEqual(recording.plan_clips([], {}, (0.5, 0.5), START, START + 60, keep_start=True), [])

    def test_a_mark_with_its_own_padding_overrides_the_mark_rule(self):
        marks = [event(30, 'mark', label='a'), event(50, 'mark', label='b', before=10, after=2)]
        clips = recording.plan_clips(marks, {'mark': {'before': 1, 'after': 1}}, (0.5, 0.5), START, START + 60)
        self.assertEqual([(c['from'], c['to']) for c in clips], [(29.0, 31.0), (40.0, 52.0)])
        # Its own padding counts even when no mark rule was chosen.
        clips = recording.plan_clips(marks, {'mouse.move_to': {}}, (0.5, 0.5), START, START + 60)
        self.assertEqual([(c['from'], c['to']) for c in clips], [(40.0, 52.0)])
        self.assertIn('own padding: 10s before, 2s after', recording.describe(marks[1], False))

    def test_segments_and_covering(self):
        segments = recording.parse_segments('seg-000000.ts,0.000000,2.000000\nseg-000001.ts,2.000000,4.000000\n'
                                            'seg-000002.ts,4.000000,6.000000\nother\n')
        self.assertEqual([s['file'] for s in recording.covering(segments, 1.5, 4.0)], ['seg-000000.ts', 'seg-000001.ts'])


class EventLog(unittest.TestCase):
    def test_describes_events_and_hides_typed_text_when_asked(self):
        typed = event(1, 'keyboard.type', 1.2, text='hunter2')
        self.assertEqual(recording.describe(typed, False), 'keyboard.type "hunter2" (1.2 s)')
        self.assertEqual(recording.describe(typed, True), 'keyboard.type (7 characters) (1.2 s)')
        self.assertEqual(recording.describe(event(1, 'terminal.press', key='Enter'), False), 'terminal.press Enter')
        self.assertEqual(recording.describe(event(1, 'mark', label='build failed'), False), 'mark "build failed"')

    def test_lines_carry_wall_time_recording_time_source_and_file_time(self):
        line = recording.log_line(START + 65.25, START, 'desktop', 'clip-01 00:02.500', 'mouse.left_click')
        self.assertTrue(line.startswith('2026-09-21T'))
        self.assertIn('Z  rec 01:05.250  desktop', line)
        self.assertTrue(line.endswith('clip-01 00:02.500  mouse.left_click'))


class Journal(unittest.TestCase):
    def test_writes_only_while_a_recording_of_that_kind_or_terminal_is_active(self):
        with tempfile.TemporaryDirectory() as root:
            recording.RUN = Path(root)
            recording.journal('desktop', {'type': 'mouse.left_click', 't0': 1})
            self.assertFalse((Path(root) / 'desktop.events').exists())
            (Path(root) / 'terminal-a.active').touch()
            recording.journal('terminal', {'session': 'b', 'type': 'terminal.type', 't0': 1})
            recording.journal('terminal', {'session': 'a', 'type': 'terminal.type', 't0': 2})
            self.assertFalse((Path(root) / 'terminal-b.events').exists())
            self.assertEqual(json.loads((Path(root) / 'terminal-a.events').read_text())['t0'], 2)


class TerminalScreens(unittest.TestCase):
    def test_parses_colours_styles_and_inverse(self):
        runs = recording.parse_ansi('\x1b[1;31mERR\x1b[0m ok \x1b[7mX\x1b[38;5;46mY\x1b[38;2;1;2;3mZ')
        self.assertEqual([r[0] for r in runs], ['ERR', ' ok ', 'X', 'Y', 'Z'])
        self.assertEqual(runs[0][1:4], ((205, 49, 49), recording.BG, True))
        self.assertEqual(runs[2][1:3], (recording.BG, recording.FG))
        self.assertEqual(runs[3][2], (0, 255, 0))
        self.assertEqual(runs[4][2], (1, 2, 3))


if __name__ == '__main__':
    unittest.main()
