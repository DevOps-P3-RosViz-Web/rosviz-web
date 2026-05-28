'use client';

import React from 'react';
import { RobotSelectionProvider } from '@/hooks/useRobotSelection';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return <RobotSelectionProvider>{children}</RobotSelectionProvider>;
}
