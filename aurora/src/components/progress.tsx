import React from 'react'

export interface ProgressProps {
  value: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Progress({ value, size = 'md', className }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className={`aurora-progress aurora-progress--${size}${className ? ` ${className}` : ''}`}>
      <div
        className="aurora-progress__bar"
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  )
}
