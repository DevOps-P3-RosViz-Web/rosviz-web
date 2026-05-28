'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ClientPage from '@/app/client-page';
import { useRobotSelection } from '@/hooks/useRobotSelection';

function parseRobotId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^tb3_(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

export default function RobotPage() {
  const params = useParams<{ id?: string | string[] }>();
  const router = useRouter();
  const { selectedRobotId, selectRobot, isSwitchingRobot } = useRobotSelection();

  const routeRobotId = parseRobotId(params?.id);

  useEffect(() => {
    if (routeRobotId === null) {
      router.replace('/');
      return;
    }
    if (!isSwitchingRobot && selectedRobotId !== routeRobotId) {
      void selectRobot(routeRobotId);
    }
  }, [routeRobotId, selectedRobotId, selectRobot, router, isSwitchingRobot]);

  if (routeRobotId === null) return null;

  return <ClientPage />;
}
