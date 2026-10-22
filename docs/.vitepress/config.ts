// The docs site, built with the Miragon docs kit (docs/.vitepress/miragon/, vendored from
// Miragon/corporate-identity, skill docs-site). The kit sets everything else: base from
// DOCS_BASE, theme, colours light and dark, GitHub anchors, Mermaid, search, the legal row.
import { miragonDocs } from './miragon/config';

export default miragonDocs({
  repo: 'Miragon/operate',
  // The product name (corporate design: a tool is "Miragon" plus its name); the npm package keeps
  // its name @miragon/operate. The wordmark reads MIRAGON, the name next to it "operate".
  title: 'Miragon operate',
  siteTitle: 'operate',
  description:
    'operate is a command line tool for Camunda 7, CIB seven and Operaton that lets you, your coding agent or a CI job work with a process engine in short commands.',
  productPage: 'https://miragon.ai/tools/operate/',
  footerMessage: 'Released under the MIT License.',

  // Maintainer notes, read on GitHub next to CONTRIBUTING.md: not a page of the site.
  srcExclude: ['releasing.md'],

  markdown: {
    // Inline code is literal, as on GitHub: Vue would read `{{ json .SBOM }}` (installation.md)
    // as an interpolation. Fenced code blocks get v-pre from VitePress already.
    config(md) {
      const codeInline = md.renderer.rules.code_inline;
      md.renderer.rules.code_inline = (...args) =>
        (codeInline?.(...args) ?? '').replace(/^<code/, '<code v-pre');
    },
  },

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
    {
      text: 'Setup',
      link: '/configuration',
      activeMatch: '^/(configuration|authentication|engines)',
    },
    { text: 'AI agents', link: '/agents', activeMatch: '^/agents' },
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
        { text: 'Engines', link: '/engines' },
      ],
    },
    {
      text: 'AI agents',
      items: [{ text: 'Using operate from AI agents', link: '/agents' }],
    },
    {
      text: 'Contributing',
      collapsed: true,
      items: [
        { text: 'Development', link: '/development' },
        { text: 'Architecture', link: '/architecture' },
        { text: 'Architecture decisions', link: '/adr/' },
      ],
    },
  ],
});
