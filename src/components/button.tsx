import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = '',
  variant = 'primary',
  ...props
}) => {
  const baseClasses = 'px-4 py-2 rounded-xl font-semibold transition duration-200 flex items-center justify-center gap-2';
  
  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white',
    secondary: 'bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white',
    danger: 'bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};