import { type SelectProps } from '@mira-ai/aurora'

import { WidgetComponent } from '../widget-component'

export class Select extends WidgetComponent<SelectProps> {
  constructor(props: SelectProps) {
    super(props)
  }
}
