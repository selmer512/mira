import React from 'react'

export interface RangeSliderProps {
  min?: number
  max?: number
  value?: number
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  name?: string
  step?: number
  className?: string
}

export function RangeSlider({ min = 0, max = 100, value, onChange, name, step = 1, className }: RangeSliderProps) {
  return (
    <input
      type="range"
      className={`aurora-range-slider${className ? ` ${className}` : ''}`}
      min={min}
      max={max}
      value={value}
      onChange={onChange}
      name={name}
      step={step}
    />
  )
}
