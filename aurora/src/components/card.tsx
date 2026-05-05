import React from 'react'

export interface CardProps {
  children?: React.ReactNode
  noPadding?: boolean
  className?: string
}

export function Card({ children, noPadding = false, className }: CardProps) {
  return (
    <div
      className={`aurora-card${noPadding ? ' aurora-card--no-padding' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}
