import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInputModule],
  selector: 'app-duration-selector',
  standalone: true,
  templateUrl: './duration-selector.component.html',
})
export class DurationSelectorComponent implements FormValueControl<number> {
  readonly disabled = input<boolean>(false);
  readonly hidden = input<boolean>(false);
  public readonly hint = input<string>('');
  public readonly label = input<string>('Duration');
  readonly readonly = input<boolean>(false);
  readonly touched = model<boolean>(false);
  readonly value = model<number>(0);

  protected readonly days = computed(() =>
    Math.max(0, Math.floor(this.value() / 24)),
  );
  protected readonly hours = computed(() =>
    Math.max(0, this.value() % 24),
  );

  protected markTouched(): void {
    this.touched.set(true);
  }

  protected updateDays(event: Event): void {
    const nextDays = this.parseNumber(event);
    this.value.set(nextDays * 24 + this.hours());
  }

  protected updateHours(event: Event): void {
    const nextHours = Math.min(23, this.parseNumber(event));
    this.value.set(this.days() * 24 + nextHours);
  }

  private parseNumber(event: Event): number {
    const value = Number.parseInt(
      (event.target as HTMLInputElement | null)?.value ?? '0',
      10,
    );
    return Number.isNaN(value) ? 0 : Math.max(0, value);
  }
}
