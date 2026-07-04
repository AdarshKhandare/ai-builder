/**
 * Landing page.
 *
 * The marketing entry-point for Forge. Layout (top to bottom):
 *
 *   1. <Hero>            — full-viewport pitch + animated grid bg
 *   2. <Features>        — 4-card bento grid (AI, Live Preview, Chat, Download)
 *   3. <HowItWorks>      — 3 numbered steps with a connecting spine
 *   4. <CallToAction>    — final "Ready to build?" prompt
 *   5. <Footer>          — credits + minimal links
 *
 * Design direction follows docs/UI_DESIGN_DIRECTION.md ("Obsidian Forge"):
 * dark, dense, technical, warm amber accent. All motion is framer-motion
 * with spring physics; everything respects `prefers-reduced-motion` via
 * the `useReducedMotion` hook (animations collapse to their end state).
 */
import { forwardRef, useRef } from "react"
import { useNavigate } from "react-router-dom"
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
  type Variants,
} from "framer-motion"
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
/* Inline visual styles                                                */
/* ------------------------------------------------------------------ */

/**
 * Inline styles for the hero background, gradient headline, and CTA
 * card. Kept here (not in a global stylesheet) so this file is the
 * single source of truth for landing-page visuals — no other file
 * needs to know about them.
 */
const HERO_GRID_STYLE: React.CSSProperties = {
  backgroundImage: [
    // Major grid lines
    "linear-gradient(to right, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px)",
    "linear-gradient(to bottom, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px)",
    // Subtle warm wash
    "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 70%)",
  ].join(", "),
  backgroundSize: "48px 48px, 48px 48px, 100% 100%",
  maskImage:
    "radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 80%)",
  WebkitMaskImage:
    "radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 80%)",
}

const HERO_GLOW_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(ellipse 50% 40% at 50% 30%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 70%)",
}

const GRADIENT_TEXT_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(135deg, oklch(0.85 0.16 75) 0%, oklch(0.75 0.16 70) 50%, oklch(0.65 0.18 55) 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
}

/* ------------------------------------------------------------------ */
/* Animation primitives                                                */
/* ------------------------------------------------------------------ */

/**
 * Container that staggers its direct children's entrance. Used for the
 * hero copy stack (headline → subheadline → CTAs) and the bento grid.
 */
const staggerContainer = (staggerMs = 80, delayMs = 0): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: staggerMs / 1000,
      delayChildren: delayMs / 1000,
    },
  },
})

/** Standard "rise and fade" child variant. */
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 30 },
  },
}

/** Larger rise for hero-scale headlines. */
const heroFadeInUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 200, damping: 25 },
  },
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing() {
  const navigate = useNavigate()
  const heroRef = useRef<HTMLDivElement | null>(null)
  const prefersReducedMotion = useReducedMotion() ?? false

  // Subtle parallax on the hero background — disabled entirely when the
  // user prefers reduced motion.
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  })
  const heroGridY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"])
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Hero
        ref={heroRef}
        gridY={heroGridY}
        heroOpacity={heroOpacity}
        onStart={() => navigate("/builder")}
        reducedMotion={prefersReducedMotion}
      />
      <Features reducedMotion={prefersReducedMotion} />
      <HowItWorks reducedMotion={prefersReducedMotion} />
      <CallToAction
        onStart={() => navigate("/builder")}
        reducedMotion={prefersReducedMotion}
      />
      <Footer />
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* 1. Hero                                                             */
/* ------------------------------------------------------------------ */

interface HeroProps {
  onStart: () => void
  reducedMotion: boolean
  gridY: MotionValue<string>
  heroOpacity: MotionValue<number>
}

/**
 * Full-viewport opening pitch. Includes an animated grid background
 * with a single radial amber glow, a 2-line headline ("Describe it."
 * / "Forge builds it."), a subhead, a primary CTA, and a small live
 * status badge that hints at the builder's streaming UX.
 *
 * Uses `forwardRef` so the parent can attach a `useScroll` target.
 */
