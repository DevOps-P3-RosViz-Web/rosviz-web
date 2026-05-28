'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Grid, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDiscoveredRobots } from '@/hooks/useDiscoveredRobots';
import rosbridge from '@/lib/rosbridge';
import { useROS } from '@/hooks/useROS';

const VideoStream = dynamic(() => import('@/components/dashboard/VideoStream'), { ssr: false });

interface BatteryStateMessage {
  voltage: number;
  percentage: number;
}

export default function FleetOverview() {
  const { isConnected } = useROS({ url: 'ws://localhost:9090' });
  const robotIds = useDiscoveredRobots();
  const [batteries, setBatteries] = useState<Record<number, number | null>>({});

  useEffect(() => {
    if (!isConnected) return;

    const unsubs: (() => void)[] = [];

    for (const id of robotIds) {
      const topic = `/tb3_${id}/battery_state`;
      const unsub = rosbridge.subscribe<BatteryStateMessage>(
        topic,
        'sensor_msgs/BatteryState',
        (msg) => {
          if (msg.percentage !== undefined) {
            setBatteries(prev => ({ ...prev, [id]: Math.round(msg.percentage * 100) }));
          }
        }
      );
      unsubs.push(unsub);
    }

    return () => unsubs.forEach(u => u());
  }, [isConnected, robotIds]);

  const onlineCount = robotIds.length;
  const offlineCount = 0;

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#1a1a1a]">
      {/* Top bar with fleet overview/common buttons */}
      <div className="w-full h-12 bg-[#232323] flex items-center px-2 gap-1 border-b border-[#333333]">
        <div className="flex items-center gap-1">
          <Link href="/">
            <button className="h-8 px-3 text-sm flex items-center gap-2 rounded text-white bg-[#2a2a2a]">
              <Grid className="w-4 h-4" />
              Fleet Overview
            </button>
          </Link>
          <Link href="/common">
            <button className="h-8 px-3 text-sm flex items-center gap-2 rounded text-gray-400 hover:text-white hover:bg-[#2a2a2a] transition-colors">
              <Eye className="w-4 h-4" />
              Common
            </button>
          </Link>
        </div>
        <div className="flex-1" />
        <span className="text-gray-400 text-sm">TurtleBot3 Control System</span>
      </div>

      {/* Main Page */}
      <div className="h-[calc(100vh-3rem)] flex">
        {/* Sidebar with fleet info */}
        <div className="w-64 h-full bg-[#1e1e1e] border-r border-[#2a2a2a] p-4 flex flex-col gap-3">
          <span className="text-[#00a5ff] text-base font-semibold">Overview</span>
          <div className="border-t border-[#2a2a2a] pt-3 flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Robots</span>
              <span className="text-white font-bold">{robotIds.length}</span>
            </div>
            <div className="border-t border-[#2a2a2a]" />
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Online</span>
              <span className="text-green-500 font-bold">{onlineCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Offline</span>
              <span className="text-red-500 font-bold">{offlineCount}</span>
            </div>
          </div>
          {!isConnected && (
            <div className="mt-2 text-xs text-yellow-400">Connecting to ROS...</div>
          )}
        </div>

        <div className="flex-1 p-6 grid grid-cols-3 gap-4 content-start">
          {robotIds.length === 0 ? (
            <div className="col-span-3 flex items-center justify-center text-gray-500 text-sm">
              {isConnected ? 'Discovering robots...' : 'Connecting to ROS...'}
            </div>
          ) : (
            robotIds.map((id) => {
              const battery = batteries[id] ?? null;
              return (
                <Link
                  key={id}
                  href={`/robot/tb3_${id}`}
                  className="bg-[#2a2a2a] border border-[#333333] rounded-lg overflow-hidden hover:border-[#00a5ff] transition-colors duration-150 flex flex-col p-3 gap-2"
                >
                  {/* Top section: camera + info side by side */}
                  <div className="flex gap-3">
                    {/* Camera Feed */}
                    <div className="flex-1 aspect-video rounded overflow-hidden">
                      <VideoStream topic="/camera/image_raw" robotId={id} />
                    </div>

                    <div className="flex flex-col justify-start gap-1 w-28">
                      <div className="flex items-baseline gap-1">
                        <div className="w-2 h-2 rounded-full flex-shrink-0 bg-green-500" />
                        <span className="text-sm font-medium text-green-500">Online</span>
                      </div>
                      <span className="text-white text-sm font-semibold">TurtleBot {id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                      {battery !== null && (
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${battery}%`,
                            backgroundColor: battery > 20 ? '#facc15' : '#ef4444'
                          }}
                        />
                      )}
                    </div>
                    <span className={`text-xs font-bold flex-shrink-0 ${battery === null ? 'text-gray-500' : battery > 20 ? 'text-yellow-400' : 'text-red-500'}`}>
                      {battery !== null ? `${battery}%` : '--'}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}