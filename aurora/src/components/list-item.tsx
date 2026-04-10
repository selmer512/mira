import React from 'react'

export interface ListItemProps {
  children?: React.ReactNode
  name?: string
  value?: string
  onClick?: (value: string) => void
  center?: boolean
  className?: string
}

export function ListItem({ children, name, value, onClick, center = false, className }: ListItemProps) {
  const handleClick = onClick && value !== undefined
    ? () => onClick(value)
    : undefined

  return (
    <li
      className={`aurora-list-item${center ? ' aurora-list-item--center' : ''}${handleClick ? ' aurora-list-item--clickable' : ''}${className ? ` ${className}` : ''}`}
      data-name={name}
      data-value={value}
      onClick={handleClick}
      style={handleClick ? { cursor: 'pointer' } : undefined}
    >
      {children}
    </li>
  )
}
