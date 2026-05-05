import React from 'react'

export interface SwitchProps {
  checked?: boolean
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  name?: string
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onChange, name, disabled = false, className }: SwitchProps) {
  return (
    <label className={`aurora-switch${className ? ` ${className}` : ''}`}>
      <input
        type="checkbox"
        role="switch"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="aurora-switch__track" />
    </label>
  )
}
