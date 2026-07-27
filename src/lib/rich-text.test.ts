import { describe, expect, it } from 'vitest';
import { htmlToPlainText, isNoteEmpty, sanitizeNoteHtml } from './rich-text';

describe('sanitizeNoteHtml — formatting we must keep', () => {
  it('keeps the tags the editor produces', () => {
    const html =
      '<p><strong>Bold</strong> <em>italic</em> <s>struck</s></p><ul><li>one</li></ul><ol><li>two</li></ol>';
    expect(sanitizeNoteHtml(html)).toBe(html);
  });

  it('keeps headings, quotes and code', () => {
    const html = '<h3>Title</h3><blockquote>quoted</blockquote><pre><code>x = 1</code></pre>';
    expect(sanitizeNoteHtml(html)).toBe(html);
  });

  it('returns an empty string for null/undefined/empty', () => {
    expect(sanitizeNoteHtml(null)).toBe('');
    expect(sanitizeNoteHtml(undefined)).toBe('');
    expect(sanitizeNoteHtml('')).toBe('');
  });

  it('keeps plain text untouched', () => {
    expect(sanitizeNoteHtml('Just a sentence.')).toBe('Just a sentence.');
  });
});

describe('sanitizeNoteHtml — XSS corpus', () => {
  // Each entry is a real stored-XSS shape. The assertion is deliberately about
  // what must NOT survive rather than the exact output, since DOMPurify is free
  // to re-serialise as it likes.
  const attacks: [name: string, payload: string, mustNotContain: string][] = [
    ['script tag', '<p>hi</p><script>alert(1)</script>', 'alert'],
    ['nested/broken script', '<scr<script>ipt>alert(1)</scr</script>ipt>', '<script'],
    ['inline onclick', '<p onclick="steal()">text</p>', 'onclick'],
    ['onerror on img', '<img src=x onerror="alert(1)">', 'onerror'],
    ['onload on svg', '<svg onload="alert(1)"></svg>', 'onload'],
    ['javascript: href', '<a href="javascript:alert(1)">click</a>', 'javascript:'],
    ['JaVaScRiPt: href', '<a href="JaVaScRiPt:alert(1)">click</a>', 'avascript'],
    ['data: href', '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', 'data:text/html'],
    ['vbscript: href', '<a href="vbscript:msgbox(1)">x</a>', 'vbscript:'],
    ['iframe', '<iframe src="https://evil.test"></iframe>', '<iframe'],
    ['object/embed', '<object data="evil.swf"></object><embed src="evil.swf">', '<object'],
    ['form + input', '<form action="https://evil.test"><input name="p"></form>', '<form'],
    ['style tag', '<style>body{display:none}</style>', '<style'],
    ['inline style attribute', '<p style="position:fixed;top:0">overlay</p>', 'style='],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.test">', '<meta'],
    ['base tag', '<base href="https://evil.test/">', '<base'],
    ['srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>', 'srcdoc'],
    ['event handler with newline', '<p onmouseover\n="alert(1)">x</p>', 'onmouseover'],
  ];

  it.each(attacks)('neutralises %s', (_name, payload, mustNotContain) => {
    const clean = sanitizeNoteHtml(payload);
    expect(clean.toLowerCase()).not.toContain(mustNotContain.toLowerCase());
  });

  it('keeps the readable text when dropping a disallowed wrapper', () => {
    // KEEP_CONTENT: pasting from Word should lose the wrapper, not the sentence.
    expect(sanitizeNoteHtml('<div><font size="7">Important</font></div>')).toContain('Important');
  });

  it('strips data-* attributes (nothing in this app emits them yet)', () => {
    expect(sanitizeNoteHtml('<span data-mention-id="123">@Dave</span>')).not.toContain(
      'data-mention-id',
    );
  });
});

describe('sanitizeNoteHtml — link hardening', () => {
  it('forces target and rel on an external link', () => {
    const clean = sanitizeNoteHtml('<a href="https://drive.google.com/x">artwork</a>');
    expect(clean).toContain('href="https://drive.google.com/x"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
  });

  // Otherwise a note could opt itself out of the protections above.
  it('overrides an attacker-supplied target/rel', () => {
    const clean = sanitizeNoteHtml('<a href="https://evil.test" target="_self" rel="">x</a>');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).not.toContain('_self');
  });

  it('leaves an anchor with no href alone', () => {
    expect(sanitizeNoteHtml('<a>bare</a>')).not.toContain('target');
  });
});

describe('htmlToPlainText', () => {
  it('turns block boundaries into newlines', () => {
    expect(htmlToPlainText('<p>First</p><p>Second</p>')).toBe('First\nSecond');
  });

  it('turns <br> into a newline', () => {
    expect(htmlToPlainText('<p>One<br>Two</p>')).toBe('One\nTwo');
  });

  it('bullets list items', () => {
    expect(htmlToPlainText('<ul><li>red</li><li>blue</li></ul>')).toBe('• red\n• blue');
  });

  it('drops formatting tags but keeps their text', () => {
    expect(htmlToPlainText('<p>Use the <strong>navy</strong> thread</p>')).toBe(
      'Use the navy thread',
    );
  });

  it('decodes the entities the editor emits', () => {
    expect(htmlToPlainText('<p>Tom &amp; Jerry&nbsp;&mdash; 5&lt;6</p>')).toContain('Tom & Jerry');
    expect(htmlToPlainText('<p>5&lt;6</p>')).toBe('5<6');
  });

  it('collapses runs of blank lines', () => {
    expect(htmlToPlainText('<p>A</p><p></p><p></p><p>B</p>')).toBe('A\n\nB');
  });

  // The flattened text is what lands in emails and previews, so a payload must
  // not survive the round-trip as markup either.
  it('strips scripts rather than emitting their source as text', () => {
    expect(htmlToPlainText('<p>hi</p><script>alert(1)</script>')).toBe('hi');
  });

  // A split-tag payload leaves inert debris behind as TEXT ("ipt>alert(1)ipt>"),
  // which is harmless — it can never execute. What must not survive is markup,
  // since the flattened text is also what gets embedded in emails.
  it('emits no markup for a split-tag payload', () => {
    const text = htmlToPlainText('<scr<script>ipt>alert(1)</scr</script>ipt>');
    expect(text).not.toContain('<script');
    expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  it('returns an empty string for null/undefined', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
  });
});

describe('isNoteEmpty', () => {
  // What an emptied contenteditable actually contains.
  it.each(['', '   ', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '<ul><li></li></ul>'])(
    'treats %j as empty',
    (html) => {
      expect(isNoteEmpty(html)).toBe(true);
    },
  );

  it('treats markup-only payloads as empty', () => {
    expect(isNoteEmpty('<script>alert(1)</script>')).toBe(true);
  });

  it('is false once there is real text', () => {
    expect(isNoteEmpty('<p>ok</p>')).toBe(false);
  });
});
