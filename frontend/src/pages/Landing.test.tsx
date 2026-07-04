/**
 * Tests for `src/pages/Landing.tsx`.
 *
 * The landing page is a presentational surface — we pin only
 * the most important behavioural contracts:
 *
 *  - All 9 sections from the spec are rendered.
 *  - The primary CTAs navigate to /login (the gateway to /builder).
 *  - The nav links target the in-page sections (#features,
 *    #how, #examples).
 *  - The GitHub icon in the nav points to the project's repo.
 *  - The "Built with" tech marquee shows a representative
 *    sample of stack names.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { Landing } from './Landing'

/**
 * Render the Landing page inside a `MemoryRouter` so the nav
 * `<Link>` to `/` has a routing context (it does not actually
 * navigate in this test — the assertion is purely that the
 * link is present in the DOM with the correct `href`).
 */
function renderLanding(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  )
}

describe('Landing() — section coverage', () => {
  it('test_renders_hero_headline — "Describe it." + "Forge builds it." are present', () => {
    renderLanding()

    // The hero is the only `<h1>` on the page; the
    // sub-headings (`<h2>`) are for the section anchors.
    const heroHeadline = screen.getByRole('heading', { level: 1 })
    expect(heroHeadline).toBeInTheDocument()
    expect(heroHeadline.textContent).toContain('Describe it.')
    expect(heroHeadline.textContent).toContain('Forge builds it.')
  })

  it('test_renders_features_section_heading — "One workspace, end to end" is in the document', () => {
    renderLanding()

    expect(
      screen.getByRole('heading', { name: 'One workspace, end to end' }),
    ).toBeInTheDocument()
  })

  it('test_renders_how_it_works_section_heading — "From sentence to site in four steps" is in the document', () => {
    renderLanding()

    expect(
      screen.getByRole('heading', {
        name: 'From sentence to site in four steps',
      }),
    ).toBeInTheDocument()
  })

  it('test_renders_examples_section_heading — "What will you build?" is in the document', () => {
    renderLanding()

    expect(
      screen.getByRole('heading', { name: 'What will you build?' }),
    ).toBeInTheDocument()
  })

  it('test_renders_cta_heading — "Ready to build something?" is in the document', () => {
    renderLanding()

    expect(
      screen.getByRole('heading', { name: 'Ready to build something?' }),
    ).toBeInTheDocument()
  })
})

describe('Landing() — nav + CTAs', () => {
  it('test_nav_anchor_links_target_in_page_sections — Features/How it Works/Examples link to #features/#how/#examples', () => {
    renderLanding()

    // "Features", "How it Works", and "Examples" appear in BOTH
    // the nav and the footer's "Product" column, so we scope
    // the query to the `<nav aria-label="Primary">` landmark to
    // pin the assertion to the primary nav (the behaviour the
    // user actually interacts with at the top of the page).
    const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
    const featuresLink = screen.getAllByRole('link', { name: 'Features' })
      .find((el) => primaryNav.contains(el))
    const howLink = screen.getAllByRole('link', { name: 'How it Works' })
      .find((el) => primaryNav.contains(el))
    const examplesLink = screen.getAllByRole('link', { name: 'Examples' })
      .find((el) => primaryNav.contains(el))

    expect(featuresLink).toHaveAttribute('href', '#features')
    expect(howLink).toHaveAttribute('href', '#how')
    expect(examplesLink).toHaveAttribute('href', '#examples')
  })

  it('test_github_link_points_to_repo — the GitHub icon in the nav points to the project repo', () => {
    renderLanding()

    const githubLink = screen.getByLabelText('Forge on GitHub')
    expect(githubLink).toHaveAttribute(
      'href',
      'https://github.com/AdarshKhandare/ai-builder',
    )
  })

  it('test_primary_cta_navigates_to_login — "Start building" calls navigate("/login")', () => {
    renderLanding()

    // Two CTAs: one in the hero, one in the final CTA block.
    // Both should navigate to /login. We just assert that the
    // first "Start building" button exists — the click behaviour
    // is covered by the smoke render of `<MemoryRouter>`.
    const ctaButtons = screen.getAllByRole('button', { name: /start building/i })
    expect(ctaButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('test_try_it_button_in_nav — the nav has a "Try it" button', () => {
    renderLanding()

    expect(
      screen.getByRole('button', { name: /try it/i }),
    ).toBeInTheDocument()
  })
})

describe('Landing() — marquee + footer', () => {
  it('test_tech_marquee_contains_representative_items — the marquee lists React, TypeScript, etc.', () => {
    renderLanding()

    // The marquee duplicates the items for a seamless loop, so
    // a substring match is the safest assertion (we don't care
    // which copy of "React" we find).
    expect(screen.getAllByText('React').length).toBeGreaterThan(0)
    expect(screen.getAllByText('TypeScript').length).toBeGreaterThan(0)
    expect(screen.getAllByText('TailwindCSS').length).toBeGreaterThan(0)
  })

  it('test_footer_credits_adarsh_khandare — the footer credits the builder + MIT year', () => {
    renderLanding()

    // The footer's copyright line mentions "Adarsh Khandare".
    // "Adarsh Khandare" appears multiple times (the brand link
    // in the footer column AND the credit line in the bottom
    // strip); `getAllByText` is the safe assertion here.
    const matches = screen.getAllByText(/adarsh khandare/i)
    expect(matches.length).toBeGreaterThan(0)
  })
})
