import React from 'react';
import { render } from '@testing-library/react';
import { DescriptionHtml } from './descriptionHtml';

const html = (source: string) => render(<DescriptionHtml html={source} />).container;

describe('DescriptionHtml', () => {
  it('keeps basic formatting', () => {
    const c = html('<p>One <strong>two</strong> <em>three</em> <code>four()</code></p><ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>');
    expect(c.querySelectorAll('p, strong, em, code, ul, ol, li')).toHaveLength(9);
    expect(c.textContent).toBe('One two three four()abc');
  });

  it('turns headings into bold paragraphs and keeps the text of unknown elements', () => {
    const c = html('<h2>Title</h2><custom-thing>kept <span>text</span></custom-thing>');
    expect(c.querySelector('h2')).toBeNull();
    expect(c.querySelector('.tech-radar-heading > strong')?.textContent).toBe('Title');
    expect(c.textContent).toBe('Titlekept text');
  });

  it('removes scripts, styles, frames and their contents', () => {
    const c = html('<p>safe</p><script>window.hacked = 1</script><style>p{display:none}</style><iframe src="https://x.test"></iframe><object data="x"></object><embed src="x">');
    expect(c.querySelector('script, style, iframe, object, embed')).toBeNull();
    expect(c.textContent).toBe('safe');
    expect((window as any).hacked).toBeUndefined();
  });

  it('never copies attributes from the source (no onerror, onclick, style, src)', () => {
    const c = html('<p onclick="x()" style="color:red" class="evil">hi</p><img src=x onerror="window.hacked=1"><b onmouseover="x()">bold</b>');
    expect(c.querySelector('img')).toBeNull();
    for (const el of Array.from(c.querySelectorAll('p, b'))) {
      expect(el.getAttributeNames()).toEqual([]);
    }
    expect((window as any).hacked).toBeUndefined();
  });

  it('keeps https links, opening them safely in a new tab', () => {
    const a = html('<p><a href="https://example.com/post?a=1">source</a></p>').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/post?a=1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
  });

  it('drops links that are not plain https, keeping their text', () => {
    // eslint-disable-next-line no-script-url
    for (const href of ['javascript:alert(1)', 'http://example.com', 'data:text/html,<b>x</b>', '//example.com', 'relative/path', 'ftp://example.com']) {
      const c = html(`<p><a href="${href}">label</a></p>`);
      expect(c.querySelector('a')).toBeNull();
      expect(c.textContent).toBe('label');
    }
  });

  it("reads the source's CSV-escaped markup (doubled quotes, surrounding quotes)", () => {
    const c = html('"<p><strong><a href=""https://example.com/x"" target=""_blank"" class=""pop-out"">Context</a></strong> is ""new"" now.</p>"');
    expect(c.querySelector('a')?.getAttribute('href')).toBe('https://example.com/x');
    expect(c.textContent).toBe('Context is "new" now.');
  });

  it('renders nothing for an empty description', () => {
    expect(html('').textContent).toBe('');
    expect(html('  "" ').textContent).toBe('');
  });
});
