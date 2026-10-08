"""Build a source delivery archive for a new Python + ROS installation.

Only explicit runtime roots are included. Runtime data, Java, tests, local
credentials, and generated build outputs stay in the developer checkout.
"""

import argparse
import hashlib
import io
from pathlib import Path
import sys
import tarfile


ROOT = Path(__file__).resolve().parents[2]
ROOTS = (
    "backend/app",
    "backend/migrations",
    "backend/scripts",
    "backend/requirements.txt",
    "frontend/src",
    "frontend/login.html",
    "frontend/operations.html",
    "frontend/localization.html",
    "frontend/map-workbench.html",
    "frontend/map-bindings.html",
    "frontend/radar-settings.html",
    "frontend/ros-maintenance.html",
    "ros/orange_nav_ws/src",
    "ros/orange_nav_ws/scripts",
    "ros/orange_nav_ws/third_party",
    "ros/orange_nav_ws/README.md",
    "ops/scripts",
    "ops/systemd",
    "ops/config/runtime.env.example",
    "ops/packaging/build_fresh_bundle.py",
    "README.md",
    "docs/PYTHON_FRESH_SYSTEM.md",
    "docs/MAP_WORKBENCH.md",
    "docs/ROS_RUNTIME_DELIVERY.md",
    "docs/ROS_LOCALIZATION_DELIVERY.md",
    "docs/RCS_RDS_DELIVERY.md",
    "docs/AUTO_LOCALIZATION_MOTION_CHECK.md",
)
SKIP_DIRS = {".git", "__pycache__", "node_modules", "build", "install", "log", ".deps-build"}
SKIP_NAMES = {".env", "runtime.env", ".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".class", ".jar", ".java", ".db", ".sqlite", ".sqlite3"}
# This C++ source is referenced by vehicle_navigation/CMakeLists.txt when
# BUILD_TESTING is enabled, so the offline ROS build needs it even though
# ordinary test fixtures are excluded from the delivery bundle.
BUILD_REQUIRED_TEST_SOURCES = {
    "ros/orange_nav_ws/src/navigation/vehicle_navigation/test/test_motion_profiles.cpp",
}


def inventory(root: Path = ROOT) -> list[Path]:
    selected: list[Path] = []
    for item in ROOTS:
        source = root / item
        if not source.exists():
            raise FileNotFoundError(f"Required delivery input missing: {source}")
        paths = [source] if source.is_file() else source.rglob("*")
        for path in paths:
            relative = path.relative_to(root)
            if any(part in SKIP_DIRS for part in relative.parts):
                continue
            if path.is_symlink():
                raise RuntimeError(f"Refusing symlink in delivery: {relative}")
            if not path.is_file():
                continue
            if path.name in SKIP_NAMES or path.suffix.lower() in SKIP_SUFFIXES:
                continue
            if path.name.startswith(".env") or (
                path.name.startswith("test_") and relative.as_posix() not in BUILD_REQUIRED_TEST_SOURCES
            ):
                continue
            selected.append(relative)
    return sorted(set(selected), key=lambda path: path.as_posix())


def build(output: Path, root: Path = ROOT) -> int:
    files = inventory(root)
    if not files:
        raise RuntimeError("Delivery inventory is empty")
    output.parent.mkdir(parents=True, exist_ok=True)
    checksums = []
    with tarfile.open(output, "w:gz") as archive:
        for relative in files:
            source = root / relative
            data = source.read_bytes()
            name = "orange-fresh/" + relative.as_posix()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o755 if source.suffix == ".sh" else 0o644
            info.mtime = 0
            archive.addfile(info, io.BytesIO(data))
            checksums.append(f"{hashlib.sha256(data).hexdigest()}  {relative.as_posix()}\n")
        manifest = "".join(checksums).encode("utf-8")
        info = tarfile.TarInfo("orange-fresh/SHA256SUMS")
        info.size = len(manifest)
        info.mode = 0o644
        info.mtime = 0
        archive.addfile(info, io.BytesIO(manifest))
    return len(files)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="destination .tar.gz outside the source checkout")
    parser.add_argument("--list", action="store_true", help="show source inventory without creating an archive")
    args = parser.parse_args()
    if args.list:
        sys.stdout.reconfigure(encoding="utf-8")
        print("\n".join(path.as_posix() for path in inventory()))
    elif args.output:
        destination = args.output.resolve()
        if ROOT == destination or ROOT in destination.parents:
            parser.error("delivery output must be outside the source checkout")
        print(f"Packed {build(destination)} files into {destination}")
    else:
        parser.error("choose --list or --output")
