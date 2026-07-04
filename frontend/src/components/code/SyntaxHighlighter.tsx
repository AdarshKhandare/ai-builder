/**
 * SyntaxHighlighter — a thin wrapper around `prism-react-renderer` that
 * renders generated code with a custom "Obsidian Forge" theme.
 *
 * Why prism-react-renderer over shiki: the code panel streams updates
 * from the SSE hook (sometimes dozens per second). Prism tokenizes
 * incrementally per chunk and is cheap. Shiki uses WASM and re-runs
 * grammars over the full text on every update — too expensive for
 * a streaming code surface.
 *
 * Token colors follow the Obsidian Forge palette defined in
 * `index.css`:
 *   - keywords / tags (HTML)   → amber (--primary)
 *   - strings / attributes     → green (--success)
 *   - comments                 → muted-foreground
 *   - plain text               → foreground
 *
 * Renders a per-line layout: line-number gutter on the left (right-
 * aligned, dimmed, non-selectable) + code tokens on the right. The
 * outer container handles vertical scroll; the inner pre handles
 * horizontal overflow for long lines.
 */
import { Highlight, type PrismTheme } from 'prism-react-renderer'
import { memo } from 'react'

/** The custom theme — uses oklch values from the Obsidian Forge palette. */
const obsidianForgeTheme: PrismTheme = {
  plain: {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: {
        color: 'var(--muted-foreground)',
        fontStyle: 'italic',
      },
    },
    {
      types: [
        'keyword',
        'tag',
        'boolean',
        'atrule',
        'important',
        'rule',
      ],
      style: {
        color: 'var(--primary)',
      },
    },
    {
      types: [
        'string',
        'attr-value',
        'attr-name',
        'url',
        'entity',
        'inserted',
      ],
      style: {
        color: 'var(--success)',
      },
    },
    {
      types: [
        'punctuation',
        'operator',
        'selector',
        'property',
        'constant',
        'symbol',
        'deleted',
        'regex',
      ],
      style: {
        color: 'var(--muted-foreground)',
      },
    },
    {
      types: ['function', 'class-name', 'maybe-class-name'],
      style: {
        // Slightly cooler than --primary so function names don't
        // compete with keyword colour. Maps to the secondary amber
        // accent in the palette.
        color: 'var(--accent)',
      },
    },
    {
      types: ['number'],
      style: {
        color: 'var(--info)',
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
    <Highlight code={code} language={language} theme={obsidianForgeTheme}>
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
