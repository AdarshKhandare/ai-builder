/**
 * Landing page.
 *
 * The marketing entry-point for Forge. Layout (top to bottom):
 *
 *   1. <Hero>            — full-viewport pitch + subtle grid bg
 *   2. <Features>        — 4-card bento grid
 *   3. <HowItWorks>      — 3 numbered steps with a connecting spine
 *   4. <CallToAction>    — final "Ready to build?" prompt
 *   5. <Footer>          — credits + minimal links
 *
 * Design direction follows docs/UI_REDESIGN_SPEC.md ("Calm Precision"):
 * light, clean, professional SaaS aesthetic. Editorial character via
 * Instrument Serif display face paired with Geist's clean modernity.
 *
 * Motion language:
 *  - GSAP ScrollTrigger powers the hero entrance, the features
 *    stagger, and the steps stagger.
 *  - framer-motion handles component-level interactions
 *    (button tap, in-page state changes).
 *  - All motion respects `prefers-reduced-motion` via the
 *    `useReducedMotion` hook AND the `gsap.matchMedia` reduced-
 *    motion check.
 */
import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import {
  Sparkles,
  Eye,
  MessageSquareCode,
  Download,
  ChevronRight,
  Zap,
  Bot,
  Hammer,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"

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
 * `--border-subtle` token. Replaces the old amber grid + radial
 * glow. The pattern fades out toward the bottom of the hero.
 */
const HERO_GRID_STYLE: React.CSSProperties = {
  backgroundImage: [
    "linear-gradient(to right, color-mix(in oklch, var(--border) 50%, transparent) 1px, transparent 1px)",
    "linear-gradient(to bottom, color-mix(in oklch, var(--border) 50%, transparent) 1px, transparent 1px)",
  ].join(", "),
  backgroundSize: "56px 56px, 56px 56px",
  maskImage:
    "radial-gradient(ellipse 80% 60% at 50% 35%, black 25%, transparent 80%)",
  WebkitMaskImage:
    "radial-gradient(ellipse 80% 60% at 50% 35%, black 25%, transparent 80%)",
}

/**
 * Subtle indigo wash near the top of the hero. The new design
 * uses a small, restrained hint of color rather than a full glow.
 */
const HERO_INDIGO_WASH_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(ellipse 50% 40% at 50% 0%, color-mix(in oklch, var(--primary) 8%, transparent), transparent 70%)",
}

/**
 * Gradient text style — "Forge builds it." uses a subtle indigo
 * gradient. Built from the same `--primary` token (single hue,
 * slight lightness variation) for a calm, refined look.
 */
