import React from 'react'

export interface RadioGroupProps {
  name?: string
  children?: React.ReactNode
  className?: string
}

export function RadioGroup({ name, children, className }: RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      data-name={name}
      className={`aurora-radio-group${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}
