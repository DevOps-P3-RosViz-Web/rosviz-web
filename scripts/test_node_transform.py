#!/usr/bin/env python3
from typing import Dict

import rclpy
import tf2_ros
from rclpy.clock import Clock, ClockType
from rclpy.duration import Duration
from rclpy.node import Node
from rclpy.time import Time
from sensor_msgs.msg import PointCloud2

from debug_utils import DebugLogger


class SimpleTFTest(Node):

    def __init__(self):

        super().__init__("simple_tf_test")

        self.declare_parameter("num_robots", 3)
        self.declare_parameter("input_topic_suffix", "/scan/points")
        self.declare_parameter("target_frame", "world")
        self.declare_parameter("output_topic", "/common/scan/points")
        self.declare_parameter("publish_rate_hz", 8.0)
        self.declare_parameter("stale_timeout_sec", 1.0)
        self.declare_parameter("debug_logs", True)

        self.num_robots = int(
            self.get_parameter("num_robots").value
        )

        self.input_topic_suffix = str(
            self.get_parameter("input_topic_suffix").value
        )

        self.target_frame = str(
            self.get_parameter("target_frame").value
        )

        self.output_topic = str(
            self.get_parameter("output_topic").value
        )

        self.publish_rate_hz = float(
            self.get_parameter("publish_rate_hz").value
        )

        self.stale_timeout_sec = float(
            self.get_parameter("stale_timeout_sec").value
        )

        self.debug_logs = bool(
            self.get_parameter("debug_logs").value
        )

        if not self.input_topic_suffix.startswith("/"):
            raise ValueError(
                f"input_topic_suffix must start with '/', got {self.input_topic_suffix}"
            )

        if self.publish_rate_hz <= 0:
            raise ValueError(
                f"publish_rate_hz must be > 0, got {self.publish_rate_hz}")

        self.debug_logger = DebugLogger(
            enabled=self.debug_logs,
        )

        self.tf_buffer = tf2_ros.Buffer(
            cache_time=Duration(seconds=10.0),
        )

        self.tf_listener = tf2_ros.TransformListener(
            self.tf_buffer,
            self,
            spin_thread=True,
        )

        self.debug_logger.info(
            logger=self.get_logger(),
            message="[tf] TransformListener initialized"
        )

        self.timer_clock = Clock(
            clock_type=ClockType.STEADY_TIME,
        )

        self.timer = self.create_timer(
            1.0,
            self._tick,
            clock=self.timer_clock,
        )

        self.debug_logger.info(
            logger=self.get_logger(),
            message="[timer] created period=1.0"
        )

        self.latest_clouds_by_robot_id: Dict[int, PointCloud2] = {}

        self.publish_cycles = 0

        self._subscriptions = []

        self.debug_logger.info(
            logger=self.get_logger(),
            message=f"PointCloud aggregator config: num_robots={self.num_robots}"
        )

    def _tick(self):

        self.debug_logger.info(
            logger=self.get_logger(),
            message="[tick] starting lookup"
        )

        try:

            transform = self.tf_buffer.lookup_transform(
                "world",
                "tb3_0/base_scan",
                Time(),
                timeout=Duration(seconds=5.0),
            )

            self.debug_logger.info(
                logger=self.get_logger(),
                message="SUCCESS"
            )

            self.debug_logger.info(
                logger=self.get_logger(),
                message=str(transform)
            )

        except Exception as exc:

            self.debug_logger.error(
                logger=self.get_logger(),
                message=f"FAILED: {exc}"
            )

            self.debug_logger.error(
                logger=self.get_logger(),
                message=self.tf_buffer.all_frames_as_yaml()
            )


def main(args=None) -> None:
    rclpy.init(args=args)

    node = SimpleTFTest()

    try:
        rclpy.spin(node)

    finally:
        node.destroy_node()

        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
