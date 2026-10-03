import { motion, useReducedMotion } from 'motion/react';

type AnimatedPlusIconProps = {
  className?: string;
  /** SVG viewBox size (default 48). */
  size?: number;
};

/** Premium add mark: dashed orbit + refined cross (Family / editorial style). */
export function AnimatedPlusIcon({ className, size = 48 }: AnimatedPlusIconProps) {
  const reduceMotion = useReducedMotion();
  const c = size / 2;
  const r = size * 0.415;
  const arm = size * 0.19;
  const stroke = Math.max(1, size * 0.032);
  const dash = size * 0.11;

  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <span className={`animated-plus-icon ${className ?? ''}`.trim()} aria-hidden="true">
      <motion.span
        className="animated-plus-icon__motion"
        initial={reduceMotion ? false : { scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      >
        <svg viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle
            className="animated-plus-icon__glow"
            cx={c}
            cy={c}
            r={r * 0.55}
            fill="currentColor"
          />
          <g className="animated-plus-icon__ring">
            <motion.circle
              cx={c}
              cy={c}
              r={r}
              stroke="currentColor"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${dash * 0.85}`}
              initial={reduceMotion ? false : { pathLength: 0, opacity: 0.5 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.7, ease }}
            />
          </g>
          <g className="animated-plus-icon__cross">
            <motion.path
              d={`M${c} ${c - arm}V${c + arm}`}
              stroke="currentColor"
              strokeWidth={stroke * 1.15}
              strokeLinecap="round"
              initial={reduceMotion ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, delay: 0.18, ease }}
            />
            <motion.path
              d={`M${c - arm} ${c}H${c + arm}`}
              stroke="currentColor"
              strokeWidth={stroke * 1.15}
              strokeLinecap="round"
              initial={reduceMotion ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, delay: 0.28, ease }}
            />
          </g>
        </svg>
      </motion.span>
    </span>
  );
}
