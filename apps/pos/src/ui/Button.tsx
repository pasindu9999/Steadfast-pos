import type { ComponentProps } from 'react';

const VARIANTS = {
  primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800',
  secondary: 'border-slate-500 bg-white text-slate-900 hover:bg-slate-100',
  danger: 'border-red-700 bg-white text-red-800 hover:bg-red-50',
};

type ButtonProps = ComponentProps<'button'> & { variant?: keyof typeof VARIANTS };

/** At least 48 px each way, so it can be tapped (ARCH §9). */
export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`min-h-12 min-w-12 rounded-md border-2 px-4 font-semibold disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
