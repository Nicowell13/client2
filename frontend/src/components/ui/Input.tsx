import { InputHTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <input
          ref={ref}
          className={clsx(
            'w-full px-4 py-2.5 rounded-lg border-2 transition-all',
            'focus:outline-none focus:ring-2 focus:ring-offset-1',
            'disabled:bg-gray-100 disabled:cursor-not-allowed',
            {
              'border-gray-300 focus:border-blue-500 focus:ring-blue-500': !error,
              'border-red-500 focus:border-red-500 focus:ring-red-500': error,
            },
            className
          )}
          {...props}
        />
        {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
        {helperText && !error && <p className="mt-1.5 text-sm text-gray-500">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
