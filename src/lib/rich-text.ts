/**
 * Sanitising and flattening rich-text note HTML.
 *
 * Notes are written by staff in a WYSIWYG editor and rendered back with
 * `dangerouslySetInnerHTML`, so unsanitised note HTML is a stored-XSS vector
 * against every later viewer. This module is the single allowlist, and it runs
 * in BOTH places on purpose:
 *
 *  - on write, in the route/service, because that is the only layer an attacker
 *    cannot skip (a crafted POST never touches our editor);
 *  - on render, because rows can predate this module or arrive from another
 *    writer (the capability surface, a future importer, a hand-run SQL fix).
 *
 * `isomorphic-dompurify` is used rather than plain `dompurify` so both sides run
 * the identical allowlist and hook — two sanitisers would be two things to keep
 * in step, and the one that drifts is the one that lets something through.
 *
 * The allowlist is ported from bm-designflow's `safeHtml.ts` (fleet parity),
 * minus `style` and the mention/colour-chip data attributes: this app's editor
 * cannot produce them, and an attribute nothing emits is surface for nothing.
 * Add them here in the same change that adds the feature that needs them.
 */
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'mark',
  'sub',
  'sup',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class'];

let hookRegistered = false;
function ensureLinkHardeningHook() {
  if (hookRegistered) return;
  // Any surviving link is treated as external: no tabnabbing (`noopener`), no
  // referrer leakage (this app puts magic-link tokens in URLs), and no SEO
  // credit passed to whatever someone pastes.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  hookRegistered = true;
}

/** Sanitise note HTML down to the formatting allowlist. Never returns null. */
export function sanitizeNoteHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  ensureLinkHardeningHook();
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Drop a disallowed tag but keep its (sanitised) text, so pasting from Word
    // loses the wrapper rather than the sentence.
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false,
  });
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Flatten note HTML to plain text for previews, search and email bodies.
 *
 * Tag-stripping by regex is only safe on already-sanitised HTML, so this
 * sanitises first rather than trusting its caller — on hostile input a regex
 * strip is defeated by things like `<scr<script>ipt>`.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const safe = sanitizeNoteHtml(html);
  return safe
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    // An empty <li> would otherwise flatten to a lone bullet, which reads as
    // content — enough to make an empty bulleted note look storable.
    .filter((line) => line !== '•')
    .join('\n')
    .trim();
}

/**
 * True when the note carries no actual content — `<p><br></p>` is what an empty
 * contenteditable produces, and it must not be storable as a note.
 */
export function isNoteEmpty(html: string | null | undefined): boolean {
  return htmlToPlainText(html).length === 0;
}
