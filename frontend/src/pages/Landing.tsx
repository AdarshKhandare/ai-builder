/**
 * Landing page.
 *
 * The marketing entry-point for Forge. Layout (top to bottom,
 * 9 sections per `docs/UI_DARK_THEME_SPEC.md` §8):
 *
 *   1. <NavBar>            — sticky top nav with logo + links + CTA.
 *   2. <Hero>              — full-viewport pitch with headline, sub,
 *                            CTAs, and a floating builder mockup.
 *   3. <TechMarquee>       — infinite horizontal scroll of tech logos.
 *   4. <Features>          — 6-card bento grid.
 *   5. <HowItWorks>        — 4 numbered steps with a connecting line.
 *   6. <ExampleGallery>    — 4 example-app cards with mock screenshots.
 *   7. <Testimonial>       — single large quote, centered.
 *   8. <CallToAction>      — final "Ready to build something?" prompt.
 *   9. <Footer>            — 3-column links + copyright.
 *
 * Design direction follows `docs/UI_DARK_THEME_SPEC.md`:
 * "Refined Dark" — warm charcoal, refined blue accent, Instrument
 * Serif for display + Geist for body, elevation via borders.
 *
 * Motion language:
 *  - GSAP ScrollTrigger powers the hero entrance, the marquee
 *    setup, the features stagger, the steps stagger, the examples
 *    stagger, and the CTA reveal.
 *  - framer-motion handles component-level interactions
 *    (button tap, nav blur on scroll).
 *  - All motion respects `prefers-reduced-motion` via the
 *    `useReducedMotion` hook AND the `gsap.context` early-return
 *    in the `useGSAP` body.
 */
import { useRef, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import {
  Sparkles,
  Eye,
  MessageSquare,
  Cpu,
  Download,
  Hammer,
  Zap,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Sparkle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { buttonTap } from "@/lib/motion"

/* ------------------------------------------------------------------ */
/* GSAP plugin registration (once per module)                          */
/* ------------------------------------------------------------------ */

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP)
}

/* ------------------------------------------------------------------ */
/* Inline visual styles                                                */
/* ------------------------------------------------------------------ */

/**
 * Hero grid background — very faint, subtle pattern using the
 * `--border-subtle` token. Fades out toward the bottom of the
 * hero via a radial mask.
 */
const HERO_GRID_STYLE: React.CSSProperties = {
  backgroundImage: [
    "linear-gradient(to right, color-mix(in oklch, var(--border-subtle) 80%, transparent) 1px, transparent 1px)",
    "linear-gradient(to bottom, color-mix(in oklch, var(--border-subtle) 80%, transparent) 1px, transparent 1px)",
  ].join(", "),
  backgroundSize: "56px 56px, 56px 56px",
  maskImage:
    "radial-gradient(ellipse 80% 60% at 50% 35%, black 25%, transparent 80%)",
  WebkitMaskImage:
    "radial-gradient(ellipse 80% 60% at 50% 35%, black 25%, transparent 80%)",
}

/**
 * Subtle primary wash near the top of the hero. Uses the
 * `--primary` token so it adapts to the refined blue accent.
 */
const HERO_WASH_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(ellipse 50% 40% at 50% 0%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 70%)",
}

/**
 * Gradient text style — "Forge builds it." uses a subtle blue
 * gradient built from the `--primary` token with lightness
 * variations via color-mix. Adapts automatically to any primary
 * color change.
 */
const GRADIENT_TEXT_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(135deg, var(--primary) 0%, color-mix(in oklch, var(--primary) 80%, black) 50%, color-mix(in oklch, var(--primary) 60%, black) 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const NAV_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Features", href: "#features" },
  { label: "How it Works", href: "#how" },
  { label: "Examples", href: "#examples" },
]

const TECH_MARQUEE_ITEMS: ReadonlyArray<string> = [
  "React",
  "TypeScript",
  "TailwindCSS",
  "FastAPI",
  "Python",
  "shadcn/ui",
  "framer-motion",
  "GSAP",
  "SQLite",
  "Vercel",
  "OpenCode",
  "Docker",
]

interface Feature {
  icon: typeof Sparkles
  title: string
  description: string
}

