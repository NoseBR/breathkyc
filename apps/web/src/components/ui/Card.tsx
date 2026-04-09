"use client";

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
}

export function Card({ className, glow, children, ...props }: CardProps) {
  return (
    <div
      className={twMerge(
        clsx(
          "bg-breath-card rounded-2xl border border-gray-800 p-6",
          glow && "shadow-lg shadow-breath-cyan/5",
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
}
