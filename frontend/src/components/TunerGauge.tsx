import type { TuningStatus } from './TunerDialog';

interface TunerGaugeProps {
  cents: number;
  status: TuningStatus;
}

// Arc geometry
const CX = 120;
const CY = 115;
const R = 100;
const STROKE = 6;
const NEEDLE_LENGTH = R - 10;

// Color segments for the arc
const CORAL = 'var(--color-tuner-off)';
const AMBER = 'var(--color-tuner-close)';
const SAGE = 'var(--color-tuner-intune)';

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${sweep} 1 ${end.x} ${end.y}`;
}

function tickMark(cx: number, cy: number, r: number, angleDeg: number, length: number) {
  const outer = polarToCartesian(cx, cy, r + length / 2, angleDeg);
  const inner = polarToCartesian(cx, cy, r - length / 2, angleDeg);
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
}

// Map cents (-50 to +50) to angle (180 to 360 degrees, i.e. bottom-left to bottom-right)
function centsToAngle(cents: number): number {
  return 180 + ((cents + 50) / 100) * 180;
}

export default function TunerGauge({ cents, status }: TunerGaugeProps) {
  const needleAngle = centsToAngle(status === 'idle' ? 0 : cents);
  const needleTip = polarToCartesian(CX, CY, NEEDLE_LENGTH, needleAngle);
  const isIdle = status === 'idle';

  // Tick positions: -50, -25, 0, +25, +50 cents
  const centerTick = tickMark(CX, CY, R, 270, 10);
  const tick_n25 = tickMark(CX, CY, R, 225, 6);
  const tick_p25 = tickMark(CX, CY, R, 315, 6);
  const tick_n50 = tickMark(CX, CY, R, 180, 6);
  const tick_p50 = tickMark(CX, CY, R, 360, 6);

  return (
    <svg
      viewBox="0 0 240 130"
      className="w-[200px] h-[110px] sm:w-[240px] sm:h-[130px]"
      role="meter"
      aria-valuenow={cents}
      aria-valuemin={-50}
      aria-valuemax={50}
      aria-label="Tuning gauge"
    >
      {/* Color-segmented arc: coral -> amber -> sage -> amber -> coral */}
      <path d={describeArc(CX, CY, R, 180, 225)} fill="none" stroke={CORAL} strokeWidth={STROKE} strokeLinecap="round" opacity={isIdle ? 0.4 : 1} />
      <path d={describeArc(CX, CY, R, 225, 265)} fill="none" stroke={AMBER} strokeWidth={STROKE} opacity={isIdle ? 0.4 : 1} />
      <path d={describeArc(CX, CY, R, 265, 275)} fill="none" stroke={SAGE} strokeWidth={STROKE} opacity={isIdle ? 0.4 : 1} />
      <path d={describeArc(CX, CY, R, 275, 315)} fill="none" stroke={AMBER} strokeWidth={STROKE} opacity={isIdle ? 0.4 : 1} />
      <path d={describeArc(CX, CY, R, 315, 360)} fill="none" stroke={CORAL} strokeWidth={STROKE} strokeLinecap="round" opacity={isIdle ? 0.4 : 1} />

      {/* Tick marks */}
      <line {...centerTick} stroke="var(--color-foreground)" strokeWidth={3} opacity={0.6} />
      <line {...tick_n25} stroke="var(--color-foreground)" strokeWidth={1} opacity={0.3} />
      <line {...tick_p25} stroke="var(--color-foreground)" strokeWidth={1} opacity={0.3} />
      <line {...tick_n50} stroke="var(--color-foreground)" strokeWidth={1} opacity={0.3} />
      <line {...tick_p50} stroke="var(--color-foreground)" strokeWidth={1} opacity={0.3} />

      {/* Needle */}
      <line
        x1={CX}
        y1={CY}
        x2={needleTip.x}
        y2={needleTip.y}
        stroke="var(--color-foreground)"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={isIdle ? 0.3 : 0.9}
        style={{ transition: 'x2 120ms ease-out, y2 120ms ease-out' }}
      />
      {/* Pivot circle */}
      <circle
        cx={CX}
        cy={CY}
        r={4}
        fill="var(--color-foreground)"
        opacity={isIdle ? 0.3 : 0.9}
      />
    </svg>
  );
}
