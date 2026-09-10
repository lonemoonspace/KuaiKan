import type { PropsWithChildren, ReactNode } from 'react';

interface OptionsPageTitleProps extends PropsWithChildren {
  description?: ReactNode;
}

export function OptionsPageTitle({ children, description }: OptionsPageTitleProps) {
  return (
    <header className="mb-7 border-b border-border/70 pb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{children}</h1>
      {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </header>
  );
}
