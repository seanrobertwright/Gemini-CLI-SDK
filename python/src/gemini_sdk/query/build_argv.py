"""
python/src/gemini_sdk/query/build_argv.py

Pure function that maps QueryOptions to a string[] argv for gemini-cli.
No I/O, no side effects — 100% unit-testable.
"""

from __future__ import annotations

from .types import QueryOptions


def build_argv(options: QueryOptions) -> list[str]:
    """Build the argv list to pass to gemini-cli for a given QueryOptions.

    Rules:
      - Always starts with ['--output-format', 'stream-json', '-p', prompt]
      - model 'auto' or undefined -> omits --model flag (MDL-03)
      - Any other model value -> ['--model', value] (MDL-01, MDL-02)
      - additional_directories -> one '--include-directories <dir>' per entry (CWD-02)
      - Empty additional_directories list -> omits --include-directories flag
    """
    argv: list[str] = [
        "--output-format", "stream-json",
        "-p", options["prompt"],
    ]

    # MDL-03: omit --model when None or 'auto'
    model = options.get("model")
    if model is not None and str(model) != "auto":
        argv.extend(["--model", str(model)])

    # CWD-02: one --include-directories flag per directory
    dirs = options.get("additional_directories")
    if dirs:
        for d in dirs:
            argv.extend(["--include-directories", d])

    return argv
