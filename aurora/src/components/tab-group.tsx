import React from 'react'

export interface TabGroupProps {
  children?: React.ReactNode
  className?: string
}

export function TabGroup({ children, className }: TabGroupProps) {
  return (
    <div className={`aurora-tab-group${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
