import type { PropsWithChildren } from 'react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';

export function MotionProvider({ children }: PropsWithChildren) {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
