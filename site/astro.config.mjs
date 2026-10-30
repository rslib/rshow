import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import rslibTheme from 'starlight-theme-rslib';

export default defineConfig({
  site: 'https://rslib.github.io',
  base: '/rshow',
  integrations: [
    starlight({
      title: 'rshow',
      description: 'Publish and share static pages, decks and reports from your own Cloudflare account.',
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/rslib/rshow' }],
      plugins: [rslibTheme(), starlightLinksValidator()],
      sidebar: [
        { label: 'Start', items: [{ label: 'rshow', slug: '' }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        {
          label: 'Reference',
          items: [
            { label: 'Commands overview', slug: 'reference/commands' },
            { label: 'Commands', collapsed: true, items: [{ autogenerate: { directory: 'reference/commands' } }] },
            { label: 'Theme tokens', slug: 'reference/theme-tokens' },
            { label: 'Exit codes', slug: 'reference/exit-codes' },
            { label: 'API', slug: 'reference/api' },
          ],
        },
      ],
    }),
  ],
  // npm links the theme from .theme, so Vite may serve its fonts from there.
  vite: { server: { fs: { allow: ['.', './.theme/starlight'] } } },
});
