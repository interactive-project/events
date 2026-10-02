import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
root = Path(__file__).resolve().parent.parent
def read(path):
    return json.loads((root / path).read_text())
schema = read("schemas/event.v1.schema.json")
Draft202012Validator.check_schema(schema)
registry = Registry()
for name in ["activity-spec", "interoperability"]:
    dependency = read(f"node_modules/@interactive-project/protocol/schemas/{name}.v1.schema.json")
    registry = registry.with_resource(dependency["$id"], Resource.from_contents(dependency))
validator = Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())
manifest = read("fixtures/conformance.json")
for entry in manifest:
    expected = entry["valid"] or entry.get("structural") is False
    assert validator.is_valid(read("fixtures/" + entry["file"])) == expected, entry["file"]
print(f"Python: {len(manifest)} independent structural event fixtures passed.")
