import { defineConfig } from 'vitepress';
import typedocSidebar from '../ts/api/typedoc-sidebar.json' with { type: 'json' };

export default defineConfig({
  title: 'Gemini SDK',
  description: 'TypeScript + Python SDK for gemini-cli (Claude Agent SDK-shaped).',
  base: '/Gemini-SDK/',
  lastUpdated: true,
  // Dead links to repo files outside the docs tree (e.g. ts/tests-live/README,
  // .planning/REQUIREMENTS) are expected — these are repo cross-references only.
  ignoreDeadLinks: [
    /\/ts\/tests-live\//,
    /\/\.planning\//,
  ],
  themeConfig: {
    nav: [
      { text: 'TypeScript', link: '/ts/quickstart' },
      { text: 'Python', link: '/python/' },
      { text: 'Compat Matrix', link: '/compat-matrix' },
      { text: 'Known Issues', link: '/known-issues' },
    ],
    sidebar: {
      '/ts/api/': typedocSidebar,
      '/ts/': [
        { text: 'Getting Started', items: [{ text: 'Quickstart', link: '/ts/quickstart' }] },
        { text: 'API Reference', link: '/ts/api/' },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/seanrobertwright/Gemini-SDK' }],
  },
});
