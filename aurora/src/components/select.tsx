import React from 'react'

export interface SelectProps {
  name?: string
  value?: string
  children?: React.ReactNode
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  className?: string
}

export function Select({ name, value, children, onChange, className }: SelectProps) {
  return (
    <select
      name={name}
      value={value}
      onChange={onChange}
      className={`aurora-select${className ? ` ${className}` : ''}`}
    >
      {children}
    </select>
  )
}
