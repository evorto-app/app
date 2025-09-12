import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'registrationStartOffset'
})
export class RegistrationStartOffsetPipe implements PipeTransform {
  transform(offsetInHours: number | null | undefined): string {
    if (offsetInHours == null || offsetInHours === 0) {
      return 'At event start';
    }

    // Keep original semantics: positive => before, negative => after
    if (offsetInHours > 0) {
      return this.formatOffset(offsetInHours, 'before');
    }

    return this.formatOffset(Math.abs(offsetInHours), 'after');
  }

  private formatOffset(hours: number, timing: 'before' | 'after'): string {
    if (hours < 24) {
      const hourText = hours === 1 ? 'hour' : 'hours';
      return `${hours} ${hourText} ${timing} event start`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    const dayText = days === 1 ? 'day' : 'days';
    
    if (remainingHours === 0) {
      return `${days} ${dayText} ${timing} event start`;
    }

    const hourText = remainingHours === 1 ? 'hour' : 'hours';
    return `${days} ${dayText} and ${remainingHours} ${hourText} ${timing} event start`;
  }
}