const FEATURES: ReadonlyArray<Feature> = [
  {
    icon: Sparkles,
    title: "AI-Powered Generation",
    description:
      "Describe what you want. A multi-agent pipeline plans, codes, and streams your app in real-time.",
  },
  {
    icon: Zap,
    title: "Live Streaming Code",
    description:
      "Watch your app being written token-by-token. No waiting for a spinner — see progress instantly.",
  },
  {
    icon: Eye,
    title: "Instant Preview",
    description:
      "A sandboxed iframe renders your app the moment code completes. Test interactions immediately.",
  },
  {
    icon: MessageSquare,
    title: "Chat Iteration",
    description:
      "Refine with natural language. “Make the hero blue” → it's blue. Full conversation context.",
  },
  {
    icon: Cpu,
    title: "Multi-Model",
    description:
      "Choose between 8 open models — from ultra-cheap DeepSeek Flash to powerful Kimi K2.6. Cost-aware routing.",
  },
  {
    icon: Download,
    title: "Export & Deploy",
    description:
      "Download as a ZIP with index.html + README. Deploy anywhere. Your code, your ownership.",
  },
]

interface Step {
  number: string
  icon: typeof Hammer
  title: string
  description: string
}

const STEPS: ReadonlyArray<Step> = [
  {
    number: "01",
    icon: MessageSquare,
    title: "Describe",
    description:
      "Type what you want to build in plain English. A landing page, a dashboard, anything.",
  },
  {
    number: "02",
    icon: Bot,
    title: "Plan",
    description:
      "The planner agent analyzes your prompt and creates a structured plan.",
  },
  {
    number: "03",
    icon: Zap,
    title: "Generate",
    description:
      "The coder agent writes complete HTML/CSS/JS, streamed live to your screen.",
  },
  {
    number: "04",
    icon: Hammer,
    title: "Iterate",
    description:
      "Refine with chat. Download as ZIP. Ship it.",
  },
]

interface Example {
  title: string
  description: string
  model: string
  /** A short label rendered inside the gradient placeholder. */
  previewLabel: string
  /** A two-stop CSS gradient for the placeholder. */
  gradient: string
}

