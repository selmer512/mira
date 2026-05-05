import React from 'react'

export interface LoaderProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_MAP: Record<string, string> = {
  sm: 'var(--a-loader-size-sm, 14px)',
  md: 'var(--a-loader-size-md, 20px)',
  lg: 'var(--a-loader-size-lg, 28px)'
}

export function Loader({ size = 'md', className }: LoaderProps) {
  const sz = SIZE_MAP[size]
  return (
    <span
      className={`aurora-loader aurora-loader--${size}${className ? ` ${className}` : ''}`}
      style={{ width: sz, height: sz }}
      role="status"
      aria-label="Loading"
    />
  )
}
