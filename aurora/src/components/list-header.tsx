import React from 'react'

export interface ListHeaderProps {
  children?: React.ReactNode
  className?: string
}

export function ListHeader({ children, className }: ListHeaderProps) {
  return (
    <li className={`aurora-list-header${className ? ` ${className}` : ''}`}>
      {children}
    </li>
  )
}
