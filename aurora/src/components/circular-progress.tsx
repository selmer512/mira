import React from 'react'

export interface CircularProgressProps {
  value: number
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
  children?: React.ReactNode
  className?: string
}

const SIZE_PX: Record<string, number> = {
  sm: 48,
  md: 64,
  lg: 96,
  xl: 128,
  xxl: 160
}

export function CircularProgress({ value, size = 'md', children, className }: CircularProgressProps) {
  const px = SIZE_PX[size]
  const radius = (px - 8) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, value))
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div
      className={`aurora-circular-progress aurora-circular-progress--${size}${className ? ` ${className}` : ''}`}
      style={{ width: px, height: px, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg
        width={px}
        height={px}
        style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}
      >
        <circle
          cx={px / 2}
          cy={px / 2}
          r={radius}
          fill="none"
          stroke="var(--aurora-progress-track-color, rgba(255,255,255,0.1))"
          strokeWidth={4}
        />
        <circle
          cx={px / 2}
          cy={px / 2}
          r={radius}
          fill="none"
          stroke="var(--aurora-progress-color, var(--blue-color, #1c75db))"
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  )
}
