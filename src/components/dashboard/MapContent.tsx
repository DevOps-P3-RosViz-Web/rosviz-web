"use client";

import React, { useEffect, useState, useRef } from "react";
import L, { LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { useROS } from "@/hooks/useROS";
import { useDiscoveredRobots } from "@/hooks/useDiscoveredRobots";

// TODO: Maybe we could make this dynamic as well, even though I don't really see any way of doing this at the moment
// But basically the problem is odom starts at 0,0 and then published from there, so we wouldnt know where the robots start
const SPAWN_POSITIONS: Record<number, { x: number; y: number }> = {
  0: { x: 0, y: 0 },
  1: { x: -1, y: -1 },
  2: { x: 1, y: -1 },
};

// Moved this out of the interfcae below
const ANCHOR_LAT = 40.758;
const ANCHOR_LNG = -73.9855;
const METERS_PER_DEG_LAT = 111320;
const METERS_PER_DEG_LNG = 73640;

// Placeholder for colours?
function getRobotColor(id: number): string {
  const hue = (id * 137.5) % 360;
  return `hsl(${hue}, 80%, 55%)`;
}

// Helper functions/interfaces
interface OdometryMessage {
  pose: {
    pose: {
      position: { x: number; y: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
}

interface RobotPosition {
  lat: number;
  lng: number;
  yaw: number;
}

function worldToLatLng(wx: number, wy: number): LatLngTuple {
  const lat = ANCHOR_LAT + wy / METERS_PER_DEG_LAT;
  const lng = ANCHOR_LNG + wx / METERS_PER_DEG_LNG;
  return [lat, lng];
}

function yawFromQuaternion(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

function makeRobotIcon(color: string, yawDeg: number) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 16px;
      height: 16px;
      background-color: ${color};
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 8px ${color}88;
      position: relative;
    ">
      <div style="
        position: absolute;
        top: -6px;
        left: 50%;
        transform: translateX(-50%) rotate(${yawDeg}deg);
        width: 2px;
        height: 8px;
        background-color: white;
        transform-origin: bottom center;
      "></div>
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// Component to handle map size updates
function MapResizer() {
  const map = useMap();

  useEffect(() => {
    const handleResize = () => {
      map.invalidateSize();
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Initial size check

    return () => window.removeEventListener("resize", handleResize);
  }, [map]);

  return null;
}

const MapContent = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const mapRef = useRef(null);

  const { isConnected, subscribe } = useROS();
  const robotIds = useDiscoveredRobots();
  const [positions, setPositions] = useState<Record<number, RobotPosition>>({});

  useEffect(() => {
    if (!isConnected) return;

    const unsubs: (() => void)[] = [];

    for (const id of robotIds) {
      const spawn = SPAWN_POSITIONS[id] ?? { x: 0, y: 0 };
      const unsub = subscribe<OdometryMessage>(
        `/tb3_${id}/odom`,
        "nav_msgs/Odometry",
        (msg) => {
          const pos = msg.pose.pose.position;
          const ori = msg.pose.pose.orientation;
          const worldX = spawn.x + pos.x;
          const worldY = spawn.y + pos.y;
          const [lat, lng] = worldToLatLng(worldX, worldY);
          setPositions((prev) => ({
            ...prev,
            [id]: { lat, lng, yaw: yawFromQuaternion(ori) },
          }));
        },
      );
      unsubs.push(unsub);
    }

    return () => unsubs.forEach((u) => u());
  }, [isConnected, robotIds, subscribe]);

  type LatLngTuple = [number, number];
  const center: LatLngTuple = [ANCHOR_LAT, ANCHOR_LNG];

  return (
    <MapContainer
      center={center}
      zoom={20}
      style={{ height: "100%", width: "100%" }}
      zoomControl={false}
    >
      <MapResizer />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={21}
      />
      {Object.entries(positions).map(([idStr, pos]) => {
        const id = Number(idStr);
        const yawDeg = (pos.yaw * 180) / Math.PI;
        return (
          <Marker
            key={id}
            position={[pos.lat, pos.lng]}
            icon={makeRobotIcon(getRobotColor(id) ?? "#ffffff", yawDeg)}
          >
            <Popup>
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                <strong style={{ color: getRobotColor(id) }}>TurtleBot {id}</strong>
                <br />
                X: {(SPAWN_POSITIONS[id]?.x ?? 0).toFixed(3)}m<br />
                Y: {(SPAWN_POSITIONS[id]?.y ?? 0).toFixed(3)}m
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
};

export default MapContent;
