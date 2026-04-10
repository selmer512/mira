import React from 'react'

export interface TabProps {
  title?: string
  children?: React.ReactNode
  selected?: boolean
  onClick?: () => void
  className?: string
}

export function Tab({ title, children, selected = false, onClick, className }: TabProps) {
  return (
    <div
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`aurora-tab${selected ? ' aurora-tab--selected' : ''}${className ? ` ${className}` : ''}`}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {title || children}
    </div>
  )
}
