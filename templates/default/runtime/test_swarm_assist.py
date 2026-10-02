import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).parent / 'claude-code' / 'swarm-assist' / 'scripts'
sys.path.insert(0, str(HERE))
import swarm_claude  # noqa: E402
import swarm_event  # noqa: E402
import supervisor_mcp  # noqa: E402



class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        (root / 'followers').mkdir()
        self.patch = mock.patch.object(swarm_claude, 'base', lambda: root)
        self.patch.start()
        self.root = root

    def tearDown(self):
        self.patch.stop()
        self.dir.cleanup()

    def lines(self):
        return [json.loads(line) for line in (self.root / 'events.jsonl').read_text().splitlines()]


class Hook(Base):
    def run_hook(self, payload, where={'id': 't1', 'name': 'cc'}):
        with mock.patch.object(swarm_claude, 'terminal', lambda: where), mock.patch('sys.stdin', io.StringIO(json.dumps(payload))):
            swarm_event.main()

    def test_turns_hook_events_into_short_lines(self):
        self.run_hook({'hook_event_name': 'Stop', 'session_id': 's', 'last_assistant_message': 'x' * 500})
        self.run_hook({'hook_event_name': 'PermissionRequest', 'tool_name': 'Bash', 'tool_input': {'command': 'npm publish'}})
        self.run_hook({'hook_event_name': 'Notification', 'notification_type': 'idle_prompt', 'message': 'waiting'})
        self.run_hook({'hook_event_name': 'Notification', 'notification_type': 'auth_success'})
        self.run_hook({'hook_event_name': 'PreToolUse', 'tool_name': 'Bash'})
        lines = self.lines()
        self.assertEqual([line['event'] for line in lines], ['finished', 'permission', 'idle'])
        self.assertEqual(len(lines[0]['text']), 300)
        self.assertEqual(lines[1]['text'], 'Bash: npm publish')
        self.assertEqual(lines[0]['terminal'], {'id': 't1', 'name': 'cc'})


class Notify(Base):
    def test_delivers_only_with_a_listener_and_rate_limits(self):
        supervisor_mcp.sent.clear()
        with mock.patch.object(supervisor_mcp, 'terminal', lambda: {'id': 't1', 'name': 'cc'}):
            nobody = supervisor_mcp.notify({'message': 'hi'})
            self.assertTrue(nobody['isError'])
            self.assertIn('No swarm agent is listening', nobody['content'][0]['text'])
            (self.root / 'followers' / '1.json').write_text(json.dumps({'pid': os.getpid(), 'terminals': ['t1'], 'events': ['message']}))
            self.assertFalse(supervisor_mcp.notify({'message': 'Which DB?'})['isError'])
            self.assertIn('Wait', supervisor_mcp.notify({'message': 'again'})['content'][0]['text'])
        self.assertEqual([(line['event'], line['text']) for line in self.lines()], [('message', 'Which DB?')])

    def test_a_dead_follower_does_not_count(self):
        (self.root / 'followers' / '9.json').write_text(json.dumps({'pid': 2 ** 22 + 7, 'terminals': ['t1'], 'events': ['message']}))
        self.assertFalse(swarm_claude.listening('t1', 'message'))
        self.assertFalse((self.root / 'followers' / '9.json').exists())

    def test_speaks_mcp(self):
        self.assertEqual(supervisor_mcp.handle({'method': 'tools/list'})['tools'][0]['name'], 'notify_supervisor')
        self.assertEqual(supervisor_mcp.handle({'method': 'initialize', 'params': {'protocolVersion': 'x'}})['protocolVersion'], 'x')


class Follow(unittest.TestCase):
    def test_replays_since_and_filters_by_terminal_and_event(self):
        with tempfile.TemporaryDirectory() as root:
            env = {**os.environ, 'SWARM_CLAUDE_DIR': root}
            events = Path(root) / 'events.jsonl'
            events.write_text(''.join(json.dumps(line) + '\n' for line in [
                {'t': 100, 'event': 'finished', 'terminal': {'id': 'a'}},
                {'t': 200, 'event': 'finished', 'terminal': {'id': 'a'}},
                {'t': 300, 'event': 'finished', 'terminal': {'id': 'b'}},
                {'t': 400, 'event': 'idle', 'terminal': {'id': 'a'}},
            ]))
            proc = subprocess.Popen([sys.executable, str(HERE / 'claude_follow.py'), '--terminals', 'a', '--events', 'finished', '--since', '150'],
                                    stdout=subprocess.PIPE, text=True, env=env)
            try:
                self.assertEqual(json.loads(proc.stdout.readline())['t'], 200)
                self.assertTrue((Path(root) / 'followers' / f'{proc.pid}.json').exists())
                with open(events, 'a') as handle:
                    handle.write(json.dumps({'t': 500, 'event': 'finished', 'terminal': {'id': 'a'}}) + '\n')
                self.assertEqual(json.loads(proc.stdout.readline())['t'], 500)
            finally:
                proc.terminate()
                proc.wait(5)
            self.assertFalse((Path(root) / 'followers' / f'{proc.pid}.json').exists())

if __name__ == '__main__':
    unittest.main()
