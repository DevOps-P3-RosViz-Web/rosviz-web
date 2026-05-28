export type ROSCallback<T> = (message: T) => void;

export interface ROSMessageBase {
  op: string;
  topic?: string;
  type?: string;
}

export interface ROSMessage extends ROSMessageBase {
  msg?: ROSMessageData;
}

export interface ROSMessageData {
  data?: Uint8Array | string | number[];
  encoding?: string;
  [key: string]: any;
}

export interface ROSImageMessage extends ROSMessageData {
  header: {
    seq: number;
    stamp: {
      secs: number;
      nsecs: number;
    };
    frame_id: string;
  };
  height: number;
  width: number;
  encoding: string;
  is_bigendian: number;
  step: number;
  data: Uint8Array | string | number[];
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Point;
  orientation: Quaternion;
}

export interface Odometry {
  header: {
    seq: number;
    stamp: {
      secs: number;
      nsecs: number;
    };
    frame_id: string;
  };
  child_frame_id: string;
  pose: {
    pose: Pose;
    covariance: number[];
  };
  twist: {
    twist: {
      linear: Point;
      angular: Point;
    };
    covariance: number[];
  };
}


export interface Header {
  seq?: number;
  stamp: { secs: number; nsecs: number };
  frame_id: string;
}

export interface Twist {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
}

export interface IMU {
  header: Header;
  orientation: Quaternion;
  orientation_covariance: number[];
  angular_velocity: Point;
  angular_velocity_covariance: number[];
  linear_acceleration: Point;
  linear_acceleration_covariance: number[];
}

export interface LaserScan {
  header: Header;
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  ranges: number[];
  intensities: number[];
}

export interface PointCloud2Field {
  name: string;
  offset: number;
  datatype: number;
  count: number;
}

export interface PointCloud2 {
  header: Header;
  height: number;
  width: number;
  fields: PointCloud2Field[];
  is_bigendian: boolean;
  point_step: number;
  row_step: number;
  data: Uint8Array | string;
  is_dense: boolean;
}

export interface CompressedImage {
  header: Header;
  format: string;
  data: Uint8Array | string | number[];
}

export interface BatteryState {
  header?: Header;
  voltage: number;
  current?: number;
  charge?: number;
  capacity?: number;
  design_capacity?: number;
  percentage?: number;
  power_supply_status?: number;
  power_supply_health?: number;
  power_supply_technology?: number;
  present?: boolean;
}

export interface TransformStamped {
  header: Header;
  child_frame_id: string;
  transform: {
    translation: Point;
    rotation: Quaternion;
  };
}

export interface TFMessage {
  transforms: TransformStamped[];
}

export type AlertSeverity = 'warning' | 'critical';
export type AlertType =
  | 'COLLISION'
  | 'VELOCITY_EXCEEDED'
  | 'CONNECTION_LOSS'
  | 'LOW_BATTERY'
  | 'IMPACT_DETECTED'
  | 'TILT_WARNING'
  | 'MOTOR_STALL'
  | 'GEOFENCE_BREACH'
  | 'BATTERY_FAULT'
  | 'MOTOR_OVERLOAD'
  | 'VERTICAL_SHOCK'
  | 'WHEEL_SLIP';

export interface AlertMessage {
  id: string;
  timestamp: number;
  robot_id: number;
  alert_type: AlertType;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
}