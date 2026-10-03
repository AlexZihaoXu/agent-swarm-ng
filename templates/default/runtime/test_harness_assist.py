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

HERE = Path(__file__).parent / 'harness-assist'
sys.path.insert(0, str(HERE))
import swarm_harness  # noqa: E402
import harness_event  # noqa: E402
import supervisor_mcp  # noqa: E402



class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        (root / 'followers').mkdir()
        self.patch = mock.patch.object(swarm_harness, 'base', lambda: root)
        self.patch.start()
        self.patch_mcp = mock.patch.object(supervisor_mcp, 'base', lambda: root)
        self.patch_mcp.start()
        self.root = root

    def tearDown(self):
        self.patch.stop()
        self.patch_mcp.stop()
        self.dir.cleanup()

    def lines(self):
        return [json.loads(line) for line in (self.root / 'events.jsonl').read_text().splitlines()]


class Hook(Base):
    def run_hook(self, payload, where={'id': 't1', 'name': 'cc'}, mode='claude-code'):
        with mock.patch.object(swarm_harness, 'terminal', lambda: where), mock.patch('sys.stdin', io.StringIO(json.dumps(payload))):
            harness_event.main(['x', mode])

    def test_codex_hooks_and_the_emit_mode_of_the_plugins(self):
        self.run_hook({'hook_event_name': 'Stop', 'session_id': 'c1', 'last_assistant_message': 'Done.'}, mode='codex')
        self.run_hook({'hook_event_name': 'PermissionRequest', 'tool_name': 'shell', 'tool_input': {'command': ['git', 'push']}}, mode='codex')
        self.run_hook({'hook_event_name': 'Notification', 'notification_type': 'idle_prompt'}, mode='codex')
        self.run_hook({'harness': 'pi', 'event': 'finished', 'text': 'Settled.', 'session': 's'}, mode='emit')
        self.run_hook({'harness': 'nope', 'event': 'finished'}, mode='emit')
        lines = self.lines()
        self.assertEqual([(line['harness'], line['event'], line['text']) for line in lines],
                         [('codex', 'finished', 'Done.'), ('codex', 'permission', 'shell: git push'), ('pi', 'finished', 'Settled.')])

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
        self.assertFalse(swarm_harness.listening('t1', 'message'))
        self.assertFalse((self.root / 'followers' / '9.json').exists())

    def test_speaks_mcp(self):
        self.assertEqual(supervisor_mcp.handle({'method': 'tools/list'})['tools'][0]['name'], 'notify_supervisor')
        self.assertEqual(supervisor_mcp.handle({'method': 'initialize', 'params': {'protocolVersion': 'x'}})['protocolVersion'], 'x')


class Follow(unittest.TestCase):
    def test_replays_since_and_filters_by_terminal_and_event(self):
        with tempfile.TemporaryDirectory() as root:
            env = {**os.environ, 'SWARM_HARNESS_DIR': root}
            events = Path(root) / 'events.jsonl'
            events.write_text(''.join(json.dumps(line) + '\n' for line in [
                {'t': 100, 'event': 'finished', 'terminal': {'id': 'a'}},
                {'t': 200, 'event': 'finished', 'terminal': {'id': 'a'}},
                {'t': 300, 'event': 'finished', 'terminal': {'id': 'b'}},
                {'t': 400, 'event': 'idle', 'terminal': {'id': 'a'}},
            ]))
            proc = subprocess.Popen([sys.executable, str(HERE / 'harness_follow.py'), '--terminals', 'a', '--events', 'finished', '--since', '150'],
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


class Install(unittest.TestCase):
    def test_codex_block_is_added_once_and_removed_cleanly(self):
        from importlib.machinery import SourceFileLoader
        installer = SourceFileLoader('harness_install', str(HERE / 'install')).load_module()
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / 'config.toml'
            config.write_text('model = "gpt-6"\n')
            with mock.patch.object(installer, 'CODEX_SYSTEM', config), mock.patch('os.geteuid', lambda: 0):
                installer.install_codex()
                installer.install_codex()
                text = config.read_text()
                self.assertEqual(text.count(installer.BEGIN), 1)
                # A computer from an older image gets the no-sandbox setting first, before any table.
                self.assertTrue(text.startswith((HERE / 'codex/system.toml').read_text()))
                self.assertIn('model = "gpt-6"', text)
                self.assertEqual(text.count('sandbox_mode'), 1)
                self.assertIn('[[hooks.Stop.hooks]]', text)
                installer.install_codex(remove=True)
                self.assertNotIn(installer.BEGIN, config.read_text())
                self.assertIn('sandbox_mode = "danger-full-access"', config.read_text())

    def test_codex_keeps_a_sandbox_mode_someone_chose(self):
        from importlib.machinery import SourceFileLoader
        installer = SourceFileLoader('harness_install', str(HERE / 'install')).load_module()
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / 'config.toml'
            config.write_text('sandbox_mode = "workspace-write"\n')
            with mock.patch.object(installer, 'CODEX_SYSTEM', config), mock.patch('os.geteuid', lambda: 0):
                installer.install_codex()
            text = config.read_text()
            self.assertTrue(text.startswith('sandbox_mode = "workspace-write"'))
            self.assertEqual(text.count('sandbox_mode'), 1)

    def test_opencode_and_pi_files_go_to_their_user_folders(self):
        from importlib.machinery import SourceFileLoader
        installer = SourceFileLoader('harness_install', str(HERE / 'install')).load_module()
        with tempfile.TemporaryDirectory() as home:
            opencode, pi = Path(home) / '.config/opencode', Path(home) / '.pi/agent/extensions/swarm-assist.ts'
            with mock.patch.object(installer, 'OPENCODE', opencode), mock.patch.object(installer, 'PI', pi):
                installer.install_opencode()
                installer.install_pi()
                self.assertTrue((opencode / 'plugins/swarm-assist.ts').exists())
                self.assertIn('@opencode-ai/plugin', json.loads((opencode / 'package.json').read_text())['dependencies'])
                self.assertTrue(pi.exists())
