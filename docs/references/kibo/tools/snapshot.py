#!/usr/bin/env python3
"""Fetch, mirror, catalog, and verify the pinned Kibo UI reference snapshot.

This tool treats upstream solely as data: it uses Git plumbing to copy tracked blobs
without checking out or executing upstream code.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

SOURCE_URL = "https://github.com/shadcnblocks/kibo.git"
REVISION = "3d63cdb15b79d972e3dc38a10997987672f9b263"
PREVIEW_BASE_URL = "https://www.kibo-ui.com/patterns"
TITLE_RE = re.compile(r"export\s+const\s+title\s*=\s*([\"'])(.*?)\1", re.DOTALL)


def reference_root() -> Path:
    return Path(__file__).resolve().parents[1]


def project_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    raise RuntimeError("cannot find project root containing .git")


def run_git(args: list[str], cwd: Path | None = None, text: bool = True) -> str | bytes:
    result = subprocess.run(
        ["git", *args], cwd=cwd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    return result.stdout.decode("utf-8", "strict") if text else result.stdout


def safe_tree_path(raw_path: str) -> PurePosixPath:
    path = PurePosixPath(raw_path)
    raw_parts = raw_path.split("/")
    if (
        not raw_path
        or path.is_absolute()
        or any(part in ("", ".", "..") for part in raw_parts)
        or any(part in (".", "..") for part in path.parts)
    ):
        raise ValueError(f"unsafe archive path: {raw_path!r}")
    return path


def parse_tree(data: bytes) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for record in data.split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, kind, blob = metadata.decode("ascii").split(" ", 2)
        path = raw_path.decode("utf-8", "strict")
        safe_tree_path(path)
        if kind != "blob" or mode not in ("100644", "100755"):
            raise ValueError(f"unsafe or unsupported tracked entry: {mode} {kind} {path}")
        entries.append({"path": path, "mode": mode, "gitBlob": blob})
    return sorted(entries, key=lambda entry: entry["path"])


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def title_from_source(source: bytes) -> str | None:
    try:
        match = TITLE_RE.search(source.decode("utf-8"))
    except UnicodeDecodeError:
        return None
    return match.group(2) if match else None


def fetch_repository(temp_git: Path) -> None:
    expected = project_root(reference_root()) / ".scratch" / "kibo-reference-fetch" / "git"
    if temp_git.is_symlink() or (temp_git / ".git").is_symlink() or temp_git.resolve() != expected.absolute():
        raise RuntimeError("fetch cache must be the project-local .scratch/kibo-reference-fetch/git")
    # Reinitialize only this dedicated cache. Reuse read-only Git pack files on Windows.
    run_git(["init", "-q", str(temp_git)])
    actual_root = Path(str(run_git(["rev-parse", "--show-toplevel"], temp_git)).strip())
    if actual_root.resolve() != temp_git.resolve():
        raise RuntimeError("fetch cache resolved to an unexpected repository")
    remotes = str(run_git(["remote"], temp_git)).splitlines()
    if "origin" in remotes:
        origins = str(run_git(["remote", "get-url", "--all", "origin"], temp_git)).splitlines()
        if origins != [SOURCE_URL]:
            raise RuntimeError("fetch cache has an unexpected origin; refusing to repoint it")
    else:
        run_git(["remote", "add", "origin", SOURCE_URL], temp_git)
    run_git(["fetch", "--no-tags", "--depth=1", "origin", REVISION], temp_git)
    actual = str(run_git(["rev-parse", "FETCH_HEAD"], temp_git)).strip()
    if actual != REVISION:
        raise RuntimeError(f"pinned revision disagreement: expected {REVISION}, received {actual}")
    if str(run_git(["cat-file", "-t", REVISION], temp_git)).strip() != "commit":
        raise RuntimeError(f"pinned revision is not a commit: {REVISION}")


def copy_tree(temp_git: Path, destination: Path) -> list[dict[str, Any]]:
    entries = parse_tree(run_git(["ls-tree", "-r", "-z", REVISION], temp_git, text=False))
    destination.mkdir(parents=True, exist_ok=False)
    files: list[dict[str, Any]] = []
    for entry in entries:
        relative = safe_tree_path(entry["path"])
        output = destination.joinpath(*relative.parts)
        output.parent.mkdir(parents=True, exist_ok=True)
        blob = run_git(["cat-file", "blob", entry["gitBlob"]], temp_git, text=False)
        output.write_bytes(blob)
        if entry["mode"] == "100755":
            output.chmod(0o755)
        files.append({
            **entry,
            "sha256": hashlib.sha256(blob).hexdigest(),
            "size": len(blob),
        })
    return files


def markdown_link(path: str, from_directory: str) -> str:
    return os.path.relpath("upstream/" + path, from_directory).replace("\\", "/")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def simple_index(title: str, description: str, paths: list[str], output: Path, root: Path) -> None:
    rows = [f"# {title}", "", description, "", f"Count: {len(paths)}", "", "| Source |", "| --- |"]
    source_dir = str(output.parent.relative_to(root)).replace("\\", "/") or "."
    for path in paths:
        rows.append(f"| [{path}]({markdown_link(path, source_dir)}) |")
    rows.append("")
    write_text(output, "\n".join(rows))


def generate_catalog(root: Path, files: list[dict[str, Any]], source_root: Path | None = None) -> list[str]:
    catalog = root / "catalog"
    source_root = source_root or root / "upstream"
    if catalog.exists():
        shutil.rmtree(catalog)
    source_paths = [item["path"] for item in files]
    source_set = set(source_paths)
    patterns = [path for path in source_paths if path.startswith("packages/patterns/") and path.endswith(".tsx")]
    records: list[dict[str, str | None]] = []
    families: dict[str, list[dict[str, str | None]]] = {}
    for path in patterns:
        parts = path.split("/")
        if len(parts) != 5:
            raise ValueError(f"unexpected pattern source path: {path}")
        family, collection, filename = parts[2], parts[3], parts[4]
        source = (source_root / path).read_bytes()
        record: dict[str, str | None] = {
            "id": filename.removesuffix(".tsx"),
            "title": title_from_source(source),
            "family": family,
            "collection": collection,
            "source": path,
            "preview": f"{PREVIEW_BASE_URL}/{family}/{collection}/{filename.removesuffix('.tsx')}",
        }
        records.append(record)
        families.setdefault(family, []).append(record)
    records.sort(key=lambda item: str(item["source"]))
    catalog.mkdir(parents=True)
    write_text(catalog / "patterns.json", json.dumps(records, indent=2, ensure_ascii=False) + "\n")
    overview = ["# Kibo UI pattern catalog", "", "Generated from the local immutable mirror. Pattern titles are extracted only from a literal `export const title` declaration; an empty title means the source did not provide one in that form.", "", f"Patterns: {len(records)}; families: {len(families)}; collections: {len({(item['family'], item['collection']) for item in records})}.", "", "| Family | Patterns | Collections | Index |", "| --- | ---: | ---: | --- |"]
    for family in sorted(families):
        family_records = sorted(families[family], key=lambda item: str(item["source"]))
        collections = len({item["collection"] for item in family_records})
        overview.append(f"| {family} | {len(family_records)} | {collections} | [{family}]({family}.md) |")
        lines = [f"# {family} patterns", "", f"Generated from `upstream/packages/patterns/{family}/`.", "", "| ID | Title from source | Collection | Local exact source | Website preview |", "| --- | --- | --- | --- | --- |"]
        for item in family_records:
            title = item["title"] or ""
            source_link = markdown_link(str(item["source"]), f"catalog/patterns")
            lines.append(f"| {item['id']} | {title} | {item['collection']} | [{item['source']}]({source_link}) | [preview]({item['preview']}) |")
        lines.append("")
        write_text(catalog / "patterns" / f"{family}.md", "\n".join(lines))
    overview.append("")
    write_text(catalog / "patterns" / "README.md", "\n".join(overview))

    docs_components = sorted(path for path in source_paths if path.startswith("apps/docs/content/components/") and path.endswith(".mdx"))
    docs_blocks = sorted(path for path in source_paths if path.startswith("apps/docs/content/blocks/") and path.endswith(".mdx"))
    docs_general = sorted(path for path in source_paths if path.startswith("apps/docs/content/docs/") and path.endswith(".mdx"))
    examples = sorted(path for path in source_paths if path.startswith("apps/docs/examples/"))
    simple_index("Kibo UI component documentation index", "Exact upstream component documentation pages; this is a source-path index, not an API summary.", docs_components, catalog / "components.md", root)
    simple_index("Kibo UI block documentation index", "Exact upstream block documentation pages. There is no tracked `packages/blocks` directory at this revision; block implementations may be found among the example sources indexed separately.", docs_blocks, catalog / "blocks.md", root)
    simple_index("Kibo UI general documentation index", "Exact upstream general documentation pages; read the linked source for behavior and setup details.", docs_general, catalog / "docs.md", root)
    simple_index("Kibo UI example source index", "Exact upstream files in `apps/docs/examples`; source was indexed only, not run or visually validated.", examples, catalog / "examples.md", root)
    summary = {
        "patterns": len(records),
        "families": len(families),
        "collections": len({(item["family"], item["collection"]) for item in records}),
        "componentDocumentationPages": len(docs_components),
        "blockDocumentationPages": len(docs_blocks),
        "generalDocumentationPages": len(docs_general),
        "exampleFiles": len(examples),
        "shadcnUiFiles": sum(path.startswith("packages/shadcn-ui/") for path in source_paths),
        "packagesBlocksPresent": any(path.startswith("packages/blocks/") for path in source_set),
    }
    write_text(catalog / "summary.json", json.dumps(summary, indent=2) + "\n")
    return sorted(str(path.relative_to(root)).replace("\\", "/") for path in catalog.rglob("*") if path.is_file())


def manifest_for(temp_git: Path, files: list[dict[str, Any]], generated: list[str]) -> dict[str, Any]:
    commit = str(run_git(["show", "-s", "--format=%H", REVISION], temp_git)).strip()
    tree = str(run_git(["show", "-s", "--format=%T", REVISION], temp_git)).strip()
    parent = str(run_git(["show", "-s", "--format=%P", REVISION], temp_git)).strip()
    return {
        "schemaVersion": 1,
        "source": {"url": SOURCE_URL, "revision": REVISION, "commit": commit, "tree": tree, "parent": parent},
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "inventory": {"trackedFileCount": len(files), "exclusions": [], "files": files},
        "generatedIndexes": generated,
    }


def publish_directory(staging: Path, destination: Path) -> None:
    backup = destination.with_name(destination.name + ".previous")
    if backup.exists():
        shutil.rmtree(backup)
    if destination.exists():
        destination.rename(backup)
    try:
        staging.rename(destination)
    except BaseException:
        if backup.exists() and not destination.exists():
            backup.rename(destination)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def refresh() -> None:
    root = reference_root()
    project = project_root(root)
    cache = project / ".scratch" / "kibo-reference-fetch"
    cache.mkdir(parents=True, exist_ok=True)
    temp_git = cache / "git"
    fetch_repository(temp_git)
    staging = Path(tempfile.mkdtemp(prefix="kibo-stage-", dir=cache))
    files = copy_tree(temp_git, staging / "upstream")
    generated = generate_catalog(staging, files)
    (staging / "metadata").mkdir()
    write_text(
        staging / "metadata" / "manifest.json",
        json.dumps(manifest_for(temp_git, files, generated), indent=2) + "\n",
    )
    # Each artifact was fully built before publication. Source is published first so every
    # generated local link always points to a complete immutable mirror.
    for name in ("upstream", "catalog", "metadata"):
        publish_directory(staging / name, root / name)
    shutil.rmtree(staging)
    print(f"refreshed {len(files)} tracked files at {REVISION}")


def compare_trees(expected: Path, actual: Path, label: str) -> list[str]:
    expected_files = {path.relative_to(expected).as_posix() for path in expected.rglob("*") if path.is_file()}
    actual_files = {path.relative_to(actual).as_posix() for path in actual.rglob("*") if path.is_file()} if actual.exists() else set()
    problems: list[str] = []
    for path in sorted(expected_files - actual_files):
        problems.append(f"missing {label}: {path}")
    for path in sorted(actual_files - expected_files):
        problems.append(f"extra {label}: {path}")
    for path in sorted(expected_files & actual_files):
        if expected.joinpath(path).read_bytes() != actual.joinpath(path).read_bytes():
            problems.append(f"changed {label}: {path}")
    return problems


def check() -> None:
    root = reference_root()
    manifest_path = root / "metadata" / "manifest.json"
    if not manifest_path.exists():
        raise RuntimeError("missing metadata/manifest.json; run without --check first")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("source", {}).get("revision") != REVISION or manifest.get("source", {}).get("url") != SOURCE_URL:
        raise RuntimeError("manifest source provenance does not match this pinned tool")
    expected = {item["path"]: item for item in manifest["inventory"]["files"]}
    for path in expected:
        safe_tree_path(path)
    actual_root = root / "upstream"
    actual = {path.relative_to(actual_root).as_posix(): path for path in actual_root.rglob("*") if path.is_file()} if actual_root.exists() else {}
    problems: list[str] = []
    if actual_root.exists():
        problems.extend(f"unsafe source symlink: {path.relative_to(actual_root).as_posix()}" for path in actual_root.rglob("*") if path.is_symlink())
    for path in sorted(expected.keys() - actual.keys()):
        problems.append(f"missing source: {path}")
    for path in sorted(actual.keys() - expected.keys()):
        problems.append(f"extra source: {path}")
    for path in sorted(expected.keys() & actual.keys()):
        item = expected[path]
        file_path = actual[path]
        if file_path.stat().st_size != item["size"] or sha256_path(file_path) != item["sha256"]:
            problems.append(f"changed source: {path}")
    cache = project_root(root) / ".scratch" / "kibo-reference-check"
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kibo-check-", dir=cache) as temp:
        expected_root = Path(temp)
        generated = generate_catalog(expected_root, manifest["inventory"]["files"], actual_root)
        problems.extend(compare_trees(expected_root / "catalog", root / "catalog", "index"))
        if (root / "catalog").exists():
            problems.extend(f"unsafe index symlink: {path.relative_to(root / 'catalog').as_posix()}" for path in (root / "catalog").rglob("*") if path.is_symlink())
        if generated != manifest.get("generatedIndexes"):
            problems.append("stale index manifest entry list")
    if problems:
        print("Kibo reference check failed:", *problems, sep="\n- ")
        raise SystemExit(1)
    print(f"Kibo reference check passed: {len(expected)} source files and {len(manifest['generatedIndexes'])} indexes")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="read-only verification of mirror and generated indexes")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        refresh()


if __name__ == "__main__":
    main()