const EXAMPLES: ReadonlyArray<Example> = [
  {
    title: "Coffee Shop Landing",
    description:
      "A warm, inviting landing page for a specialty coffee shop.",
    model: "MiniMax M3",
    previewLabel: "coffee shop",
    gradient:
      "linear-gradient(135deg, color-mix(in oklch, var(--primary) 35%, transparent), color-mix(in oklch, var(--primary) 12%, transparent))",
  },
  {
    title: "Todo List App",
    description: "A minimalist task tracker with local-storage persistence.",
    model: "DeepSeek V4 Flash",
    previewLabel: "todo app",
    gradient:
      "linear-gradient(135deg, color-mix(in oklch, var(--chart-2) 35%, transparent), color-mix(in oklch, var(--chart-2) 12%, transparent))",
  },
  {
    title: "Portfolio Site",
    description: "A clean, editorial portfolio for a designer or photographer.",
    model: "Qwen3.7 Plus",
    previewLabel: "portfolio",
    gradient:
      "linear-gradient(135deg, color-mix(in oklch, var(--chart-5) 35%, transparent), color-mix(in oklch, var(--chart-5) 12%, transparent))",
  },
  {
    title: "Pricing Page",
    description: "A three-tier pricing page with FAQ and a CTA strip.",
    model: "Kimi K2.6",
    previewLabel: "pricing",
    gradient:
      "linear-gradient(135deg, color-mix(in oklch, var(--chart-4) 35%, transparent), color-mix(in oklch, var(--chart-4) 12%, transparent))",
  },
]

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing(): ReactNode {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const prefersReducedMotion = useReducedMotion() ?? false

  /*
   * GSAP / ScrollTrigger setup. See `useGSAP` for cleanup /
   * scoping semantics.
   */
  useGSAP(
    () => {
      if (prefersReducedMotion) {
        // Collapse all targets to their visible end-state — no
        // animation, no scroll triggers. The CSS reduced-motion
        // media query in `animations.css` ALSO collapses the
        // marquee + glow effects; this is the JS counterpart.
        gsap.set("[data-gsap-reveal]", { opacity: 1, y: 0 })
        return
      }

      // ── Hero entrance ───────────────────────────────────
      // Stagger: badge → headline → subhead → CTAs → mockup.
      gsap.from(".hero-badge", {
        opacity: 0,
        y: 8,
        duration: 0.5,
        ease: "power3.out",
        delay: 0.05,
      })
      gsap.from(".hero-headline", {
        opacity: 0,
        y: 28,
        duration: 0.8,
        ease: "power3.out",
        stagger: 0.1,
        delay: 0.1,
      })
      gsap.from(".hero-sub", {
        opacity: 0,
        y: 18,
        duration: 0.7,
        ease: "power3.out",
        delay: 0.35,
      })
      gsap.from(".hero-cta", {
        opacity: 0,
        y: 12,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.08,
        delay: 0.5,
      })
      gsap.from(".hero-mockup", {
        opacity: 0,
        y: 32,
        duration: 0.9,
        ease: "power3.out",
        delay: 0.7,
      })

      // Gentle float on the mockup. Loops forever; gsap will
      // auto-rewind. The `prefersReducedMotion` early-return
      // above prevents this from running in the reduced case.
      gsap.to(".hero-mockup", {
        y: -8,
        duration: 3.2,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: 1.6,
      })

      // ── Features stagger on scroll ──────────────────────
      ScrollTrigger.batch("[data-gsap-feature]", {
        start: "top 85%",
        onEnter: (els) =>
          gsap.to(els, {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: "power3.out",
            stagger: 0.08,
          }),
      })

      // ── Steps stagger on scroll ─────────────────────────
      ScrollTrigger.batch("[data-gsap-step]", {
        start: "top 85%",
        onEnter: (els) =>
          gsap.to(els, {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: "power3.out",
            stagger: 0.1,
          }),
      })

      // ── Examples stagger on scroll ──────────────────────
      ScrollTrigger.batch("[data-gsap-example]", {
        start: "top 85%",
        onEnter: (els) =>
          gsap.to(els, {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: "power3.out",
            stagger: 0.08,
          }),
      })

      // ── Generic reveal ──────────────────────────────────
      // Anything tagged `data-gsap-reveal` (other than the
      // section-specific selectors above) fades in when
      // it scrolls into view. Used for the testimonial +
      // CTA block, etc.
      gsap.utils.toArray<HTMLElement>("[data-gsap-reveal]").forEach((el) => {
        if (el.hasAttribute("data-gsap-feature")) return
        if (el.hasAttribute("data-gsap-step")) return
        if (el.hasAttribute("data-gsap-example")) return
        ScrollTrigger.create({
          trigger: el,
          start: "top 88%",
          onEnter: () =>
            gsap.to(el, {
              opacity: 1,
              y: 0,
              duration: 0.6,
              ease: "power3.out",
            }),
        })
      })
    },
    { scope: rootRef, dependencies: [prefersReducedMotion] },
  )

  const onStart = (): void => {
    navigate("/login")
  }

  return (
    <div ref={rootRef} className="min-h-dvh bg-background text-foreground">
      <NavBar onStart={onStart} />
      <Hero onStart={onStart} />
      <TechMarquee />
      <Features />
      <HowItWorks />
      <ExampleGallery />
      <Testimonial />
      <CallToAction onStart={onStart} />
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1. NavBar                                                           */
/* ------------------------------------------------------------------ */

interface NavBarProps {
  onStart: () => void
}

/**
 * Sticky top nav. Dark `bg-card/80` with backdrop blur so the
 * marketing content underneath is visible (subtly) while
 * scrolling. The blur is purely decorative — the bar stays
 * legible at all viewport widths.
 */
function NavBar({ onStart }: NavBarProps): ReactNode {
  return (
    <header
      className="
        sticky top-0 z-sticky
        border-b border-border-subtle
        bg-card/80 backdrop-blur-md
      "
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left — logo */}
        <Link
          to="/"
          aria-label="Forge — back to landing page"
          className="
            group flex shrink-0 items-center gap-2
            rounded-md outline-none
            focus-visible:ring-2 focus-visible:ring-ring
            focus-visible:ring-offset-2 focus-visible:ring-offset-card
          "
        >
          <span
            aria-hidden="true"
            className="
              flex size-7 items-center justify-center
              rounded-md bg-accent text-accent-foreground
              transition-colors group-hover:bg-primary/15
            "
          >
            <Hammer className="size-4 text-primary" />
          </span>
          <span className="font-body text-base font-semibold tracking-tight text-foreground transition-opacity group-hover:opacity-80">
            Forge
          </span>
        </Link>

        {/* Center — nav links (hidden on mobile) */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="
                rounded-md px-3 py-1.5
                text-sm text-muted-foreground
                transition-colors
                hover:bg-accent/60 hover:text-foreground
                focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-ring focus-visible:ring-offset-2
                focus-visible:ring-offset-card
              "
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right — GitHub + Try it CTA */}
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/AdarshKhandare/ai-builder"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Forge on GitHub"
            className="
              inline-flex size-9 items-center justify-center
              rounded-md text-muted-foreground
              transition-colors
              hover:bg-accent/60 hover:text-foreground
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-ring focus-visible:ring-offset-2
              focus-visible:ring-offset-card
            "
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="size-4"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
              />
            </svg>
          </a>
          <Button
            size="sm"
            onClick={onStart}
            className="gap-1.5 shadow-sm"
          >
            Try it
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Hero                                                             */
/* ------------------------------------------------------------------ */

interface HeroProps {
  onStart: () => void
}

/**
 * Full-viewport opening pitch. Subtle grid background, a 2-line
 * headline ("Describe it." / "Forge builds it." in primary
 * gradient), a subhead, two CTAs, and a small trust strip.
 *
 * A small mock builder panel sits below the CTAs to make the
 * product tangible. It's a static visual (a fake chat + code
 * + preview trio) — no real interactivity — gently floating
 * via GSAP.
 */
function Hero({ onStart }: HeroProps): ReactNode {
  return (
    <section
      id="hero"
      className="relative isolate flex items-center justify-center overflow-hidden border-b border-border-subtle"
    >
      {/* Background layers */}
      <div aria-hidden className="absolute inset-0 -z-10" style={HERO_GRID_STYLE} />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[60%]"
        style={HERO_WASH_STYLE}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background"
      />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-20 text-center sm:px-6 sm:py-28 lg:py-36">
        {/* Eyebrow badge */}
        <span className="hero-badge inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Powered by OpenCode Zen
        </span>

        {/* Headline */}
        <h1 className="mt-7 font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          <span className="hero-headline block text-foreground">Describe it.</span>
          <span
            className="hero-headline block"
            style={GRADIENT_TEXT_STYLE}
          >
            Forge builds it.
          </span>
        </h1>

        {/* Subheadline */}
        <p className="hero-sub mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          An AI web builder that turns natural language into working
          web apps. Streamed in real-time, previewed instantly,
          downloadable as code.
        </p>

        {/* CTAs */}
        <div className="hero-cta mt-9 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Button
            size="lg"
            onClick={onStart}
            className="group min-w-44 gap-2 px-6 text-base shadow-sm"
          >
            Start building
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="min-w-44 gap-2 text-base text-muted-foreground hover:text-foreground"
            asChild
          >
            <a href="#examples">
              See examples
              <ChevronRight className="size-4" />
            </a>
          </Button>
        </div>

        {/* Trust strip */}
        <div className="hero-cta mt-12 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground sm:mt-16">
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono shadow-xs">
            <Bot className="size-3.5 text-primary" aria-hidden="true" />
            <span>planner → coder → reviewer</span>
          </div>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">~2,500 apps / $20 credit</span>
        </div>

        {/* Builder mockup — purely visual */}
        <div className="hero-mockup mt-14 w-full max-w-3xl sm:mt-20">
          <BuilderMockup />
        </div>
      </div>
    </section>
  )
}

/**
 * A static visual of the 3-panel builder. A horizontal split
 * showing a fake "chat" prompt, a "code" snippet with a blue
 * dot, and a "preview" rectangle. Renders only inside the
 * Hero — no real interactivity.
 */
function BuilderMockup(): ReactNode {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="
        relative overflow-hidden rounded-2xl
        border border-border bg-card
        shadow-md
      "
    >
      {/* Top chrome bar */}
      <div className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-2">
        <span className="size-2.5 rounded-full bg-muted-foreground/40" />
        <span className="size-2.5 rounded-full bg-muted-foreground/40" />
        <span className="size-2.5 rounded-full bg-muted-foreground/40" />
        <span className="ml-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          forge · new project
        </span>
      </div>

      {/* Three-pane mockup */}
      <div className="grid grid-cols-3 divide-x divide-border-subtle">
        {/* Chat */}
        <div className="space-y-2 p-3">
          <div className="rounded-md bg-primary/10 p-2 text-[10px] text-foreground">
            A warm, cozy coffee shop landing page
          </div>
          <div className="rounded-md bg-muted p-2 text-[10px] text-muted-foreground">
            Planning structure…
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            Generating
          </div>
        </div>

        {/* Code */}
        <div className="bg-background-sunken p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          <div>
            <span className="text-primary">&lt;h1</span>{" "}
            <span className="text-chart-2">class</span>=
            <span className="text-chart-4">"hero"</span>
            <span className="text-primary">&gt;</span>
          </div>
          <div className="pl-3">Slow brewed, fast served.</div>
          <div>
            <span className="text-primary">&lt;/h1&gt;</span>
            <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
          </div>
        </div>

        {/* Preview */}
        <div
          className="p-3"
          style={{
            backgroundImage:
              "linear-gradient(135deg, color-mix(in oklch, var(--primary) 12%, transparent), color-mix(in oklch, var(--primary) 4%, transparent))",
          }}
        >
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkle
              className="size-4 text-primary"
              aria-hidden="true"
            />
            <span className="font-display text-sm font-semibold text-foreground">
              Live preview
            </span>
            <span className="text-[10px] text-muted-foreground">
              streams as code writes
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 3. TechMarquee                                                       */
/* ------------------------------------------------------------------ */

/**
 * Infinite horizontal scroll of tech names. Pure CSS keyframe —
 * no GSAP, no JS — so it stays smooth on low-end devices. The
 * items are duplicated in the DOM so the loop is seamless.
 *
 * `pause-on-hover` is achieved by setting `animation-play-state`
 * to `paused` on the container `:hover`.
 */
function TechMarquee(): ReactNode {
  // Duplicate the list once so the keyframe can loop seamlessly
  // by translating -50% (one full set).
  const items = [...TECH_MARQUEE_ITEMS, ...TECH_MARQUEE_ITEMS]

  return (
    <section
      aria-label="Tech stack"
      className="border-b border-border-subtle py-12"
    >
      <p className="mb-6 text-center text-xs uppercase tracking-widest text-muted-foreground">
        Built with
      </p>
      <div
        className="
          group relative w-full overflow-hidden
          [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]
        "
      >
        <div
          className="
            flex w-max shrink-0 items-center gap-12
            animate-[marquee_30s_linear_infinite]
            group-hover:[animation-play-state:paused]
            motion-reduce:animate-none
          "
        >
          {items.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="
                shrink-0 font-display text-xl font-medium
                text-muted-foreground/60 transition-colors
                hover:text-foreground/80
              "
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* Local keyframe — scoped to this component. Tailwind's
       * `animate-[name]` arbitrary syntax compiles the keyframe
       * name verbatim, so we ship the keyframe via a `<style>`
       * tag to keep it local. */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Features                                                         */
/* ------------------------------------------------------------------ */

/**
 * 6-card bento grid: 3 columns on desktop, 2 on tablet, 1 on
 * mobile. GSAP ScrollTrigger reveals the cards as they enter
 * the viewport.
 */
function Features(): ReactNode {
  return (
    <section
      id="features"
      className="border-b border-border-subtle py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div
          data-gsap-reveal
          className="mx-auto max-w-2xl text-center opacity-0"
        >
          <p className="text-sm font-medium uppercase tracking-widest text-primary">
            What you get
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            One workspace, end to end
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Prompt, watch, iterate, ship. No tab juggling.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({ feature }: { feature: Feature }): ReactNode {
  const Icon = feature.icon
  return (
    <article
      data-gsap-feature
      data-gsap-reveal
      className="
        group relative flex flex-col gap-4 overflow-hidden
        rounded-2xl border border-border bg-card p-6
        opacity-0 shadow-sm
        transition-all duration-200
        hover:-translate-y-0.5 hover:border-primary/40
        hover:shadow-glow
      "
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
        {feature.title}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {feature.description}
      </p>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* 5. HowItWorks                                                       */
/* ------------------------------------------------------------------ */

/**
 * 4 numbered steps. On `md+` they're laid out horizontally
 * with a vertical connecting line behind the step circles.
 * On mobile they stack vertically with the same circle
 * treatment. GSAP ScrollTrigger reveals them in sequence.
 */
function HowItWorks(): ReactNode {
  return (
    <section
      id="how"
      className="border-b border-border-subtle py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div
          data-gsap-reveal
          className="mx-auto max-w-2xl text-center opacity-0"
        >
          <p className="text-sm font-medium uppercase tracking-widest text-primary">
            How it works
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            From sentence to site in four steps
          </h2>
        </div>

        <ol className="relative mt-16 grid grid-cols-1 gap-10 md:grid-cols-4 md:gap-6">
          {/* Vertical spine on md+ — sits behind the step circles. */}
          <div
            aria-hidden
            className="
              pointer-events-none absolute left-0 right-0 top-7
              hidden h-px bg-border md:block
            "
          />
          {STEPS.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </ol>
      </div>
    </section>
  )
}

function StepCard({ step }: { step: Step }): ReactNode {
  const Icon = step.icon
  return (
    <li
      data-gsap-step
      data-gsap-reveal
      className="relative flex flex-col items-center text-center opacity-0"
    >
      <div
        className="
          relative z-10 flex size-14 items-center justify-center
          rounded-full border border-border bg-card text-primary
          shadow-xs
        "
      >
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="mt-4 font-mono text-xs font-medium tracking-widest text-muted-foreground">
        STEP {step.number}
      </div>
      <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-foreground">
        {step.title}
      </h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
        {step.description}
      </p>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* 6. ExampleGallery                                                   */
/* ------------------------------------------------------------------ */

/**
 * 4 example-app cards. Each card has a stylized gradient
 * "screenshot" placeholder (since we have no real screenshots
 * yet) + a title + a short description + a "Built with [model]"
 * caption. Hover lifts the card and shows a "View" overlay
 * (decorative — clicking the card doesn't actually navigate,
 * but the affordance is rendered so the design feels real).
 */
function ExampleGallery(): ReactNode {
  return (
    <section
      id="examples"
      className="border-b border-border-subtle py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div
          data-gsap-reveal
          className="mx-auto max-w-2xl text-center opacity-0"
        >
          <p className="text-sm font-medium uppercase tracking-widest text-primary">
            Examples
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What will you build?
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            A taste of the apps Forge generates from a single prompt.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EXAMPLES.map((example) => (
            <ExampleCard key={example.title} example={example} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ExampleCard({ example }: { example: Example }): ReactNode {
  return (
    <article
      data-gsap-example
      data-gsap-reveal
      className="
        group relative flex flex-col overflow-hidden
        rounded-2xl border border-border bg-card
        opacity-0 shadow-sm
        transition-all duration-200
        hover:-translate-y-0.5 hover:border-primary/40
        hover:shadow-glow
      "
    >
      {/* Screenshot placeholder — gradient + label */}
      <div
        className="relative aspect-[4/3] w-full overflow-hidden"
        style={{ backgroundImage: example.gradient }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-lg font-medium text-foreground/70">
            {example.previewLabel}
          </span>
        </div>
        {/* Hover overlay */}
        <div
          aria-hidden
          className="
            absolute inset-0 flex items-center justify-center
            bg-background/50 opacity-0 backdrop-blur-[1px]
            transition-opacity
            group-hover:opacity-100
          "
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
            View
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </span>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-base font-semibold tracking-tight text-foreground">
          {example.title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {example.description}
        </p>
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] text-muted-foreground">
          <CheckCircle2 className="size-3 text-primary" aria-hidden="true" />
          Built with {example.model}
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* 7. Testimonial                                                      */
/* ------------------------------------------------------------------ */

/**
 * Single large quote. Centered, with attribution. The text
 * uses Instrument Serif (via the `font-display` mapping) to
 * echo the hero headline and reinforce the editorial voice.
 */
function Testimonial(): ReactNode {
  return (
    <section
      aria-label="Builder quote"
      className="border-b border-border-subtle py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <figure
          data-gsap-reveal
          className="text-center opacity-0"
        >
          <blockquote className="font-display text-2xl leading-snug text-foreground sm:text-3xl">
            <p>
              <span className="text-muted-foreground">“</span>
              Forge demonstrates what's possible with cheap open AI
              models — a full web builder that costs less than a
              cent per app.
              <span className="text-muted-foreground">”</span>
            </p>
          </blockquote>
          <figcaption className="mt-6 text-sm text-muted-foreground">
            — Adarsh Khandare, Builder of Forge
          </figcaption>
        </figure>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 8. CallToAction                                                     */
/* ------------------------------------------------------------------ */

function CallToAction({ onStart }: { onStart: () => void }): ReactNode {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
        <div
          data-gsap-reveal
          className="
            relative overflow-hidden rounded-3xl
            border border-border bg-background-sunken
            p-10 text-center opacity-0
            shadow-sm sm:p-16
          "
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 80% at 50% 0%, color-mix(in oklch, var(--primary) 8%, transparent), transparent 60%)",
          }}
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to build something?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
            No signup required for the demo. Start describing and
            watch Forge build it.
          </p>
          <div className="mt-8 flex justify-center">
            <motion.div {...buttonTap}>
              <Button
                size="lg"
                onClick={onStart}
                className="group gap-2 px-8 text-base shadow-sm"
              >
                Start building
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 9. Footer                                                           */
/* ------------------------------------------------------------------ */

function Footer(): ReactNode {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-border-subtle py-10">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 sm:px-6 md:grid-cols-4">
        {/* Brand */}
        <div className="col-span-1 md:col-span-1">
          <Link
            to="/"
            aria-label="Forge — back to landing page"
            className="
              group inline-flex items-center gap-2
              rounded-md outline-none
              focus-visible:ring-2 focus-visible:ring-ring
              focus-visible:ring-offset-2 focus-visible:ring-offset-background
            "
          >
            <span
              aria-hidden="true"
              className="
                flex size-7 items-center justify-center
                rounded-md bg-accent text-accent-foreground
                transition-colors group-hover:bg-primary/15
              "
            >
              <Hammer className="size-4 text-primary" />
            </span>
            <span className="font-body text-sm font-semibold text-foreground transition-opacity group-hover:opacity-80">
              Forge
            </span>
          </Link>
          <p className="mt-3 text-xs text-muted-foreground">
            Describe it. Forge builds it.
          </p>
        </div>

        {/* Product */}
        <nav aria-label="Product">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Product
          </h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href="#features"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Features
              </a>
            </li>
            <li>
              <a
                href="#examples"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Examples
              </a>
            </li>
            <li>
              <a
                href="#how"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                How it Works
              </a>
            </li>
          </ul>
        </nav>

        {/* Resources */}
        <nav aria-label="Resources">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Resources
          </h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href="https://github.com/AdarshKhandare/ai-builder"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                GitHub
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            </li>
            <li>
              <a
                href="https://github.com/AdarshKhandare/ai-builder#readme"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                Docs
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            </li>
          </ul>
        </nav>

        {/* Connect */}
        <nav aria-label="Connect">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Connect
          </h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href="https://adarshweb.in"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                adarshweb.in
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            </li>
            <li>
              <a
                href="https://github.com/AdarshKhandare"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                GitHub
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="mx-auto mt-10 w-full max-w-6xl border-t border-border-subtle px-4 pt-6 sm:px-6">
        <p className="text-center text-xs text-muted-foreground">
          Built by{" "}
          <a
            href="https://github.com/AdarshKhandare"
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground transition-colors hover:text-primary"
          >
            Adarsh Khandare
          </a>{" "}
          · {year} · MIT License
        </p>
      </div>
    </footer>
  )
}
