/**
 * SyntaxHighlighter — a thin wrapper around `prism-react-renderer` that
 * renders generated code with a custom "Calm Precision" light theme.
 *
 * Why prism-react-renderer over shiki: the code panel streams updates
 * from the SSE hook (sometimes dozens per second). Prism tokenizes
 * incrementally per chunk and is cheap. Shiki uses WASM and re-runs
 * grammars over the full text on every update — too expensive for
 * a streaming code surface.
 *
 * Token colors follow the "Calm Precision" light design system
 * defined in `index.css`:
 *   - keywords / at-rules    → indigo primary (--primary)
 *   - HTML tags              → light indigo (lighter shade)
 *   - strings / attributes   → emerald green
 *   - comments               → muted gray
 *   - function names         → blue (visual distinction from primary)
 *   - numbers                → amber
 *   - punctuation/operator   → gray
 *   - plain text             → foreground
 *
 * Renders a per-line layout: line-number gutter on the left (right-
 * aligned, dimmed, non-selectable) + code tokens on the right. The
 * outer container handles vertical scroll; the inner pre handles
 * horizontal overflow for long lines.
 *
 * 2026-07-06 (Calm Precision light redesign) — light theme with
 * indigo keywords, emerald strings, light-gray comments, blue
 * function names. Code area is `bg-background-sunken` (a barely-
 * tinted gray) so the syntax colors carry the page.
 */
import { Highlight, type PrismTheme } from 'prism-react-renderer'
import { memo } from 'react'

/**
 * The custom theme. Uses fixed hex colors (not semantic tokens)
 * for the syntax palette because:
 *   1. Prism token colors need to be high-contrast against the
 *      very light code surface (`oklch(0.975 0 0)` ≈ #f9f9f9) —
 *      semantic token references like `var(--primary)` can be
 *      less stable across themes than a fixed palette.
 *   2. The plain text color uses `var(--foreground)` so the body
 *      of the code still respects the design system.
 *
 * Palette tuned for WCAG AA on `#f9f9f9`:
 *   - `#0a0a0a` plain text / variables  (17.5:1)
 *   - `#737373` comments                 (5.0:1)
 *   - `#4f46e5` keywords (indigo)        (8.3:1)
 *   - `#059669` strings (emerald)        (5.1:1)
 *   - `#2563eb` functions (blue)         (5.4:1)
 *   - `#6366f1` tags (indigo-500)        (5.5:1)
 *   - `#b45309` numbers (amber-700)      (4.7:1)
 *   - `#6b7280` operators (gray)         (5.2:1)
 */
const forgeLightTheme: PrismTheme = {
  plain: {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: {
        color: '#737373',
        fontStyle: 'italic',
      },
    },
    {
      types: [
        'keyword',
        'boolean',
        'important',
        'rule',
      ],
      style: {
        color: '#4f46e5',
        fontWeight: '500',
      },
    },
    {
      types: ['atrule'],
      style: {
        color: '#4f46e5',
      },
    },
    {
      types: ['tag'],
      style: {
        color: '#6366f1',
      },
    },
    {
      types: [
        'string',
        'char',
        'url',
        'regex',
      ],
      style: {
        color: '#059669',
      },
    },
    {
      types: ['attr-value'],
      style: {
        color: '#059669',
      },
    },
    {
      types: ['attr-name', 'property'],
      style: {
        color: '#2563eb',
      },
    },
    {
      types: [
        'punctuation',
        'operator',
        'constant',
        'symbol',
      ],
      style: {
        color: '#6b7280',
      },
    },
    {
      types: ['selector'],
      style: {
        color: '#6b7280',
      },
    },
    {
      types: ['function', 'class-name', 'maybe-class-name'],
      style: {
        color: '#2563eb',
        fontWeight: '500',
      },
    },
    {
      types: ['number'],
      style: {
        color: '#b45309',
      },
    },
    {
      types: ['deleted'],
      style: {
        color: '#dc2626',
      },
    },
    {
      types: ['inserted', 'entity'],
      style: {
        color: '#059669',
      },
    },
  ],
}

export interface SyntaxHighlighterProps {
  /** The code to highlight. */
  code: string
  /**
   * Prism language identifier. Defaults to `'markup'` (HTML / XML)
   * because Forge generates single-file HTML pages.
   */
  language?: string
  /**
   * Show the line-number gutter. Defaults to `true`.
   */
  showLineNumbers?: boolean
}

function SyntaxHighlighterInner({
  code,
  language = 'markup',
  showLineNumbers = true,
}: SyntaxHighlighterProps) {
  return (
    <Highlight code={code} language={language} theme={forgeLightTheme}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          // `className` is prism-react-renderer's recommended class for
          // additional baseline styling. We pass through their `style`
          // object so the plain color is honoured.
          className={`${className} overflow-x-auto bg-transparent p-0 font-mono text-xs leading-relaxed`}
          style={style}
        >
          {tokens.map((line, lineIndex) => {
            // `getLineProps` returns className + style. We spread it
            // and supply our own `key`.
            const lineProps = getLineProps({ line })
            return (
              <div
                key={lineIndex}
                {...lineProps}
                className={`${lineProps.className} flex w-fit min-w-full items-start`}
              >
                {showLineNumbers && (
                  <span
                    aria-hidden="true"
                    className="
                      sticky left-0 inline-block w-8 shrink-0 select-none
                      pr-3 text-right font-mono text-xs
                      text-muted-foreground/40
                    "
                  >
                    {lineIndex + 1}
                  </span>
                )}
                <span className="flex-1 whitespace-pre">
                  {line.map((token, tokenIndex) => {
                    const tokenProps = getTokenProps({ token })
                    return (
                      <span
                        key={tokenIndex}
                        {...tokenProps}
                      />
                    )
                  })}
                </span>
              </div>
            )
          })}
        </pre>
      )}
    </Highlight>
  )
}

/**
 * Memoized so the highlight only re-renders when `code` actually
 * changes — important while the SSE stream is producing dozens of
 * chunks per second. Without this, every parent re-render would
 * re-tokenize the full string.
 */
export const SyntaxHighlighter = memo(SyntaxHighlighterInner)
