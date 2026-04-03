// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: '${{ values.title }}',
  tagline: '${{ values.description }}',
  url: 'https://github.com/${{ values.repoOrg }}/${{ values.repoName }}',
  baseUrl: '/',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  organizationName: '${{ values.repoOrg }}',
  projectName: '${{ values.repoName }}',

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],
};

module.exports = config;
