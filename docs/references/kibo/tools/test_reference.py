#!/usr/bin/env python3
"""Offline checks for curated navigation and coverage; never executes upstream."""
import json
import re
import unittest
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


def destinations(text):
    """Read inline Markdown destinations, including balanced route parentheses."""
    position = 0
    for match in re.finditer(r"\]\(", text):
        if match.start() < position:
            continue
        start = end = match.end()
        depth = 1
        while end < len(text) and depth:
            if text[end] == "(":
                depth += 1
            elif text[end] == ")":
                depth -= 1
            end += 1
        if not depth:
            yield text[start:end - 1]
            position = end


def component_examples(name):
    pattern = re.compile(r'[\"\']@repo/' + re.escape(name) + r'(?:/[^\"\']*)?[\"\']')
    return sorted(p for p in (ROOT / 'upstream/apps/docs/examples').glob('*.tsx')
                  if pattern.search(p.read_text(encoding='utf-8')))


class ReferenceTests(unittest.TestCase):
    def test_inline_link_parser_handles_next_routes(self):
        self.assertEqual(list(destinations('[route](../upstream/app/(docs)/page.tsx#L1)')), ['../upstream/app/(docs)/page.tsx#L1'])

    def test_all_curated_and_catalog_local_links_exist(self):
        files = [*ROOT.glob('*.md'), *ROOT.glob('guides/*.md'), *ROOT.glob('catalog/**/*.md')]
        for path in files:
            for target in destinations(path.read_text(encoding='utf-8')):
                if re.match(r'\w+://', target) or target.startswith('#'):
                    continue
                with self.subTest(file=path.relative_to(ROOT), target=target):
                    self.assertTrue((path.parent / unquote(target.split('#')[0])).exists())

    def test_guide_assignments_cover_inventory_once(self):
        mapping = json.loads((ROOT / 'guide-map.json').read_text())
        records = json.loads((ROOT / 'catalog/patterns.json').read_text())
        inventories = {'patterns': sorted({r['family'] for r in records})}
        for kind in ('components', 'blocks', 'docs'):
            inventories[kind] = sorted(p.stem for p in (ROOT / f'upstream/apps/docs/content/{kind}').glob('*.mdx'))
        for kind, expected in inventories.items():
            assigned = [name for batch, names in mapping.items() if batch.startswith(kind + '-') for name in names]
            self.assertEqual(sorted(assigned), expected)
        for batch in mapping:
            self.assertTrue((ROOT / f'guides/{batch}.md').is_file())
        for record in records:
            batch = next(b for b, names in mapping.items() if b.startswith('patterns-') and record['family'] in names)
            self.assertIn(record['id'], (ROOT / f'guides/{batch}.md').read_text(encoding='utf-8'))

    def test_component_consumers_and_block_installers_are_linked(self):
        mapping = json.loads((ROOT / 'guide-map.json').read_text())
        for batch, names in mapping.items():
            text = (ROOT / f'guides/{batch}.md').read_text(encoding='utf-8')
            for name in names:
                if batch.startswith('components-'):
                    for example in component_examples(name):
                        self.assertIn(example.name, text, f'{batch}: {name}')
                if batch.startswith('blocks-'):
                    doc = ROOT / f'upstream/apps/docs/content/blocks/{name}.mdx'
                    installer = re.search(r'^installer:\s*(.+)$', doc.read_text(), re.M).group(1).strip()
                    self.assertTrue((ROOT / f'upstream/apps/docs/examples/{installer}.tsx').exists())
                    self.assertIn(installer + '.tsx', text)

    def test_notifications_button_retained(self):
        path = 'packages/patterns/button-group/badges/button-group-badges-1.tsx'
        source = (ROOT / 'upstream' / path).read_text()
        self.assertIn('Notifications Button', source)
        records = json.loads((ROOT / 'catalog/patterns.json').read_text())
        record = next(r for r in records if r['source'] == path)
        self.assertEqual(record['title'], 'Notifications Button')
        self.assertEqual(record['preview'], 'https://www.kibo-ui.com/patterns/button-group/badges/button-group-badges-1')


if __name__ == '__main__':
    unittest.main()
