import React from 'react'

export interface StatusProps {
  type: 'success' | 'error' | 'warning' | 'info'
  children?: React.ReactNode
  className?: string
}

export function Status({ type, children, className }: StatusProps) {
  return (
    <span
      className={`aurora-status aurora-status--${type}${className ? ` ${className}` : ''}`}
    >
      {children}
    </span>
  )
}
