'use client';

import React, { Suspense, useEffect } from 'react';
import dynamic from 'next/dynamic';
import RobotSelector from '@/components/ui/RobotSelector';
import { useDiscoveredRobots } from '@/hooks/useDiscoveredRobots';
import { useRobotSelection } from '@/hooks/useRobotSelection';
import { useROS } from '@/hooks/useROS';

const SensorData = dynamic(
  () => import('@/components/dashboard/SensorData'),
  {
    loading: () => (
      <div className="h-screen w-screen flex items-center justify-center bg-[#1a1a1a] text-gray-400">
        Loading Sensor Data...
      </div>
    ),
    ssr: false
  }
);

export default function SensorDataPage() {
  const { isConnected } = useROS();
  const robots = useDiscoveredRobots();
  const { selectedRobotId, selectRobot, isSwitchingRobot } = useRobotSelection();

  useEffect(() => {
    if (robots.length === 0 || isSwitchingRobot) return;
    if (selectedRobotId === null || !robots.includes(selectedRobotId)) {
      void selectRobot(robots[0]);
    }
  }, [robots, selectedRobotId, selectRobot, isSwitchingRobot]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#1a1a1a]">
      {/* Top Toolbar */}
      <div className="w-full h-12 bg-[#232323] flex items-center px-2 gap-1 border-b border-[#333333]">
        <span className="text-gray-400 text-sm mr-2">Sensor Data</span>
        <RobotSelector
          robots={robots}
          selectedRobotId={selectedRobotId}
          onSelect={selectRobot}
          isConnected={isConnected}
        />
        <div className="flex-1" />
        <span className="text-gray-400 text-sm">TurtleBot3 Control System</span>
      </div>

      {selectedRobotId === null ? (
        <div className="h-[calc(100vh-3rem)] flex items-center justify-center bg-[#1a1a1a] text-gray-400">
          {isConnected ? 'Waiting for robots…' : 'Connecting to ROS…'}
        </div>
      ) : (
        <Suspense fallback={
          <div className="h-[calc(100vh-3rem)] flex items-center justify-center bg-[#1a1a1a] text-gray-400">
            Loading...
          </div>
        }>
          <SensorData key={selectedRobotId} robotId={selectedRobotId} />
        </Suspense>
      )}
    </div>
  );
}
