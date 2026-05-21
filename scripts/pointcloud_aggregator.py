#!/usr/bin/env python3

from collections import deque
from typing import Deque, Dict, List, Optional, Tuple

import rclpy
import tf2_ros
from rclpy.clock import Clock, ClockType
from rclpy.duration import Duration
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import QoSHistoryPolicy, QoSProfile, QoSReliabilityPolicy, \
    qos_profile_sensor_data, DurabilityPolicy, ReliabilityPolicy
from rclpy.time import Time
from sensor_msgs.msg import PointCloud2
from sensor_msgs_py import point_cloud2
from tf2_msgs.msg import TFMessage
from tf2_ros import ConnectivityException, ExtrapolationException, \
    LookupException, TransformException
from tf2_sensor_msgs.tf2_sensor_msgs import do_transform_cloud

from debug_utils import DebugLogger


class PointCloudAggregator(Node):

    def __init__(self) -> None:

        super().__init__("pointcloud_aggregator")

        self.declare_parameter("num_robots", 3)
        self.declare_parameter("input_topic_suffix", "/scan/points")
        self.declare_parameter("target_frame", "world")
        self.declare_parameter("output_topic", "/common/scan/points")
        self.declare_parameter("publish_rate_hz", 8.0)
        self.declare_parameter("stale_timeout_sec", 4.0)
        self.declare_parameter("transform_timeout_sec", 0.25)
        self.declare_parameter("queue_size_per_robot", 32)
        self.declare_parameter("debug_logs", True)

        self.num_robots = int(self.get_parameter("num_robots").value)
        self.input_topic_suffix = str(
            self.get_parameter("input_topic_suffix").value)
        self.target_frame = str(self.get_parameter("target_frame").value)
        self.output_topic = str(self.get_parameter("output_topic").value)
        self.publish_rate_hz = float(
            self.get_parameter("publish_rate_hz").value)
        self.stale_timeout_sec = float(
            self.get_parameter("stale_timeout_sec").value)
        self.transform_timeout_sec = float(
            self.get_parameter("transform_timeout_sec").value)
        self.queue_size_per_robot = int(
            self.get_parameter("queue_size_per_robot").value)
        self.debug_logs = bool(self.get_parameter("debug_logs").value)

        self.debug_logger = DebugLogger(enabled=self.debug_logs)

        self.tf_buffer = tf2_ros.Buffer(
            cache_time=Duration(seconds=60.0),
            # node=self
        )
        #
        # self.tf_listener = tf2_ros.TransformListener(
        #     self.tf_buffer, self, spin_thread=True
        # )

        self.pending_clouds_by_robot_id: Dict[int, Deque[PointCloud2]] = {
            robot_id: deque(maxlen=self.queue_size_per_robot)
            for robot_id in range(self.num_robots)
        }

        self.publish_cycles = 0

        self._subscriptions = [
            self.create_subscription(
                PointCloud2,
                f"/tb3_{robot_id}{self.input_topic_suffix}",
                lambda msg, rid=robot_id: self._handle_point_cloud_message(rid,
                                                                           msg),
                qos_profile_sensor_data,
            )
            for robot_id in range(self.num_robots)
        ]

        self.sub_tf = self.create_subscription(
            TFMessage,
            "/tf",
            self._debug_tf,
            100
        )

        tf_static_qos = QoSProfile(
            history=QoSHistoryPolicy.KEEP_LAST,
            depth=10,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
            reliability=ReliabilityPolicy.RELIABLE,
        )

        self.sub_static = self.create_subscription(
            TFMessage,
            "/tf_static",
            self._debug_tf_static,
            tf_static_qos
        )

        publisher_qos = QoSProfile(reliability=QoSReliabilityPolicy.BEST_EFFORT,
                                   history=QoSHistoryPolicy.KEEP_LAST, depth=5)

        self.publisher = self.create_publisher(PointCloud2, self.output_topic,
                                               publisher_qos)

        self.timer_clock = Clock(clock_type=ClockType.STEADY_TIME)

        self.timer = self.create_timer(
            1.0 / self.publish_rate_hz,
            self._publish_merged,
            clock=self.timer_clock
        )

        self.debug_logger.info(
            logger=self.get_logger(),
            message=f"[init] PointCloudAggregator num_robots={self.num_robots} target_frame={self.target_frame} publish_rate_hz={self.publish_rate_hz} transform_timeout_sec={self.transform_timeout_sec} queue_size_per_robot={self.queue_size_per_robot}",
        )

    def _debug_tf(self, msg):

        for t in msg.transforms:
            self.tf_buffer.set_transform(
                t,
                "default_authority"
            )

            # self.get_logger().info(
            #     f"##########3 TF: parent='{t.header.frame_id}' "
            #     f"child='{t.child_frame_id}' "
            #     f"stamp={t.header.stamp.sec}.{t.header.stamp.nanosec}"
            # )

    def _debug_tf_static(self, msg):

        # self.get_logger().info(
        #     f"STATIC TF COUNT={len(msg.transforms)}"
        # )

        for t in msg.transforms:
            self.tf_buffer.set_transform_static(
                t,
                "default_authority"
            )

            # self.get_logger().info(
            #     f"STATIC parent='{t.header.frame_id}' "
            #     f"child='{t.child_frame_id}'"
            # )

    def _handle_point_cloud_message(self, robot_id: int,
                                    msg: PointCloud2) -> None:

        self.pending_clouds_by_robot_id[robot_id].append(msg)

        self.debug_logger.throttled_info(
            logger=self.get_logger(),
            key=f"rx_{robot_id}",
            throttle_sec=2.0,
            message=f"[rx] robot={robot_id} frame={msg.header.frame_id} stamp={msg.header.stamp.sec}.{msg.header.stamp.nanosec:09d} size={msg.width}x{msg.height} queued={len(self.pending_clouds_by_robot_id[robot_id])}",
        )

    def _is_stale(self, msg: PointCloud2) -> bool:

        msg_time = Time.from_msg(msg.header.stamp)

        now = self.get_clock().now()

        age_ns = (now - msg_time).nanoseconds

        if age_ns < 0:
            return False

        return age_ns > int(self.stale_timeout_sec * 1e9)

    def _lookup_transform(self, source_frame: str, stamp: Time) -> Optional[
        tf2_ros.TransformStamped]:

        try:
            return self.tf_buffer.lookup_transform(
                self.target_frame,
                source_frame,
                stamp,
                timeout=Duration(seconds=0.0)
                # timeout=Duration(seconds=self.transform_timeout_sec)
            )

        except (LookupException, ConnectivityException, ExtrapolationException,
                TransformException):
            return None

    def _transform_cloud_to_target(self, msg: PointCloud2) -> Optional[
        PointCloud2]:

        source_frame = msg.header.frame_id

        if not source_frame:
            return None

        if source_frame == self.target_frame:
            return msg

        cloud_stamp = Time.from_msg(msg.header.stamp)

        transform = self._lookup_transform(source_frame, cloud_stamp)

        if transform is None:
            return None

        try:

            #
            # CLEAN XYZ-ONLY CLOUD
            #
            # tf2_sensor_msgs has issues with some structured dtypes
            # produced by Gazebo/LiDAR plugins.
            #

            xyz_points = list(
                point_cloud2.read_points(
                    msg,
                    field_names=("x", "y", "z"),
                    skip_nans=True,
                )
            )

            clean_cloud = point_cloud2.create_cloud_xyz32(
                msg.header,
                xyz_points,
            )

            transformed_cloud = do_transform_cloud(
                clean_cloud,
                transform,
            )

            transformed_cloud.header.frame_id = self.target_frame

            return transformed_cloud

        except Exception as exc:

            self.debug_logger.throttled_warn(
                logger=self.get_logger(),
                key=f"transform_apply_fail_{source_frame}",
                throttle_sec=2.0,
                message=f"[tf] failed applying transform {source_frame} -> {self.target_frame}: {exc}",
            )

            return None

    @staticmethod
    def _cloud_to_xyz(cloud: PointCloud2) -> List[Tuple[float, float, float]]:

        return [
            (float(point[0]), float(point[1]), float(point[2]))
            for point in
            point_cloud2.read_points(
                cloud, field_names=("x", "y", "z"), skip_nans=True
            )
        ]

    def _publish_merged(self) -> None:

        self.publish_cycles += 1

        try:
            frames = self.tf_buffer.all_frames_as_string()
            self.get_logger().info(f"[tf] known frames:\n{frames}")
        except Exception as exc:
            self.get_logger().warn(f"[tf] could not list frames: {exc}")

        merged_xyz: List[Tuple[float, float, float]] = []

        stale_count = 0
        tf_waiting_count = 0
        processed_count = 0

        point_count_by_robot: Dict[int, int] = {}

        for robot_id, queue in self.pending_clouds_by_robot_id.items():

            while queue:

                msg = queue[0]

                if self._is_stale(msg):
                    queue.popleft()

                    stale_count += 1

                    continue

                transformed_cloud = self._transform_cloud_to_target(msg)

                if transformed_cloud is None:
                    tf_waiting_count += 1
                    break

                queue.popleft()

                points = self._cloud_to_xyz(transformed_cloud)

                if not points:
                    continue

                processed_count += 1

                point_count_by_robot[robot_id] = point_count_by_robot.get(
                    robot_id, 0) + len(points)

                merged_xyz.extend(points)

        if not merged_xyz:
            self.debug_logger.throttled_warn(
                logger=self.get_logger(),
                key="publish_skipped",
                throttle_sec=2.0,
                message=f"[publish] skipped tf_waiting={tf_waiting_count} stale={stale_count} processed={processed_count}",
            )

            return

        header = PointCloud2().header
        header.frame_id = self.target_frame
        header.stamp = self.get_clock().now().to_msg()

        merged_cloud = point_cloud2.create_cloud_xyz32(header, merged_xyz)

        self.publisher.publish(merged_cloud)

        if self.debug_logger.every_n(self.publish_cycles, 8):
            queue_sizes = {robot_id: len(queue) for robot_id, queue in
                           self.pending_clouds_by_robot_id.items()}

            self.debug_logger.info(
                logger=self.get_logger(),
                message=f"[publish] merged robots={len(point_count_by_robot)} total_points={len(merged_xyz)} per_robot={point_count_by_robot} queue_sizes={queue_sizes} stale={stale_count} tf_waiting={tf_waiting_count}",
            )


# def main(args=None) -> None:
#     rclpy.init(args=args)
#
#     node = PointCloudAggregator()
#
#     try:
#         rclpy.spin(node)
#
#     finally:
#         node.destroy_node()
#
#         if rclpy.ok():
#             rclpy.shutdown()

def main(args=None):
    rclpy.init(args=args)

    node = PointCloudAggregator()

    executor = MultiThreadedExecutor(num_threads=4)

    executor.add_node(node)

    try:
        executor.spin()

    finally:
        executor.shutdown()
        node.destroy_node()

        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
