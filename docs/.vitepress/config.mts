import { defineConfig } from 'vitepress';
import typedocSidebar from '../ts/api/typedoc-sidebar.json' with { type: 'json' };

export default defineConfig({
  title: 'Gemini-CLI SDK',
  description: 'TypeScript + Python SDK for gemini-cli (Claude Agent SDK-shaped).',
  base: process.env.DOCS_BASE ?? '/Gemini-SDK/',
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: (process.env.DOCS_BASE ?? '/Gemini-SDK/') + 'gemini-cli-icon.svg' }],
  ],
  // Dead links to repo files outside the docs tree (e.g. ts/tests-live/README,
  // .planning/REQUIREMENTS) are expected — these are repo cross-references only.
  ignoreDeadLinks: [
    /\/ts\/tests-live\//,
    /\/\.planning\//,
    /\/python\/api\//,
  ],
  themeConfig: {
    logo: '/gemini-cli-icon.svg',
    nav: [
      { text: 'TypeScript', link: '/ts/quickstart' },
      { text: 'Python', link: '/python/quickstart' },
      { text: 'Compat Matrix', link: '/compat-matrix' },
      { text: 'Known Issues', link: '/known-issues' },
      { text: 'Archon', link: '/archon-integration' },
    ],
    sidebar: {
      '/ts/api/': typedocSidebar,
      '/ts/': [
        { text: 'Getting Started', items: [{ text: 'Quickstart', link: '/ts/quickstart' }] },
        { text: 'Migration', items: [
          { text: 'From Claude Agent SDK', link: '/ts/migration-claude' },
          { text: 'From Codex SDK', link: '/ts/migration-codex' },
        ]},
        { text: 'API Reference', link: '/ts/api/' },
      ],
      '/python/': [
        { text: 'Getting Started', items: [{ text: 'Quickstart', link: '/python/quickstart' }] },
        { text: 'Migration', items: [
          { text: 'From Claude Agent SDK', link: '/python/migration-claude' },
          { text: 'From Codex SDK', link: '/python/migration-codex' },
        ]},
        { text: 'API Reference', link: '/python/api/', target: '_self' },
      ],
      '/': [
        { text: 'Compat Matrix', link: '/compat-matrix' },
        { text: 'Known Issues', link: '/known-issues' },
        { text: 'Archon Integration', link: '/archon-integration' },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/seanrobertwright/Gemini-SDK' }],
  },
});
