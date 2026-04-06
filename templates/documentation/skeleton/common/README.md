# ${{ values.title }}

${{ values.description }}

## Documentation Format

This repository uses **${{ values.docFormat | upper }}** format.

{% if values.docFormat === 'mkdocs' %}
Documentation lives in the `docs/` directory. Edit `.md` files to update content.
{% else %}
Documentation lives in the `pages/` directory. Edit `.mdx` files to update content.
{% endif %}

## Viewing in Nexus IDP

This documentation is available in the [Stratpoint IDP](https://portal.stratpoint.io) under the **Docs** sidebar.

## Local Preview

{% if values.docFormat === 'mkdocs' %}
```bash
pip install mkdocs
mkdocs serve
```
{% else %}
```bash
npm install
npm run dev
```
{% endif %}
