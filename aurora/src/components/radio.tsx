import React from 'react'

export interface RadioProps {
  name?: string
  value?: string
  label?: string
  checked?: boolean
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  className?: string
}

export function Radio({ name, value, label, checked, onChange, className }: RadioProps) {
  return (
    <label className={`aurora-radio${className ? ` ${className}` : ''}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
      />
      {label && <span className="aurora-radio__label">{label}</span>}
    </label>
  )
}
