import React from 'react'

export interface ListProps {
  children?: React.ReactNode
  className?: string
}

export function List({ children, className }: ListProps) {
  return (
    <ul className={`aurora-list${className ? ` ${className}` : ''}`}>
      {children}
    </ul>
  )
}