const Hero = forwardRef<HTMLDivElement, HeroProps>(function Hero(
  { onStart, reducedMotion, gridY, heroOpacity },
  ref,
) {
  return (
    <section
      ref={ref}
      className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden border-b border-border"
    >
      {/* Animated grid background */}
      <motion.div
        aria-hidden
        style={{ y: reducedMotion ? 0 : gridY, opacity: heroOpacity }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0" style={HERO_GRID_STYLE} aria-hidden />
        <div className="absolute inset-0" style={HERO_GLOW_STYLE} aria-hidden />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
      </motion.div>

      <motion.div
        className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-24 text-center sm:py-32"
        variants={staggerContainer(120, 100)}
        initial="hidden"
        animate="visible"
      >
        {/* Eyebrow badge */}
        <motion.div variants={heroFadeInUp}>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Powered by OpenCode Zen
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={heroFadeInUp}
          className="mt-8 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
        >
          <span className="block text-foreground">Describe it.</span>
          <span className="block" style={GRADIENT_TEXT_STYLE}>
            Forge builds it.
          </span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          variants={heroFadeInUp}
          className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          Type a sentence. Watch a complete web app stream into existence —
          code, preview, and download, all in one calm dark workspace.
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={heroFadeInUp}
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4"
        >
          <Button
            size="lg"
            onClick={onStart}
            className="glow-primary group min-w-44 gap-2 px-6 text-base"
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
        </motion.div>

        {/* Tiny trust strip — a taste of the streaming UI without showing the full app */}
        <motion.div
          variants={heroFadeInUp}
          className="mt-16 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground"
        >
          <div className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 font-mono">
            <Bot className="size-3.5 text-primary" />
            <span>planner → coder → reviewer</span>
          </div>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">~2,500 apps / $20 credit</span>
        </motion.div>
      </motion.div>
    </section>
  )
})

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

function Features({ reducedMotion: _reducedMotion }: { reducedMotion: boolean }) {
  return (
    <section className="border-b border-border py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer(80)}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.p
            variants={fadeInUp}
            className="text-sm font-medium uppercase tracking-widest text-primary"
          >
            What you get
          </motion.p>
          <motion.h2
            variants={fadeInUp}
            className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            One workspace, end to end
          </motion.h2>
          <motion.p
            variants={fadeInUp}
            className="mt-4 text-base text-muted-foreground"
          >
            No tab juggling, no copy-pasting between tools. Prompt, watch,
            iterate, ship.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer(100, 80)}
          className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURES.map((feature) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              reducedMotion={_reducedMotion}
            />
          ))}
        </motion.div>
      </div>
    </section>
  )
}

function FeatureCard({
  feature,
}: {
  feature: Feature
  reducedMotion: boolean
}) {
  const Icon = feature.icon
  return (
    <motion.article
      variants={fadeInUp}
      className={
        "group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-card/80 " +
        (feature.span === "wide" ? "sm:col-span-2 lg:col-span-2" : "")
      }
    >
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-secondary text-primary transition-colors group-hover:border-primary/40">
        <Icon className="size-5" />
      </div>
      <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
        {feature.title}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {feature.description}
      </p>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
      />
    </motion.article>
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

function HowItWorks({ reducedMotion: _reducedMotion }: { reducedMotion: boolean }) {
  return (
    <section
      id="how-it-works"
      className="border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto w-full max-w-5xl px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer(80)}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.p
            variants={fadeInUp}
            className="text-sm font-medium uppercase tracking-widest text-primary"
          >
            How it works
          </motion.p>
          <motion.h2
            variants={fadeInUp}
            className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            From sentence to site in three steps
          </motion.h2>
        </motion.div>

        <ol className="relative mt-16 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-0">
          {/* Vertical spine on md+ */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border to-transparent md:block"
          />
          {STEPS.map((step, index) => (
            <StepCard
              key={step.number}
              step={step}
              index={index}
              reducedMotion={_reducedMotion}
            />
          ))}
        </ol>
      </div>
    </section>
  )
}

function StepCard({
  step,
  index,
}: {
  step: Step
  index: number
  reducedMotion: boolean
}) {
  const Icon = step.icon
  return (
    <motion.li
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
        delay: index * 0.08,
      }}
      className="relative flex flex-col items-center text-center md:px-6"
    >
      <div className="relative z-10 flex size-14 items-center justify-center rounded-full border border-border bg-card font-mono text-lg font-semibold text-primary shadow-glow">
        <Icon className="size-5" />
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
    </motion.li>
  )
}

/* ------------------------------------------------------------------ */
/* 4. CTA                                                              */
/* ------------------------------------------------------------------ */

function CallToAction({
  onStart,
  reducedMotion: _reducedMotion,
}: {
  onStart: () => void
  reducedMotion: boolean
}) {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto w-full max-w-4xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
          className="relative overflow-hidden rounded-3xl border border-border bg-card p-10 text-center sm:p-16"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={HERO_GLOW_STYLE}
          />
          <div className="relative">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to build?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
              Skip the setup. Open the builder and describe your first app.
            </p>
            <div className="mt-8 flex justify-center">
              <Button
                size="lg"
                onClick={onStart}
                className="glow-primary group gap-2 px-8 text-base"
              >
                Open the builder
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </div>
          </div>
        </motion.div>
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
    <footer className="border-t border-border py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Hammer className="size-4 text-primary" />
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
