/**
 * Central catalog of ROS topics used by the dashboard.
 *
 * Each entry has:
 *   path:        topic path WITHOUT a robot prefix
 *   type:        ROS message type string (matches what rosbridge expects)
 *   perRobot:    true  → caller should pass a robotId, hook will prefix /tb3_<id>
 *                false → caller should NOT pass a robotId (e.g. /tf, /selected/*)
 *
 * Adding a new topic? Put it here, don't sprinkle strings across components.
 */
export interface TopicEntry {
  path: string;
  type: string;
  perRobot: boolean;
}

export const TOPICS = {
  // ── Per-robot topics (need robotId passed to subscribe/publish) ──
  odom: { path: "/odom", type: "nav_msgs/Odometry", perRobot: true },
  imu: { path: "/imu", type: "sensor_msgs/Imu", perRobot: true },
  scan: { path: "/scan", type: "sensor_msgs/LaserScan", perRobot: true },
  scanPoints: {
    path: "/scan/points",
    type: "sensor_msgs/PointCloud2",
    perRobot: true,
  },
  cmdVel: { path: "/cmd_vel", type: "geometry_msgs/Twist", perRobot: true },
  cameraImage: {
    path: "/camera/image_raw/compressed",
    type: "sensor_msgs/CompressedImage",
    perRobot: true,
  },
  cameraDepth: {
    path: "/camera/depth/image_rect_raw/compressed",
    type: "sensor_msgs/CompressedImage",
    perRobot: true,
  },
  batteryState: {
    path: "/battery_state",
    type: "sensor_msgs/BatteryState",
    perRobot: true,
  },
  jointStates: {
    path: "/joint_states",
    type: "sensor_msgs/JointState",
    perRobot: true,
  },

  // ── Shared / global topics (no prefix) ──
  tf: { path: "/tf", type: "tf2_msgs/TFMessage", perRobot: false },
  tfStatic: { path: "/tf_static", type: "tf2_msgs/TFMessage", perRobot: false },

  // ── Mux outputs (no prefix — switched via service call) ──
  selectedScanPoints: {
    path: "/selected/scan_points",
    type: "sensor_msgs/PointCloud2",
    perRobot: false,
  },
  selectedCameraImage: {
    path: "/selected/camera_image",
    type: "sensor_msgs/CompressedImage",
    perRobot: false,
  },
  selectedCameraDepth: {
    path: "/selected/camera_depth",
    type: "sensor_msgs/CompressedImage",
    perRobot: false,
  },

  // ── Alert topics (fleet-wide, published by alert_monitor_node.py) ──
  robotAlerts: {
    path: "/robot_alerts",
    type: "std_msgs/String",
    perRobot: false,
  },
  robotAlertsHistory: {
    path: "/robot_alerts_history",
    type: "std_msgs/String",
    perRobot: false,
  },
  robotAlertsRequestHistory: {
    path: "/robot_alerts_request_history",
    type: "std_msgs/String",
    perRobot: false,
  },

  // ── Safety auto-stop (toggle command + status echo) ──
  safetyAutoStop: {
    path: "/safety_auto_stop",
    type: "std_msgs/Bool",
    perRobot: false,
  },
  safetyAutoStopStatus: {
    path: "/safety_auto_stop_status",
    type: "std_msgs/Bool",
    perRobot: false,
  },
} as const satisfies Record<string, TopicEntry>;

export type TopicKey = keyof typeof TOPICS;

/**
 * Deterministic per-robot color using the golden-angle hue distribution.
 * Produces well-separated, repeatable colors for any robot id.
 */
export function colorForRobot(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

/**
 * Same color as an HTMLish hex string, for places that need a number
 * (e.g. THREE.Color expects 0xRRGGBB or '#rrggbb', not hsl()).
 */
export function colorForRobotHex(id: number): string {
  // Convert HSL → RGB → hex
  const h = ((id * 137.508) % 360) / 360;
  const s = 0.7;
  const l = 0.55;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