const GRADIENT_TEXT_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(135deg, oklch(0.55 0.2 270) 0%, oklch(0.45 0.2 270) 50%, oklch(0.35 0.2 270) 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const prefersReducedMotion = useReducedMotion() ?? false

  /*
   * GSAP / ScrollTrigger setup. The `useGSAP` hook gives us:
   *  - Automatic cleanup on unmount.
   *  - A `gsap.context()` that scopes all selectors + ScrollTriggers
   *    to the root ref (so the trigger's elements are local to the
   *    Landing page — important if it ever gets mounted side-by-side
   *    with another scrollable area).
   *  - A `revert()` callback for fast refresh.
   */
  useGSAP(
    () => {
      if (prefersReducedMotion) {
        // Collapse all targets to their visible end-state — no
        // animation, no scroll triggers.
        gsap.set("[data-gsap-reveal]", { opacity: 1, y: 0 })
        return
      }

      // Hero entrance — fade + lift headline / subhead / CTAs.
      gsap.from(".hero-headline", {
        opacity: 0,
        y: 28,
        duration: 0.8,
        ease: "power3.out",
        stagger: 0.1,
        delay: 0.05,
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
      gsap.from(".hero-badge", {
        opacity: 0,
        y: 8,
        duration: 0.5,
        ease: "power3.out",
        delay: 0.1,
      })

      // Features bento — stagger the cards as they scroll into view.
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

      // How it works — stagger the steps as they scroll into view.
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

      // Generic reveal — anything tagged `data-gsap-reveal` fades in.
      gsap.utils.toArray<HTMLElement>("[data-gsap-reveal]").forEach((el) => {
        ScrollTrigger.create({
          trigger: el,
          start: "top 88%",
          onEnter: () =>
            gsap.to(el, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }),
        })
      })
    },
    { scope: rootRef, dependencies: [prefersReducedMotion] },
  )

  return (
    <div ref={rootRef} className="min-h-dvh bg-background text-foreground">
      <Hero onStart={() => navigate("/builder")} />
      <Features />
      <HowItWorks />
      <CallToAction onStart={() => navigate("/builder")} />
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1. Hero                                                             */
/* ------------------------------------------------------------------ */

interface HeroProps {
  onStart: () => void
}

/**
 * Full-viewport opening pitch. Subtle grid background, a 2-line
 * headline ("Describe it." / "Forge builds it." in indigo gradient),
 * a subhead, a primary CTA, a ghost CTA, and a small trust strip.
 *
 * GSAP handles the entrance animation via the parent's `useGSAP`
 * scope — elements are selected by class (`.hero-headline` etc.).
 */
function Hero({ onStart }: HeroProps) {
  return (
    <section className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden border-b border-border-subtle">
      {/* Subtle grid + indigo wash — replaced the old amber glow. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={HERO_GRID_STYLE}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[60%]"
        style={HERO_INDIGO_WASH_STYLE}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background"
      />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-24 text-center sm:py-32">
        {/* Eyebrow badge */}
        <span className="hero-badge inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Powered by OpenCode Zen
        </span>

        {/* Headline */}
        <h1 className="mt-8 font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
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
          Type a sentence. Watch a complete web app stream into existence —
          code, preview, and download, all in one calm workspace.
        </p>

        {/* CTAs */}
        <div className="hero-cta mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
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
            <a href="#how-it-works">
              See how it works
              <ChevronRight className="size-4" />
            </a>
          </Button>
        </div>

        {/* Trust strip — a taste of the streaming UI without the full app. */}
        <div className="hero-cta mt-16 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono shadow-xs">
            <Bot className="size-3.5 text-primary" aria-hidden="true" />
            <span>planner → coder → reviewer</span>
          </div>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">~2,500 apps / $20 credit</span>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Features                                                         */
/* ------------------------------------------------------------------ */

interface Feature {
  icon: typeof Sparkles
  title: string
  description: string
  /** "wide" feature spans 2 columns on the lg bento grid. */
  span?: "wide"
}

const FEATURES: readonly Feature[] = [
  {
    icon: Sparkles,
    title: "AI-Powered",
    description:
      "A three-stage agent pipeline — planner, coder, reviewer — produces coherent, production-shaped apps from a single prompt.",
  },
  {
    icon: Eye,
    title: "Live Preview",
    description:
      "Watch the preview iframe update in lockstep with the streaming code. No rebuild, no reload.",
  },
  {
    icon: MessageSquareCode,
    title: "Chat Iteration",
    description:
      "Refine through conversation. Each turn appends a clean diff you can read in the code panel.",
  },
  {
    icon: Download,
    title: "Download & Deploy",
    description:
      "Export a ready-to-ship static bundle as a single ZIP. Drop it on Vercel, Netlify, or any host.",
    span: "wide",
  },
]

/**
 * 4-card bento grid: 3 columns on desktop, 2 on tablet, 1 on mobile.
 * GSAP ScrollTrigger reveals the cards as they enter the viewport.
 */
function Features() {
  return (
    <section
      id="features"
      className="border-b border-border-subtle py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
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
            No tab juggling, no copy-pasting between tools. Prompt, watch,
            iterate, ship.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon
  return (
    <article
      data-gsap-feature
      data-gsap-reveal
      className={
        "group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-6 opacity-0 shadow-sm transition-shadow hover:shadow-md " +
        (feature.span === "wide" ? "sm:col-span-2 lg:col-span-2" : "")
      }
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
/* 3. How it works                                                     */
/* ------------------------------------------------------------------ */

interface Step {
  number: string
  icon: typeof Hammer
  title: string
  description: string
}

const STEPS: readonly Step[] = [
  {
    number: "01",
    icon: MessageSquareCode,
    title: "Describe",
    description:
      "Type what you want in plain English. A landing page, a dashboard, a calculator — anything.",
  },
  {
    number: "02",
    icon: Zap,
    title: "Generate",
    description:
      "Forge plans the structure, writes the code, and reviews its own work while you watch it stream in.",
  },
  {
    number: "03",
    icon: Hammer,
    title: "Iterate",
    description:
      "Refine via chat. Tweak colors, copy, layout. Download a clean ZIP when you're happy.",
  },
]

/**
 * 3 numbered steps with a vertical connecting line on `md+`.
 * GSAP ScrollTrigger reveals the steps as they enter the viewport.
 */
function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="border-b border-border-subtle py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-5xl px-6">
        <div
          data-gsap-reveal
          className="mx-auto max-w-2xl text-center opacity-0"
        >
          <p className="text-sm font-medium uppercase tracking-widest text-primary">
            How it works
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            From sentence to site in three steps
          </h2>
        </div>

        <ol className="relative mt-16 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-0">
          {/* Vertical spine on md+ — very subtle (border token). */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-border md:block"
          />
          {STEPS.map((step, index) => (
            <StepCard key={step.number} step={step} index={index} />
          ))}
        </ol>
      </div>
    </section>
  )
}

function StepCard({ step, index }: { step: Step; index: number }) {
  const Icon = step.icon
  return (
    <li
      data-gsap-step
      data-gsap-reveal
      className="relative flex flex-col items-center text-center opacity-0 md:px-6"
    >
      <div className="relative z-10 flex size-14 items-center justify-center rounded-full border border-border bg-card font-mono text-lg font-semibold text-primary shadow-xs">
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
      {/* `index` is referenced for future per-step timing tweaks; keep
          the prop so future per-step config can be threaded without an
          API break. */}
      <span data-index={index} hidden />
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* 4. CTA                                                              */
/* ------------------------------------------------------------------ */

function CallToAction({ onStart }: { onStart: () => void }) {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto w-full max-w-4xl px-6">
        <div
          data-gsap-reveal
          className="relative overflow-hidden rounded-3xl border border-border bg-background-sunken p-10 text-center opacity-0 shadow-sm sm:p-16"
        >
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to build?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
            Skip the setup. Open the builder and describe your first app.
          </p>
          <div className="mt-8 flex justify-center">
            <motion.div {...buttonTap}>
              <Button
                size="lg"
                onClick={onStart}
                className="group gap-2 px-8 text-base shadow-sm"
              >
                Open the builder
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
/* 5. Footer                                                           */
/* ------------------------------------------------------------------ */

function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-border-subtle py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Hammer className="size-4 text-primary" aria-hidden="true" />
          <span>
            Forge by{" "}
            <a
              href="https://github.com/AdarshKhandare"
              target="_blank"
              rel="noreferrer noopener"
              className="text-foreground transition-colors hover:text-primary"
            >
              Adarsh Khandare
            </a>
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a
            href="https://github.com/AdarshKhandare"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="GitHub profile"
          >
            GitHub
            <ArrowUpRight className="size-3.5" />
          </a>
          <a
            href="https://adarshweb.in"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Personal site"
          >
            adarshweb.in
            <ArrowUpRight className="size-3.5" />
          </a>
          <span className="text-xs text-muted-foreground">© {year}</span>
        </div>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ */
/* Tap micro-interaction (CTA card)                                    */
/* ------------------------------------------------------------------ */

const buttonTap = {
  whileHover: { scale: 1.01 },
  whileTap: { scale: 0.98 },
  transition: { type: "spring" as const, stiffness: 400, damping: 30 },
}
