#!/usr/bin/env python3
import math
from typing import Dict, List, Optional, Tuple

import rclpy
from rclpy.duration import Duration
from rclpy.node import Node
from rclpy.qos import QoSHistoryPolicy, QoSProfile, QoSReliabilityPolicy
from rclpy.time import Time
from sensor_msgs.msg import PointCloud2
from sensor_msgs_py import point_cloud2
import tf2_ros


class PointCloudAggregator(Node):
    def __init__(self) -> None:
        super().__init__("pointcloud_aggregator")

        self.declare_parameter("num_robots", 3)
        self.declare_parameter("input_topic_suffix", "/scan/points")
        self.declare_parameter("target_frame", "world")
        self.declare_parameter("output_topic", "/common/scan/points")
        self.declare_parameter("publish_rate_hz", 8.0)
        self.declare_parameter("stale_timeout_sec", 1.0)
        self.declare_parameter("debug_logs", True)
        self.declare_parameter("source_frame_from_topic_namespace", True)

        self.num_robots = int(self.get_parameter("num_robots").value)
        self.input_topic_suffix = str(self.get_parameter("input_topic_suffix").value)
        self.target_frame = str(self.get_parameter("target_frame").value)
        self.output_topic = str(self.get_parameter("output_topic").value)
        self.publish_rate_hz = float(self.get_parameter("publish_rate_hz").value)
        self.stale_timeout_sec = float(self.get_parameter("stale_timeout_sec").value)
        self.debug_logs = bool(self.get_parameter("debug_logs").value)
        self.source_frame_from_topic_namespace = bool(
            self.get_parameter("source_frame_from_topic_namespace").value
        )

        if not self.input_topic_suffix.startswith("/"):
            self.input_topic_suffix = f"/{self.input_topic_suffix}"
        if self.publish_rate_hz <= 0:
            self.publish_rate_hz = 8.0

        qos = QoSProfile(
            reliability=QoSReliabilityPolicy.BEST_EFFORT,
            history=QoSHistoryPolicy.KEEP_LAST,
            depth=5,
        )
        self.publisher = self.create_publisher(PointCloud2, self.output_topic, qos)

        self.tf_buffer = tf2_ros.Buffer(cache_time=Duration(seconds=10.0))
        self.tf_listener = tf2_ros.TransformListener(self.tf_buffer, self)

        self.latest_clouds: Dict[int, PointCloud2] = {}
        self.subscribers = []
        self.publish_cycles = 0
        self.last_debug_ns = 0
        self.last_tf_debug_ns = 0

        topics = []
        for i in range(self.num_robots):
            topic = f"/tb3_{i}{self.input_topic_suffix}"
            topics.append(topic)
            self.subscribers.append(
                self.create_subscription(
                    PointCloud2,
                    topic,
                    lambda msg, robot_id=i: self._cloud_cb(robot_id, msg),
                    qos,
                )
            )

        self.get_logger().info(
            "PointCloud aggregator config: "
            f"num_robots={self.num_robots}, "
            f"input_topic_suffix={self.input_topic_suffix}, "
            f"target_frame={self.target_frame}, "
            f"output_topic={self.output_topic}, "
            f"publish_rate_hz={self.publish_rate_hz}"
        )
        self.get_logger().info(f"Subscribing to: {', '.join(topics)}")

        period = 1.0 / self.publish_rate_hz
        self.timer = self.create_timer(period, self._publish_merged)

    def _cloud_cb(self, robot_id: int, msg: PointCloud2) -> None:
        self.latest_clouds[robot_id] = msg
        if self.debug_logs:
            now_ns = self.get_clock().now().nanoseconds
            if now_ns - self.last_debug_ns > int(2e9):
                self.last_debug_ns = now_ns
                self.get_logger().info(
                    f"[rx] robot={robot_id} topic_frame={msg.header.frame_id} "
                    f"stamp={msg.header.stamp.sec}.{msg.header.stamp.nanosec:09d} "
                    f"size={msg.width}x{msg.height}"
                )

    def _is_stale(self, msg: PointCloud2) -> bool:
        stamp = Time.from_msg(msg.header.stamp)
        age_ns = (self.get_clock().now() - stamp).nanoseconds
        # During startup or clock transitions, age can be negative.
        # Treat those samples as fresh instead of discarding.
        if age_ns < 0:
            return False
        return age_ns > int(self.stale_timeout_sec * 1e9)

    def _resolve_source_frame(self, robot_id: int, frame_id: str) -> str:
        if not self.source_frame_from_topic_namespace:
            return frame_id
        if "/" in frame_id:
            return frame_id
        return f"tb3_{robot_id}/{frame_id}"

    @staticmethod
    def _rotate_vec_by_quat(
        x: float, y: float, z: float, qx: float, qy: float, qz: float, qw: float
    ) -> Tuple[float, float, float]:
        # Quaternion-vector multiplication optimized for point rotation.
        ix = qw * x + qy * z - qz * y
        iy = qw * y + qz * x - qx * z
        iz = qw * z + qx * y - qy * x
        iw = -qx * x - qy * y - qz * z

        rx = ix * qw + iw * -qx + iy * -qz - iz * -qy
        ry = iy * qw + iw * -qy + iz * -qx - ix * -qz
        rz = iz * qw + iw * -qz + ix * -qy - iy * -qx
        return rx, ry, rz

    def _transform_to_target_xyz(
        self, robot_id: int, msg: PointCloud2
    ) -> Optional[List[Tuple[float, float, float]]]:
        raw_src_frame = msg.header.frame_id
        src_frame = self._resolve_source_frame(robot_id, raw_src_frame)
        if not src_frame:
            return None

        msg_for_tf = msg
        if src_frame != raw_src_frame:
            msg_for_tf = PointCloud2()
            msg_for_tf.header = msg.header
            msg_for_tf.height = msg.height
            msg_for_tf.width = msg.width
            msg_for_tf.fields = msg.fields
            msg_for_tf.is_bigendian = msg.is_bigendian
            msg_for_tf.point_step = msg.point_step
            msg_for_tf.row_step = msg.row_step
            msg_for_tf.data = msg.data
            msg_for_tf.is_dense = msg.is_dense
            msg_for_tf.header.frame_id = src_frame

        points = self._cloud_to_xyz(msg_for_tf)
        if not points:
            return []

        if src_frame == self.target_frame:
            return points

        try:
            tf = self.tf_buffer.lookup_transform(
                self.target_frame,
                src_frame,
                Time.from_msg(msg_for_tf.header.stamp),
                timeout=Duration(seconds=0.05),
            )
            tx = tf.transform.translation.x
            ty = tf.transform.translation.y
            tz = tf.transform.translation.z
            qx = tf.transform.rotation.x
            qy = tf.transform.rotation.y
            qz = tf.transform.rotation.z
            qw = tf.transform.rotation.w

            transformed_points: List[Tuple[float, float, float]] = []
            for px, py, pz in points:
                rx, ry, rz = self._rotate_vec_by_quat(px, py, pz, qx, qy, qz, qw)
                transformed_points.append((rx + tx, ry + ty, rz + tz))
            return transformed_points
        except Exception as exc:
            if self.debug_logs:
                now_ns = self.get_clock().now().nanoseconds
                if now_ns - self.last_tf_debug_ns > int(2e9):
                    self.last_tf_debug_ns = now_ns
                    frames = self.tf_buffer.all_frames_as_yaml()
                    frame_preview = frames[:600].replace("\n", " | ")
                    self.get_logger().warn(
                        f"[tf] known frames preview: {frame_preview}"
                    )
                self.get_logger().warn(
                    f"[tf] failed transform {src_frame} (raw={raw_src_frame}) -> {self.target_frame}: {exc}"
                )
            return None

    def _cloud_to_xyz(self, cloud: PointCloud2) -> List[Tuple[float, float, float]]:
        points: List[Tuple[float, float, float]] = []
        for p in point_cloud2.read_points(
            cloud,
            field_names=("x", "y", "z"),
            skip_nans=True,
        ):
            x = float(p[0])
            y = float(p[1])
            z = float(p[2])
            if math.isfinite(x) and math.isfinite(y) and math.isfinite(z):
                points.append((x, y, z))
        return points

    def _publish_merged(self) -> None:
        merged_xyz: List[Tuple[float, float, float]] = []
        now = self.get_clock().now().to_msg()
        used_any = False
        self.publish_cycles += 1
        stale_count = 0
        tf_fail_count = 0
        point_count_by_robot: Dict[int, int] = {}

        for rid, msg in self.latest_clouds.items():
            if self.debug_logs and self.publish_cycles % 16 == 0:
                stamp = Time.from_msg(msg.header.stamp)
                age_ns = (self.get_clock().now() - stamp).nanoseconds
                self.get_logger().info(
                    f"[cycle] robot={rid} frame={msg.header.frame_id} age_ns={age_ns}"
                )
            if self._is_stale(msg):
                stale_count += 1
                continue

            transformed_points = self._transform_to_target_xyz(rid, msg)
            if transformed_points is None:
                tf_fail_count += 1
                continue

            used_any = True
            point_count_by_robot[rid] = len(transformed_points)
            merged_xyz.extend(transformed_points)

        if not used_any or not merged_xyz:
            if self.debug_logs and self.publish_cycles % 16 == 0:
                source_frames = {
                    rid: msg.header.frame_id for rid, msg in self.latest_clouds.items()
                }
                self.get_logger().warn(
                    "[publish] skipped "
                    f"used_any={used_any} merged_points={len(merged_xyz)} "
                    f"cached_clouds={len(self.latest_clouds)} stale={stale_count} "
                    f"tf_fail={tf_fail_count} target_frame={self.target_frame} "
                    f"source_frames={source_frames}"
                )
            return

        header = PointCloud2().header
        header.frame_id = self.target_frame
        header.stamp = now
        merged_cloud = point_cloud2.create_cloud_xyz32(header, merged_xyz)
        self.publisher.publish(merged_cloud)
        if self.debug_logs and self.publish_cycles % 8 == 0:
            self.get_logger().info(
                "[publish] merged "
                f"robots={len(point_count_by_robot)} total_points={len(merged_xyz)} "
                f"per_robot={point_count_by_robot} target_frame={self.target_frame}"
            )


def main(args=None) -> None:
    rclpy.init(args=args)
    node = PointCloudAggregator()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
