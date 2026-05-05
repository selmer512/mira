import { type SwitchProps } from '@mira-ai/aurora'

import { WidgetComponent } from '../widget-component'

export class Switch extends WidgetComponent<SwitchProps> {
  constructor(props: SwitchProps) {
    super(props)
  }
}
