#!/usr/bin/env python3
"""Publish synthetic alert messages to /robot_alerts for pipeline testing.

Usage:
  # Inject one specific alert type
  python3 inject_test_alerts.py --type COLLISION --robot-id 0

  # Inject all 8 alert types for robot 1
  python3 inject_test_alerts.py --all --robot-id 1

  # Override severity
  python3 inject_test_alerts.py --type LOW_BATTERY --severity critical

  # Test history hydration (reconnect path) — publishes to /robot_alerts_history
  python3 inject_test_alerts.py --all --history

  # Inside the container
  docker exec rosviz-ros python3 /ros_ws/scripts/inject_test_alerts.py --all
  docker exec rosviz-ros python3 /ros_ws/scripts/inject_test_alerts.py --all --history
"""

import argparse
import json
import time
import uuid

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

ALERT_TYPES = {
    'COLLISION':         ('critical', 0.18, 0.26),
    'VELOCITY_EXCEEDED': ('warning',  0.62, 0.50),
    'CONNECTION_LOSS':   ('critical', 6.0,  5.0),
    'LOW_BATTERY':       ('warning',  15.0, 20.0),
    'IMPACT_DETECTED':   ('warning',  9.5,  8.0),
    'TILT_WARNING':      ('critical', 25.0, 20.0),
    'MOTOR_STALL':       ('warning',  0.0,  0.1),
    'GEOFENCE_BREACH':   ('critical', 6.2,  5.0),
}

MESSAGES = {
    'COLLISION':         'Obstacle detected in forward arc',
    'VELOCITY_EXCEEDED': 'Linear velocity limit exceeded',
    'CONNECTION_LOSS':   'No sensor data received — connection lost',
    'LOW_BATTERY':       'Battery charge critically low',
    'IMPACT_DETECTED':   'High horizontal acceleration spike',
    'TILT_WARNING':      'Roll/pitch angle exceeds safe limit',
    'MOTOR_STALL':       'Wheels stalled under active drive command',
    'GEOFENCE_BREACH':   'Robot outside permitted operating area',
}


def make_alert(alert_type: str, robot_id: int, severity: str | None = None) -> dict:
    default_sev, value, threshold = ALERT_TYPES[alert_type]
    return {
        'id': str(uuid.uuid4()),
        'robot_id': robot_id,
        'alert_type': alert_type,
        'severity': severity or default_sev,
        'message': MESSAGES[alert_type],
        'value': value,
        'threshold': threshold,
        'timestamp': time.time(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description='Inject synthetic alerts into /robot_alerts')
    parser.add_argument('--type', choices=list(ALERT_TYPES), help='Alert type to inject')
    parser.add_argument('--robot-id', type=int, default=0, metavar='ID', help='Robot ID (default: 0)')
    parser.add_argument('--severity', choices=['critical', 'warning'], help='Override default severity')
    parser.add_argument('--all', action='store_true', dest='all_types', help='Inject one of each type')
    parser.add_argument('--history', action='store_true',
                        help='Publish a JSON array to /robot_alerts_history (tests reconnect hydration)')
    args = parser.parse_args()

    if not args.all_types and not args.type:
        parser.error('Provide --type <TYPE> or --all')

    rclpy.init()
    node = Node('inject_test_alerts')
    topic = '/robot_alerts_history' if args.history else '/robot_alerts'
    pub = node.create_publisher(String, topic, 10)

    # Give rosbridge time to pick up the new publisher
    time.sleep(0.5)

    types_to_send = list(ALERT_TYPES) if args.all_types else [args.type]

    if args.history:
        # Publish all alerts as a single JSON array — matches the format of _publish_history
        alerts = [make_alert(t, args.robot_id, args.severity) for t in types_to_send]
        msg = String()
        msg.data = json.dumps(alerts)
        pub.publish(msg)
        node.get_logger().info(
            f'Injected {len(alerts)} alerts into {topic} (history hydration test)'
        )
    else:
        for alert_type in types_to_send:
            alert = make_alert(alert_type, args.robot_id, args.severity)
            msg = String()
            msg.data = json.dumps(alert)
            pub.publish(msg)
            node.get_logger().info(f'Injected {alert_type} (robot {args.robot_id}, {alert["severity"]})')
            if args.all_types:
                time.sleep(0.1)

    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
