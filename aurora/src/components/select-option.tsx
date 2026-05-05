import React from 'react'

export interface SelectOptionProps {
  value: string
  children?: React.ReactNode
  disabled?: boolean
  className?: string
}

export function SelectOption({ value, children, disabled = false, className }: SelectOptionProps) {
  return (
    <option
      value={value}
      disabled={disabled}
      className={className}
    >
      {children}
    </option>
  )
}
