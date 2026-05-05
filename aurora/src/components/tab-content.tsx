import React from 'react'

export interface TabContentProps {
  children?: React.ReactNode
  className?: string
}

export function TabContent({ children, className }: TabContentProps) {
  return (
    <div role="tabpanel" className={`aurora-tab-content${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
