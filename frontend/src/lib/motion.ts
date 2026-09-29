import type { Transition } from 'motion/react';

/** The app's one easing curve (fast out, soft landing), shared with the CSS keyframes in styles.css. */
export const easeOut = [0.22, 1, 0.36, 1] as const;

/** Things that follow the pointer or a selection: quick, no visible overshoot. */
export const glide: Transition = { type: 'spring', stiffness: 560, damping: 44, mass: 0.7 };

/** Surfaces entering or leaving: short and eased, never springy. */
export const surface: Transition = { duration: 0.2, ease: easeOut };
