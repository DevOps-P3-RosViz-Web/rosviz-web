"use client";

import Link from "next/link";
import { Grid, Eye, AlertTriangle, AlertCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { useDiscoveredRobots } from "@/hooks/useDiscoveredRobots";
import { useROS } from "@/hooks/useROS";

// const FleetMap = dynamic(() => import('@/components/dashboard/Fleet2DMap'), { ssr: false });
const MapView = dynamic(() => import("@/components/dashboard/MapView"), { ssr: false });
const PointCloud = dynamic(() => import("@/components/dashboard/sensor-components/PointCloud"), {
  ssr: false,
});

function getRobotColor(id: number): string {
  const hue = (id * 137.5) % 360;
  return `hsl(${hue}, 80%, 55%)`;
}

const alerts = [
  { ts: "09.04.2026 15:55", text: "Possible Collision Detected", variant: "critical" },
  { ts: "09.04.2026 12:55", text: "Velocity Alert", variant: "warning" },
  { ts: "09.04.2026 07:34", text: "Velocity Alert", variant: "warning" },
];

export default function CommonPage() {
  const { isConnected } = useROS();
  const robotIds = useDiscoveredRobots();
  const [coords, setCoords] = useState<Record<number, { lat: string; lon: string }>>({});

  useEffect(() => {
    setCoords((prev) => {
      const next = { ...prev };
      for (const id of robotIds) {
        if (!(id in next)) {
          next[id] = { lat: "", lon: "" };
        }
      }
      return next;
    });
  }, [robotIds]);

  const handleCoordChange = (id: number, field: "lat" | "lon", value: string) => {
    setCoords((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleMoveAll = () => {
    console.log("Move all robots to:", coords);
    // TODO: actually moving the robots!
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#1a1a1a] flex flex-col">
      {/* Top Toolbar */}
      <div className="w-full h-12 bg-[#232323] flex items-center px-2 gap-1 border-b border-[#333333] shrink-0">
        <div className="flex items-center gap-1">
          <Link href="/">
            <button className="h-8 px-3 text-sm flex items-center gap-2 rounded text-gray-400 hover:text-white hover:bg-[#2a2a2a] transition-colors">
              <Grid className="w-4 h-4" />
              Fleet Overview
            </button>
          </Link>
          <Link href="/common">
            <button className="h-8 px-3 text-sm flex items-center gap-2 rounded text-white bg-[#2a2a2a]">
              <Eye className="w-4 h-4" />
              Common
            </button>
          </Link>
        </div>
        <div className="flex-1" />
        <span className="text-gray-400 text-sm">TurtleBot3 Control System</span>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 p-4">
        {/* Top Row */}
        <div className="flex gap-2 min-h-0" style={{ flex: "3" }}>
          {/* 2D Map */}
          <div className="flex-[2] min-w-0 min-h-0">
            <MapView />
          </div>

          {/* Point Cloud */}
          <div className="flex-[1.5] min-w-0 bg-[#1e1e1e] rounded-sm border border-[#333333] flex flex-col p-2">
            <span className="text-[#00a5ff] text-sm font-semibold mb-2 shrink-0">Point Cloud</span>
            <div className="flex-1 min-h-0">
              {isConnected ? (
                <PointCloud source="global" topic="/common/scan/points" />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-xs">
                  Connecting to ROS...
                </div>
              )}
            </div>
          </div>

          {/* Common Controls */}
          <div className="w-96 shrink-0 bg-[#1e1e1e] rounded-sm border border-[#333333] flex flex-col p-2 gap-2">
            <span className="text-[#00a5ff] text-sm font-semibold shrink-0">Common Controls</span>
            <div className="flex-1 flex flex-col gap-2">
              {robotIds.length === 0 ? (
                <div className="flex items-center justify-center flex-1 text-gray-500 text-xs">
                  Discovering robots...
                </div>
              ) : (
                robotIds.map((id) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getRobotColor(id) }}
                    />
                    <span className="text-gray-400 text-xs w-16 shrink-0">TB3-{id}</span>
                    <input
                      type="text"
                      placeholder="Lat"
                      value={coords[id]?.lat ?? ""}
                      onChange={(e) => handleCoordChange(id, "lat", e.target.value)}
                      className="w-0 flex-1 h-7 bg-[#2a2a2a] border border-[#333333] rounded px-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00a5ff]"
                    />
                    <input
                      type="text"
                      placeholder="Lon"
                      value={coords[id]?.lon ?? ""}
                      onChange={(e) => handleCoordChange(id, "lon", e.target.value)}
                      className="w-0 flex-1 h-7 bg-[#2a2a2a] border border-[#333333] rounded px-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00a5ff]"
                    />
                  </div>
                ))
              )}
            </div>
            <button
              onClick={handleMoveAll}
              className="w-full h-8 bg-[#00a5ff] hover:bg-[#0090dd] transition-colors rounded text-xs font-semibold text-white shrink-0"
            >
              Move all Robots
            </button>
          </div>
        </div>

        {/* Alerts Row */}
        <div className="bg-[#1e1e1e] rounded-sm border border-[#333333] p-2 shrink-0">
          <span className="text-[#00a5ff] text-sm font-semibold">Alert History</span>
          <div className="mt-2 flex flex-col gap-1">
            {alerts.map((alert, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-2.5 py-1.5 rounded border text-xs ${
                  alert.variant === "critical"
                    ? "border-red-500/40 bg-red-500/10 text-red-400"
                    : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
                }`}
              >
                {alert.variant === "critical" ? (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="font-mono text-[10px] opacity-70 shrink-0">{alert.ts}</span>
                <span>{alert.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
