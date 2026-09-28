import { expect, it } from 'vitest';
import { fileBreadcrumbs, fileSize } from './computer-files';
it('builds absolute guest breadcrumbs without interpreting names as HTML or query strings', () => {
  expect(fileBreadcrumbs('/workspace/a & b/雪')).toEqual([
    { name: '/', path: '/' },
    { name: 'workspace', path: '/workspace' },
    { name: 'a & b', path: '/workspace/a & b' },
    { name: '雪', path: '/workspace/a & b/雪' },
  ]);
  expect(fileBreadcrumbs('/')).toEqual([{ name: '/', path: '/' }]);
});
it('does not fabricate directory sizes and formats empty/small/large files', () => {
  expect(fileSize(null)).toBe('—');
  expect(fileSize(0)).toBe('0 B');
  expect(fileSize(1024)).toBe('1.0 KB');
  expect(fileSize(64 * 1024 ** 2)).toBe('64.0 MB');
});
