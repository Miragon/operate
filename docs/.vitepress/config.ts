import { defineConfig } from 'vitepress';

// GitHub Pages serves the project site under /operate/: the docs workflow
// (.github/workflows/docs.yml) sets DOCS_BASE accordingly. Local dev and
// preview keep the default "/".
const base = process.env.DOCS_BASE ?? '/';

export default defineConfig({
  base,
  lang: 'en-US',
  // The product name (corporate design: a tool is "Miragon" plus its name);
  // the npm package keeps its name @miragon/operate.
  title: 'Miragon operate',
  description:
    'operate is a command line tool for Camunda 7, CIB seven and Operaton that lets you, your coding agent or a CI job work with a process engine in short commands.',
  cleanUrls: true,
  lastUpdated: true,

  // Maintainer notes, read on GitHub next to CONTRIBUTING.md: not a page of the site.
  srcExclude: ['releasing.md'],

  // Code blocks sit on --cd-grau (light) and a white lift of --cd-schwarz
  // (dark). There, github-light-high-contrast and github-dark-default keep
  // every token colour at WCAG AA (the lowest, comments, at 4.72:1 and
  // 4.98:1); VitePress' default pair github-light/github-dark and
  // github-light-default (comments 4.26:1 on --cd-grau) don't.
  markdown: {
    theme: { light: 'github-light-high-contrast', dark: 'github-dark-default' },
    // Inline code is literal, as on GitHub: Vue would read `{{ json .SBOM }}` (installation.md)
    // as an interpolation. Fenced code blocks get v-pre from VitePress already.
    config(md) {
      const codeInline = md.renderer.rules.code_inline;
      md.renderer.rules.code_inline = (...args) =>
        (codeInline?.(...args) ?? '').replace(/^<code/, '<code v-pre');
    },
  },

  head: [
    // The app icon of Miragon software: the green Komet on the blue tile,
    // the CI's file unchanged. Head links are not rewritten for `base`.
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo/miragon-komet-blau.svg` }],
    // CI primary blue (--cd-blau) for the browser chrome
    ['meta', { name: 'theme-color', content: '#335DE5' }],
  ],

  // Preload the self-hosted Geist (hashed file name, so a static head link
  // can't point at it; see vitepress.dev site-config#transformhead).
  transformHead({ assets }) {
    const geist = assets.find((file) => /geist-latin-wght-normal\.[\w-]+\.woff2$/.test(file));
    if (!geist) return;
    return [
      ['link', { rel: 'preload', href: geist, as: 'font', type: 'font/woff2', crossorigin: '' }],
    ];
  },

  themeConfig: {
    // The official wordmarks: green (the standard) on light, white on dark.
    logo: {
      light: '/logo/miragon-logo-gruen.svg',
      dark: '/logo/miragon-logo-weiss.svg',
      alt: 'Miragon',
    },
    // A product shows the wordmark and writes its name next to it in Geist;
    // the wordmark already reads MIRAGON, so the nav reads "MIRAGON operate"
    // (and its link's accessible name "Miragon operate").
    siteTitle: 'operate',

    nav: [
      {
        text: 'Getting started',
        link: '/getting-started',
        activeMatch: '^/(getting-started|quick-start|installation)',
      },
      {
        text: 'Commands',
        link: '/workflow-commands',
        activeMatch: '^/(workflow-commands|commands|recipes|output-and-errors|safety)',
      },
      { text: 'Setup', link: '/configuration', activeMatch: '^/(configuration|authentication)' },
      { text: 'AI agents', link: '/agents', activeMatch: '^/agents' },
      { text: 'miragon.ai', link: 'https://miragon.ai/tools/operate/' },
    ],

    // One sidebar for every page: the docs are one flat folder.
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Quick start', link: '/quick-start' },
          { text: 'Installation', link: '/installation' },
        ],
      },
      {
        text: 'Commands',
        items: [
          { text: 'Workflow commands', link: '/workflow-commands' },
          { text: 'Command structure', link: '/commands' },
          { text: 'Recipes', link: '/recipes' },
          { text: 'Output and errors', link: '/output-and-errors' },
          { text: 'Safety', link: '/safety' },
        ],
      },
      {
        text: 'Setup',
        items: [
          { text: 'Configuration', link: '/configuration' },
          { text: 'Authentication', link: '/authentication' },
        ],
      },
      {
        text: 'AI agents',
        items: [{ text: 'Using operate from AI agents', link: '/agents' }],
      },
      {
        text: 'Contributing',
        collapsed: true,
        items: [{ text: 'Development', link: '/development' }],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/Miragon/operate' }],

    outline: { level: [2, 3] },

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/Miragon/operate/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    // A plain date in the site's language ("Oct 11, 2026"), not the reader's
    // short date and time ("10/11/26, 10:44 AM").
    lastUpdated: {
      text: 'Last updated',
      formatOptions: { dateStyle: 'medium', forceLocale: true },
    },

    // Say what happened and what to do, in sentence case (VitePress' default
    // is an all-caps "PAGE NOT FOUND" and a quote).
    notFound: {
      title: "This page doesn't exist",
      quote: 'The link may be outdated. Search the docs, or start at the docs home.',
      linkLabel: 'Go to the docs home',
      linkText: 'Go to the docs home',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Miragon',
    },
  },
});
