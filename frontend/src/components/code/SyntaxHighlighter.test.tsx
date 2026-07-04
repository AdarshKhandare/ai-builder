/**
 * Tests for `src/components/code/SyntaxHighlighter.tsx`.
 *
 * The component is a thin wrapper around `prism-react-renderer` that
 * renders code with a per-line layout: a left-hand line-number
 * gutter and the highlighted tokens on the right.
 *
 * These are structural tests — we don't assert on the exact token
 * colors (those are part of the visual design and live in the
 * theme), only on the fact that:
 *  - the code text is in the DOM,
 *  - line numbers (1, 2, 3, ...) are rendered for multi-line code,
 *  - the component handles an empty string without throwing.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SyntaxHighlighter } from './SyntaxHighlighter'

describe('SyntaxHighlighter()', () => {
  it('test_renders_code_text — the supplied code text appears in the rendered output', () => {
    const code = '<h1>hello world</h1>'
    const { container } = render(<SyntaxHighlighter code={code} />)

    // Prism splits the code into per-token spans, so the exact
    // string won't appear as a single text node. We assert on the
    // aggregated `textContent` of the wrapper, which is the only
    // structural guarantee the wrapper provides.
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('hello world')
  })

  it('test_renders_line_numbers — line numbers 1, 2, 3 appear for multi-line code', () => {
    const code = '<div>\n  <p>one</p>\n  <p>two</p>\n  <p>three</p>\n</div>'
    render(<SyntaxHighlighter code={code} />)

    // The gutter renders one span per line. Prism splits the input
    // by `\n`, so 5 lines means spans containing "1" through "5".
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByText(String(n))).toBeInTheDocument()
    }
  })

  it('test_renders_empty_state_for_empty_code — empty code does not crash', () => {
    // The component should mount and render an empty <pre> when the
    // code prop is an empty string. We don't assert on a specific
    // structure (prism may or may not split an empty string into
    // a single empty line); we only require that the render does
    // not throw and the container is in the document.
    const { container } = render(<SyntaxHighlighter code="" />)

    expect(container).toBeInTheDocument()
    expect(container.querySelector('pre')).toBeInTheDocument()
  })
})
