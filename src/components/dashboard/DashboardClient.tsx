'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Split from 'split.js';
import { Button } from "@/components/ui/button";
import { 
  Grid,
  Plus,
  Minus,
  Activity,
  ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import { useROS } from '@/hooks/useROS';
import { extractRobotIdsFromTopics } from '@/lib/robot-topics';

const TelemetryPanel = dynamic(
  () => import('./TelemetryPanel'),
  {
    loading: () => (
      <div className="h-full bg-[#1a1a1a] rounded-sm p-2 border border-[#2a2a2a] flex items-center justify-center">
        <span className="text-gray-400">Loading Telemetry...</span>
      </div>
    ),
    ssr: false
  }
);

const VideoGrid = dynamic(
  () => import('./VideoGrid'),
  {
    loading: () => (
      <div className="h-full bg-[#1e1e1e] rounded-sm p-2 border border-[#333333] flex items-center justify-center">
        <span className="text-gray-400">Loading Video Grid...</span>
      </div>
    ),
    ssr: false
  }
);

const Controls = dynamic(
  () => import('./Controls'),
  {
    loading: () => (
      <div className="h-full bg-[#1e1e1e] rounded-sm p-2 border border-[#333333] flex items-center justify-center">
        <span className="text-gray-400">Loading Controls...</span>
      </div>
    ),
    ssr: false
  }
);

const SensorData = dynamic(
  () => import('./SensorData'),
  {
    loading: () => (
      <div className="h-full bg-[#1e1e1e] rounded-sm p-2 border border-[#333333] flex items-center justify-center">
        <span className="text-gray-400">Loading Sensor Data...</span>
      </div>
    ),
    ssr: false
  }
);

export default function DashboardClient() {
  const mainSplitRef = useRef(null);
  const leftSplitRef = useRef(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [robotIds, setRobotIds] = useState<string[]>([]);
  const [selectedRobotId, setSelectedRobotId] = useState(process.env.NEXT_PUBLIC_DEFAULT_ROBOT_ID ?? '');
  const { isConnected, listTopics } = useROS({ url: 'ws://localhost:9090', autoConnect: true });
  const activeRobotId = selectedRobotId || robotIds[0] || '';

  useEffect(() => {
    if (!isConnected) return;

    let canceled = false;
    const refreshRobotIds = async () => {
      try {
        const topics = await listTopics();
        const discovered = extractRobotIdsFromTopics(topics);
        if (canceled || discovered.length === 0) return;

        setRobotIds(discovered);
        setSelectedRobotId(prev => (discovered.includes(prev) ? prev : discovered[0]));
      } catch (error) {
        console.warn('Failed to discover robot IDs:', error);
      }
    };

    refreshRobotIds();
    const intervalId = setInterval(refreshRobotIds, 3000);

    return () => {
      canceled = true;
      clearInterval(intervalId);
    };
  }, [isConnected, listTopics]);

  useEffect(() => {
    let mainSplit: Split.Instance;
    let leftSplit: Split.Instance;

    if (activeTab === 'dashboard' && mainSplitRef.current && leftSplitRef.current) {
      // Initialize main horizontal split
      mainSplit = Split(['.left-panel', '.right-panel'], {
        sizes: [66, 34],
        minSize: [500, 300],
        gutterSize: 4,
        snapOffset: 0,
        dragInterval: 1,
        cursor: 'col-resize',
        gutter: (index, direction) => {
          const gutter = document.createElement('div');
          gutter.className = `gutter gutter-${direction} bg-[#232323] hover:bg-[#00a5ff] transition-colors duration-150`;
          return gutter;
        },
      });

      // Initialize left vertical split
      leftSplit = Split(['.left-top', '.left-bottom'], {
        sizes: [67, 33],
        minSize: [200, 200],
        direction: 'vertical',
        gutterSize: 4,
        snapOffset: 0,
        cursor: 'row-resize',
        gutter: (index, direction) => {
          const gutter = document.createElement('div');
          gutter.className = `gutter gutter-${direction} bg-[#232323] hover:bg-[#00a5ff] transition-colors duration-150`;
          return gutter;
        },
      });
    }

    return () => {
      mainSplit?.destroy();
      leftSplit?.destroy();
    };
  }, [activeTab]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#1a1a1a]">
      {/* Top Toolbar */}
      <div className="w-full h-12 bg-[#232323] flex items-center px-2 gap-1 border-b border-[#333333]">
        <div className="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="sm"
            className={`h-8 px-3 text-gray-400 hover:text-white hover:bg-[#2a2a2a] ${
              activeTab === 'dashboard' ? 'bg-[#2a2a2a] text-white' : ''
            }`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Grid className="w-4 h-4 mr-2" />
            Dashboard
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            className={`h-8 px-3 text-gray-400 hover:text-white hover:bg-[#2a2a2a] ${
              activeTab === 'sensor-data' ? 'bg-[#2a2a2a] text-white' : ''
            }`}
            onClick={() => setActiveTab('sensor-data')}
          >
            <Activity className="w-4 h-4 mr-2" />
            Sensor Data
          </Button>
          
          <Link href="/sensor-data" target="_blank" passHref>
            <Button 
              variant="ghost" 
              size="sm"
              className="h-8 px-3 text-gray-400 hover:text-white hover:bg-[#2a2a2a]"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Sensors in New Tab
            </Button>
          </Link>
          
          <span className="text-gray-600 mx-2">|</span>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#2a2a2a]">
            <Plus className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#2a2a2a]">
            <Minus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 mr-3">
          <span className="text-gray-400 text-xs">Robot</span>
          <select
            className="bg-[#2a2a2a] text-gray-200 text-xs rounded px-2 py-1 border border-[#3a3a3a]"
            value={activeRobotId}
            disabled={robotIds.length === 0 && !activeRobotId}
            onChange={(event) => setSelectedRobotId(event.target.value)}
          >
            {(robotIds.length > 0 ? robotIds : activeRobotId ? [activeRobotId] : []).map((robotId) => (
              <option key={robotId} value={robotId}>
                {robotId}
              </option>
            ))}
          </select>
        </div>
        <span className="text-gray-400 text-sm">TurtleBot3 Control System</span>
      </div>

      {/* Main Content */}
      {activeTab === 'dashboard' ? (
        <div className="h-[calc(100vh-4.1rem)] p-1 flex" ref={mainSplitRef}>
          {/* Left Panel */}
          <div className="left-panel flex flex-col h-full" ref={leftSplitRef}>
            <div className="left-top">
              <Suspense fallback={
                <div className="h-full bg-[#1e1e1e] rounded-sm flex items-center justify-center">
                  <span className="text-gray-400">Loading...</span>
                </div>
              }>
                <VideoGrid robotIds={robotIds.length > 0 ? robotIds : activeRobotId ? [activeRobotId] : []} />
              </Suspense>
            </div>
            
            <div className="left-bottom">
              <Suspense fallback={
                <div className="h-full bg-[#1a1a1a] rounded-sm flex items-center justify-center">
                  <span className="text-gray-400">Loading...</span>
                </div>
              }>
                {activeRobotId ? <TelemetryPanel robotId={activeRobotId} /> : (
                  <div className="h-full bg-[#1a1a1a] rounded-sm p-2 border border-[#2a2a2a] flex items-center justify-center">
                    <span className="text-gray-400">Discovering robots...</span>
                  </div>
                )}
              </Suspense>
            </div>
          </div>

          {/* Right Panel - Full Controls */}
          <div className="right-panel h-full">
            <Suspense fallback={
              <div className="h-full bg-[#1e1e1e] rounded-sm flex items-center justify-center">
                <span className="text-gray-400">Loading Controls...</span>
              </div>
            }>
              {activeRobotId ? <Controls robotId={activeRobotId} /> : (
                <div className="h-full bg-[#1e1e1e] rounded-sm flex items-center justify-center">
                  <span className="text-gray-400">Discovering robots...</span>
                </div>
              )}
            </Suspense>
          </div>
        </div>
      ) : (
        <Suspense fallback={
          <div className="h-[calc(100vh-3.1rem)] bg-[#1e1e1e] flex items-center justify-center">
            <span className="text-gray-400">Loading Sensor Data...</span>
          </div>
        }>
          <SensorData robotId={activeRobotId || undefined} />
        </Suspense>
      )}
    </div>
  );
}
