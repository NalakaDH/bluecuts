import React, { useEffect, useRef } from 'react';
import { blockNumberInputArrowKeys } from '../lib/numberInputGuards';

type GuardedAmountNumberInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  type?: 'number';
};

/** Amount `<input type="number">` that ignores wheel scroll and arrow-key increments. */
export const GuardedAmountNumberInput = React.forwardRef<HTMLInputElement, GuardedAmountNumberInputProps>(
  function GuardedAmountNumberInput({ onKeyDown, type = 'number', ...props }, forwardedRef) {
    const localRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => e.preventDefault();
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const setRef = (el: HTMLInputElement | null) => {
      localRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    return (
      <input
        ref={setRef}
        type={type}
        onKeyDown={e => {
          blockNumberInputArrowKeys(e);
          onKeyDown?.(e);
        }}
        {...props}
      />
    );
  }
);

export { blockNumberInputArrowKeys, blockNumberInputWheelChange, guardedAmountNumberInputProps } from '../lib/numberInputGuards';
