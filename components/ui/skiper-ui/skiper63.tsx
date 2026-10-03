"use client";

/**
 * Apple squircle effect via SVG filter (Skiper UI skiper63).
 *
 * Mount once near the app root:
 *   <SquiCircleFilterStatic />
 *
 * Apply on any box:
 *   style={{ filter: "url(#SkiperSquiCircleFilterLayout)" }}
 *   or className "squircle"
 */

type SquiCircleFilterProps = {
  blurValue?: number;
  colorMatrixValue?: number;
  alphaValue?: number;
  /** SVG filter id referenced by `url(#id)`. */
  id?: string;
};

export const SquiCircleFilter = ({
  blurValue = 10,
  colorMatrixValue = 20,
  alphaValue = -7,
  id = "SquiCircleFilter",
}: SquiCircleFilterProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      version="1.1"
    >
      <defs>
        <filter id={id}>
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={blurValue}
            result="blur"
          />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${colorMatrixValue} ${alphaValue}`}
            result="goo"
          />
          <feBlend in="SourceGraphic" in2="goo" />
        </filter>
      </defs>
    </svg>
  );
};

/** Static filter with the layout id used across the site. */
export const SquiCircleFilterStatic = () => (
  <SquiCircleFilter id="SkiperSquiCircleFilterLayout" />
);

export const SQUIRCLE_FILTER = "url(#SkiperSquiCircleFilterLayout)";
