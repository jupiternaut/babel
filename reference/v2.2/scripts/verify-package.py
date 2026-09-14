"""Read-only checks for this handoff package; Python 3 standard library only.

Checks file hashes, JSON syntax, local Markdown file links, bundled skill
provenance, and design fixture references. Does not validate a running app,
remote URLs, heading anchors, or Nimbalyst's native schema.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative_file(raw):
    path = (ROOT / raw).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Path escapes package: " + raw)
    return path


def main():
    errors = []
    stats = {"manifest_files": 0, "json_files": 0, "markdown_file_links": 0,
             "skill_source_hashes": 0, "primary_views": 0}
    manifest = json.loads((ROOT / "PACKAGE-MANIFEST.json").read_text(encoding="utf-8-sig"))
    listed = set()
    for item in manifest["files"]:
        raw = item["path"]
        if raw in listed:
            errors.append("Duplicate manifest entry: " + raw)
        listed.add(raw)
        path = relative_file(raw)
        if not path.is_file():
            errors.append("Missing file: " + raw)
        elif sha(path) != item["sha256"]:
            errors.append("Hash mismatch: " + raw)
        stats["manifest_files"] += 1

    ignored = set(manifest.get("unhashed_outputs", [])) | {"PACKAGE-MANIFEST.json"}
    actual = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*")
              if p.is_file() and ".git" not in p.relative_to(ROOT).parts
              and "__pycache__" not in p.relative_to(ROOT).parts}
    for raw in sorted(actual - listed - ignored):
        errors.append("Unlisted file: " + raw)

    for path in sorted(ROOT.rglob("*.json")):
        if ".git" in path.relative_to(ROOT).parts:
            continue
        try:
            json.loads(path.read_text(encoding="utf-8-sig"))
            stats["json_files"] += 1
        except (ValueError, UnicodeError) as exc:
            errors.append(f"Invalid JSON: {path.relative_to(ROOT)}: {exc}")

    for path in sorted(ROOT.rglob("*.md")):
        text = path.read_text(encoding="utf-8-sig")
        fence = None
        body = []
        for line in text.splitlines():
            match = re.match(r"^\s*(`{3,}|~{3,})", line)
            if match:
                marker = match[1]
                if fence is None:
                    fence = marker
                elif marker[0] == fence[0] and len(marker) >= len(fence):
                    fence = None
                continue
            if fence is None:
                body.append(line)
        if fence is not None:
            errors.append("Unclosed code fence: " + str(path.relative_to(ROOT)))
        # Sufficient for this package's inline Markdown links; not a full parser.
        for match in re.finditer(r"!?\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)", "\n".join(body)):
            target = match[1].strip()
            target = target[1:-1] if target.startswith("<") else re.sub(r'\s+"[^"]*"$', '', target)
            parsed = urlsplit(target)
            if parsed.scheme or target.startswith(("#", "//")):
                continue
            clean = unquote(parsed.path)
            if not clean:
                continue
            linked = (path.parent / clean).resolve()
            stats["markdown_file_links"] += 1
            if not linked.is_relative_to(ROOT) or not linked.exists():
                errors.append(f"Broken/nonportable link: {path.relative_to(ROOT)} -> {target}")

    source = json.loads((ROOT / "skills/SOURCE.json").read_text(encoding="utf-8-sig"))
    for skill in source["skills"]:
        for item in skill["files"]:
            path = relative_file("skills/" + item["bundled_path"])
            if not path.is_file() or sha(path) != item["source_sha256"]:
                errors.append("Skill differs from recorded upstream: " + item["bundled_path"])
            stats["skill_source_hashes"] += 1

    fixtures = json.loads((ROOT / "design/demo-fixtures.json").read_text(encoding="utf-8-sig"))
    records = {r["trackerId"]: r for r in fixtures["baseRecords"]}
    runs = {r["runId"]: r for r in fixtures["baseRuns"]}
    if len(records) != len(fixtures["baseRecords"]) or len(runs) != len(fixtures["baseRuns"]):
        errors.append("Duplicate design record/run IDs")
    for record in records.values():
        run_id = record.get("latestRunId")
        if run_id and (run_id not in runs or runs[run_id]["trackerId"] != record["trackerId"]):
            errors.append("Invalid latest run reference: " + record["trackerId"])
    for run in runs.values():
        if run["trackerId"] not in records:
            errors.append("Run references missing record: " + run["runId"])
    for view in fixtures["primaryViews"]:
        selected = view.get("selectedTrackerId")
        run_id = view.get("selectedRunId")
        if selected and selected not in records:
            errors.append("View references missing record: " + view["viewId"])
        if run_id and (run_id not in runs or runs[run_id]["trackerId"] != selected):
            errors.append("View references inconsistent run: " + view["viewId"])
        stats["primary_views"] += 1

    result = {"result": "FAIL" if errors else "PASS", "scope": "package-integrity-only",
              "counts": stats, "errors": errors,
              "not_verified": ["external URLs", "Markdown heading anchors", "native schemas",
                               "UI rendering or interaction", "Nimbalyst build", "live agents/devices"]}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as exc:
        print(json.dumps({"result": "FAIL", "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
