import { motion, useReducedMotion } from "motion/react";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const LABEL_TRANSITION = {
  duration: 0.28,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

export interface AnimatedInputProps {
  autoFocus?: boolean;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  icon?: ReactNode;
  inputClassName?: string;
  label: string;
  labelClassName?: string;
  onBlur?: () => void;
  onChange?: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  value?: string;
}

export default function AnimatedInput({
  value,
  defaultValue = "",
  onChange,
  onBlur,
  onKeyDown,
  label,
  placeholder = "",
  disabled = false,
  autoFocus = false,
  className = "",
  inputClassName = "",
  labelClassName = "",
  icon,
}: AnimatedInputProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const val = isControlled ? value : internalValue;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const isFloating = Boolean(val) || isFocused;
  const shouldReduceMotion = Boolean(useReducedMotion());
  const reactId = useId();
  const inputId = `animated-input-${reactId.replace(/:/g, "")}`;

  const labelMotion = {
    top: isFloating ? 0 : "50%",
    y: "-50%" as const,
    scale: isFloating ? 0.85 : 1,
    color: isFloating ? "#222222" : "#6b7280",
  };

  return (
    <div className={className}>
      {/* Inner box so the label centers on the input, not outer padding */}
      <div className="relative">
        {icon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 z-[1] -translate-y-1/2"
          >
            {icon}
          </span>
        ) : null}

        <input
          aria-label={label}
          autoFocus={autoFocus}
          className={`animated-input__control peer w-full ${icon ? "has-icon" : ""} ${inputClassName}`}
          disabled={disabled}
          id={inputId}
          onBlur={() => {
            setIsFocused(false);
            onBlur?.();
          }}
          onChange={(e) => {
            if (!isControlled) {
              setInternalValue(e.target.value);
            }
            onChange?.(e.target.value);
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={isFloating ? placeholder : ""}
          ref={inputRef}
          type="text"
          value={val}
        />

        <motion.label
          htmlFor={inputId}
          className={`animated-input__label ${labelClassName}`}
          initial={false}
          animate={shouldReduceMotion ? undefined : labelMotion}
          style={
            shouldReduceMotion
              ? {
                  top: labelMotion.top,
                  transform: `translateY(-50%) scale(${labelMotion.scale})`,
                  color: labelMotion.color,
                }
              : undefined
          }
          transition={shouldReduceMotion ? { duration: 0 } : LABEL_TRANSITION}
        >
          {label}
        </motion.label>
      </div>
    </div>
  );
}
