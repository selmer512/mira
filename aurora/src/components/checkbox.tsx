import React from 'react'

export interface CheckboxProps {
  name?: string
  value?: string
  label?: string
  checked?: boolean
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  className?: string
}

export function Checkbox({ name, value, label, checked, onChange, className }: CheckboxProps) {
  return (
    <label className={`aurora-checkbox${className ? ` ${className}` : ''}`}>
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
      />
      {label && <span className="aurora-checkbox__label">{label}</span>}
    </label>
  )
}
