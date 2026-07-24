import type { KeyboardEvent, WheelEvent } from 'react';

/** Prevent mouse wheel / trackpad from incrementing or decrementing a focused number input. */
export function blockNumberInputWheelChange(e: WheelEvent<HTMLInputElement>): void {
  e.preventDefault();
}

/** Prevent ArrowUp / ArrowDown from changing a number input value. */
export function blockNumberInputArrowKeys(e: KeyboardEvent<HTMLInputElement>): void {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
  }
}

/** Event handlers for money/amount `<input type="number">` fields. */
export const guardedAmountNumberInputProps = {
  onWheel: blockNumberInputWheelChange,
  onKeyDown: blockNumberInputArrowKeys,
} as const;
