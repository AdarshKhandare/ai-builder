/**
 * Forge — motion.ts
 *
 * Shared framer-motion variants, transition presets, and the
 * `useReducedMotionSafe` helper. Every component that animates
 * imports from here so the motion language is centralized and
 * matches docs/UI_DESIGN_DIRECTION.md §6 / §8.
 *
 * All variants use ONLY `transform` and `opacity` — no `width`,
 * `height`, `top`, `left` — so they are GPU-composited and never
 * cause layout thrash (see design doc §8 "Performance rules").
 *
 * Importing from "framer-motion" because that is the installed
 * dependency in this project. The "motion/react" entry point is
 * also installed (via the `motion` package) and exports the same
 * API, so the import path can be flipped later without touching
 * any consumer.
 */

import type { Transition, Variants } from 'framer-motion'

/* ---------------------------------------------------------------------------
 * Spring transition presets
 *
 * The design doc §6 specifies three spring profiles:
 *   - spring-default  → general layout / panel transitions
 *   - spring-gentle   → reveals, page enters, soft motion
 *   - spring-snappy   → button presses, tooltips, quick interactions
 *
 * Use these as the `transition` prop on motion components.
 * --------------------------------------------------------------------------- */

export const springTransition: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
}

export const gentleSpring: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 25,
}

export const snappySpring: Transition = {
  type: 'spring',
  stiffness: 600,
  damping: 35,
}

/* ---------------------------------------------------------------------------
 * Duration / easing presets (for non-spring transitions)
 *
 * Mirrors design doc §6 motion tokens.
 * --------------------------------------------------------------------------- */

export const durationFast: Transition = { duration: 0.15, ease: 'easeOut' }
export const durationNormal: Transition = { duration: 0.2, ease: 'easeOut' }
export const durationSlow: Transition = { duration: 0.3, ease: 'easeOut' }
export const durationExit: Transition = { duration: 0.12, ease: 'easeIn' }

/* ---------------------------------------------------------------------------
 * Variants
 * --------------------------------------------------------------------------- */

/**
 * fadeInUp — the standard "appears from below" reveal.
 *
 * Use for: chat messages, list items, code lines, empty-state
 * content entering view. Pairs with AnimatePresence for enter/exit.
 */
export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

/**
 * staggerContainer — wraps a list whose children use the
 * `fadeInUp` variant (or any variant with the matching names).
 * Children animate 50ms apart — the design doc's "stagger" token.
 */
export const staggerContainer: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.02,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
}

/**
 * panelSlide — for the 3-panel builder (Chat / Code / Preview)
 * enter/exit, and for the mobile tab-switcher cross-fade.
 * Slight x-translation gives a "sliding into place" feel.
 */
export const panelSlide: Variants = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 12 },
}

/**
 * panelSlideRight — mirror of panelSlide for right-side panels.
 */
export const panelSlideRight: Variants = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

/**
 * modalEnter — used by Dialog/Sheet modals. Scale + fade from
 * center. Spring enter, fast ease-in exit (design doc: "exit
 * faster than enter").
 */
export const modalEnter: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
}

/**
 * toastSlide — toasts enter from below, exit by fading.
 */
export const toastSlide: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
}

/**
 * tabIndicator — used with the `layoutId` prop on a motion.div
 * to slide a shared background between active tab buttons.
 * Combine with springTransition for the slide physics.
 */
export const tabIndicator: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

/* ---------------------------------------------------------------------------
 * While-hover / while-tap presets
 *
 * These are not Variants (no initial/animate/exit) — they are
 * objects you spread onto a motion component's props. Example:
 *
 *   <motion.button {...buttonTap} className="...">Save</motion.button>
 * --------------------------------------------------------------------------- */

export const buttonTap = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
  transition: springTransition,
} as const

export const cardHover = {
  whileHover: { y: -2 },
  transition: springTransition,
} as const

/* ---------------------------------------------------------------------------
 * Stagger helper for raw (non-Variants) motion children.
 *
 * For the case where children each carry their own `transition`
 * and you only want the *delay* to cascade, use `staggerDelay(i)`.
 *
 *   {items.map((item, i) => (
 *     <motion.div
 *       key={item.id}
 *       initial={{ opacity: 0, y: 20 }}
 *       animate={{ opacity: 1, y: 0 }}
 *       transition={staggerDelay(i)}
 *     />
 *   ))}
 * --------------------------------------------------------------------------- */

export const staggerDelay = (index: number, base = 0.05): Transition => ({
  duration: 0.2,
  ease: 'easeOut',
  delay: index * base,
})
