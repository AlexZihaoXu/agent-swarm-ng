import tempfile
import unittest
from pathlib import Path
from computer_core_files import file_operation

class FileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cwd = self.tmp.name
    def tearDown(self):
        self.tmp.cleanup()
    def call(self, kind, **params):
        return file_operation({'kind': kind, **params}, self.cwd)
    def test_write_read_and_exact_disjoint_edits(self):
        self.call('write', path='nested/test.txt', content='one\ntwo\nthree\n')
        self.assertEqual(self.call('read', path='nested/test.txt', offset=2, limit=1)['text'], 'two\n')
        self.call('edit', path='nested/test.txt', edits=[{'oldText':'one','newText':'ONE'},{'oldText':'three','newText':'THREE'}])
        self.assertEqual(self.call('read', path='nested/test.txt')['text'], 'ONE\ntwo\nTHREE\n')
    def test_ambiguous_overlapping_or_missing_edits_never_mutate(self):
        self.call('write', path='a', content='aaaa hello world')
        for edits in [[{'oldText':'aa','newText':'x'}],[{'oldText':'hello','newText':'x'},{'oldText':'hello world','newText':'y'}],[{'oldText':'hello','newText':'x'},{'oldText':'missing','newText':'y'}]]:
            with self.assertRaises(ValueError): self.call('edit', path='a', edits=edits)
            self.assertEqual(self.call('read', path='a')['text'], 'aaaa hello world')
    def test_read_is_bounded_and_has_explicit_line_continuation(self):
        self.call('write', path='a', content='abc\n'*3000)
        result=self.call('read', path='a')
        self.assertEqual(result['lines'],200); self.assertEqual(result['nextOffset'],201)
        self.assertIsNone(result['prevOffset']); self.assertTrue(result['truncated'])
        result=self.call('read', path='a', limit=2000)
        self.assertEqual(result['lines'],2000); self.assertEqual(result['nextOffset'],2001)
        result=self.call('read', path='a', offset=401)
        self.assertEqual(result['prevOffset'],201); self.assertEqual(self.call('read', path='a', offset=50, limit=100)['prevOffset'],1)
        result=self.call('read',path='a',offset=3001)
        self.assertEqual(result['text'],''); self.assertIsNone(result['nextOffset'])
    def test_long_lines_and_binary_are_not_unbounded(self):
        Path(self.cwd,'a').write_text('x'*100000)
        result=self.call('read',path='a')
        self.assertLessEqual(len(result['text'].encode()),50000);self.assertTrue(result['truncated'])
        Path(self.cwd,'a').write_bytes(b'\x00binary')
        with self.assertRaises(ValueError): self.call('read',path='a')
    def test_preserves_existing_executable_mode(self):
        self.call('write',path='a',content='old')
        Path(self.cwd,'a').chmod(0o750)
        self.call('edit',path='a',edits=[{'oldText':'old','newText':'new'}])
        self.assertEqual(Path(self.cwd,'a').stat().st_mode&0o777,0o750)

if __name__ == '__main__': unittest.main()
