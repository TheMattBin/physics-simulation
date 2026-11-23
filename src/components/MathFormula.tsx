import { useMemo } from 'react';
import katex from 'katex';

interface MathFormulaProps {
  latex: string;
  block?: boolean;
  className?: string;
}

export function MathFormula({ latex, block = false, className = '' }: MathFormulaProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: block,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return latex;
    }
  }, [latex, block]);

  if (block) {
    return (
      <div
        className={`overflow-x-auto ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
