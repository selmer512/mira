import React from 'react'

export interface TabListProps {
  children?: React.ReactNode
  className?: string
}

export function TabList({ children, className }: TabListProps) {
  return (
    <div role="tablist" className={`aurora-tab-list${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
