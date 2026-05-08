---
layout: home
hero:
  name: Gemini-CLI SDK
  text: Drop-in TypeScript + Python SDK for gemini-cli
  tagline: Claude Agent SDK-shaped API. Windows-first. Parity-enforced.
  actions:
    - theme: brand
      text: TypeScript Quickstart
      link: /ts/quickstart
    - theme: alt
      text: Python Quickstart
      link: /python/quickstart
features:
  - title: Subprocess-based
    details: Wraps gemini-cli via child_process / anyio — no library entry point needed.
  - title: Fixture-enforced parity
    details: TS and Python consume the same spec/fixtures/*.ndjson corpus in CI.
  - title: Archon-ready
    details: DEFAULT_AI_ASSISTANT=gemini works end-to-end via the adapter-archon subpackage.
---
