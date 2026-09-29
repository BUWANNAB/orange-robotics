"""List Spring controller routes still absent from FastAPI.

This is a conservative source inventory, not proof of behavioral parity.
Run from backend with the application's Python environment.
"""

import re
from pathlib import Path

from app.main import app


ROOT = Path(__file__).resolve().parents[2]
CONTROLLERS = ROOT / "archive/java-legacy/backend/src/main/java/com/ant/robot/controller"
ANNOTATION = re.compile(r"@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(([^)]*)\)", re.S)
STRING = re.compile(r'"([^"]*)"')
PLACEHOLDER = re.compile(r"\{[^{}]+\}")


def path(prefix, suffix):
    return "/" + "/".join(part.strip("/") for part in (prefix, suffix) if part.strip("/"))


def key(method, route):
    return method.upper(), PLACEHOLDER.sub("{}", route)


def java_routes():
    rows = []
    for source in sorted(CONTROLLERS.glob("*.java")):
        content = source.read_text(encoding="utf-8")
        declaration = re.search(r"\bpublic\s+class\s+\w+", content)
        if not declaration:
            continue
        class_annotations = list(ANNOTATION.finditer(content[:declaration.start()]))
        prefix = next((STRING.search(match.group(2)).group(1)
                       for match in reversed(class_annotations)
                       if match.group(1) == "Request" and STRING.search(match.group(2))), "")
        for match in ANNOTATION.finditer(content[declaration.end():]):
            route = STRING.search(match.group(2))
            if route is None:
                continue
            annotation = match.group(1)
            method = annotation.upper() if annotation != "Request" else "ANY"
            rows.append((source.name, method, path(prefix, route.group(1))))
    return rows


def main():
    python_routes = {key(method, route) for route, operations in app.openapi()["paths"].items()
                     for method in operations if method.upper() in {"GET", "POST", "PUT", "DELETE", "PATCH"}}
    java = java_routes()
    missing = [(source, method, route) for source, method, route in java
               if method == "ANY" or key(method, route) not in python_routes]
    print(f"Java controller routes: {len(java)}")
    print(f"Routes absent from FastAPI (source-level estimate): {len(missing)}")
    for source, method, route in missing:
        print(f"{source}\t{method}\t{route}")


if __name__ == "__main__":
    main()
