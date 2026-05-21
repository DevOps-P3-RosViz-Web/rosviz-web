#!/bin/bash
# Launch TurtleBot3 Ignition Gazebo simulation with ROS 2 bridges
#
# Usage:
#   cd rosviz-web
#   bash simulation/launch_all.sh
#
# Prerequisites:
#   - ROS 2 Humble sourced
#   - ros_gz_bridge, rosbridge_suite, robot_state_publisher available
#   - Ignition Gazebo Fortress installed
#   - Python image_compressor deps: pip3 install opencv-python numpy

set -e # Not -u to allow unset env vars like TURTLEBOT3_MODEL and not -o to allow pipefail since some commands may not output anything

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Source ROS 2 — edit this if your workspace is elsewhere
if [ -f /opt/ros/humble/setup.bash ]; then
    source /opt/ros/humble/setup.bash
else
    echo "ERROR: ROS 2 not installed in this environment"
    exit 1
fi

# Source TurtleBot3 workspace if it exists (for URDFs and models)
if [ -f ~/turtlebot3_ws/install/setup.bash ]; then
    source ~/turtlebot3_ws/install/setup.bash
fi

# Set Ignition Gazebo resource path so it finds the turtlebot3_waffle model
export IGN_GAZEBO_RESOURCE_PATH="$SCRIPT_DIR/models:${IGN_GAZEBO_RESOURCE_PATH:-}"

# Kill any existing processes
echo "Cleaning up existing processes..."
pkill -f "ign gazebo" 2>/dev/null || true
pkill -f "parameter_bridge" 2>/dev/null || true
pkill -f "robot_state_publisher" 2>/dev/null || true
pkill -f "rosbridge_websocket" 2>/dev/null || true
pkill -f "image_compressor" 2>/dev/null || true
sleep 2

NUM_ROBOTS=${NUM_ROBOTS:-2}
WORLD_FILE="/tmp/turtlebot3_world.generated.sdf"

# 0 Generate robots and world
echo "Generating $NUM_ROBOTS robot model folders..."
bash "$SCRIPT_DIR/models/generate_robots.sh" "$NUM_ROBOTS"
bash "$SCRIPT_DIR/worlds/generate_world.sh" "$NUM_ROBOTS" "$WORLD_FILE"


# 1. Ignition Gazebo (headless server)
echo "[1/6] Starting Ignition Gazebo (headless)..."
ign gazebo -s -r "$WORLD_FILE" &
IGN_PID=$!
sleep 5

if ! kill -0 $IGN_PID 2>/dev/null; then
    echo "ERROR: Ignition Gazebo failed to start!"
    exit 1
fi
echo "  Ignition Gazebo running (PID: $IGN_PID)"

# 2. ros_gz_bridge - one set of topics per robots
echo "[2/6] Starting ros_gz_bridge..."
# Command to start the topics for a single robot
# ros2 run ros_gz_bridge parameter_bridge \
#     /cmd_vel@geometry_msgs/msg/Twist]ignition.msgs.Twist \
#     /odom@nav_msgs/msg/Odometry[ignition.msgs.Odometry \
#     /tf@tf2_msgs/msg/TFMessage[ignition.msgs.Pose_V \
#     /scan@sensor_msgs/msg/LaserScan[ignition.msgs.LaserScan \
#     /imu@sensor_msgs/msg/Imu[ignition.msgs.IMU \
#     /camera/image_raw@sensor_msgs/msg/Image[ignition.msgs.Image \
#     /joint_states@sensor_msgs/msg/JointState[ignition.msgs.Model \
#     /scan/points@sensor_msgs/msg/PointCloud2[ignition.msgs.PointCloudPacked &
# BRIDGE_PID=$!

BRIDGE_ARGS=()
BRIDGE_REMAP_ARGS=()
BRIDGE_ARGS+=("/clock@rosgraph_msgs/msg/Clock[ignition.msgs.Clock")
for i in $(seq 0 $((NUM_ROBOTS-1))); do
    BRIDGE_ARGS+=(
        "/tb3_$i/cmd_vel@geometry_msgs/msg/Twist]ignition.msgs.Twist"
        "/tb3_$i/odom@nav_msgs/msg/Odometry[ignition.msgs.Odometry"
        "/tb3_$i/tf@tf2_msgs/msg/TFMessage[ignition.msgs.Pose_V"
        "/tb3_$i/scan@sensor_msgs/msg/LaserScan[ignition.msgs.LaserScan"
        "/tb3_$i/imu@sensor_msgs/msg/Imu[ignition.msgs.IMU"
        "/tb3_$i/camera/image_raw@sensor_msgs/msg/Image[ignition.msgs.Image"
        "/tb3_$i/joint_states@sensor_msgs/msg/JointState[ignition.msgs.Model"
        "/tb3_$i/scan/points@sensor_msgs/msg/PointCloud2[ignition.msgs.PointCloudPacked"
    )
    BRIDGE_REMAP_ARGS+=(-r "/tb3_$i/tf:=/tf")
done

ros2 run ros_gz_bridge parameter_bridge "${BRIDGE_ARGS[@]}" --ros-args "${BRIDGE_REMAP_ARGS[@]}" &
BRIDGE_PID=$!

sleep 3
echo "  ros_gz_bridge running (PID: $BRIDGE_PID)"

# 3. Image compressor (raw → JPEG for the browser)
echo "[3/6] Starting image compressor..."
# python3 "$PROJECT_DIR/scripts/image_compressor.py" &
NUM_ROBOTS=$NUM_ROBOTS python3 "$PROJECT_DIR/scripts/image_compressor.py" &
COMPRESSOR_PID=$!
sleep 1
echo "  Image compressor running (PID: $COMPRESSOR_PID)"

# 3.5 Point cloud aggregator
echo "[3.5/6] Starting point cloud aggregator..."
python3 "$PROJECT_DIR/scripts/pointcloud_aggregator.py" \
    --ros-args \
    -p use_sim_time:=true \
    -p num_robots:=$NUM_ROBOTS \
    -p input_topic_suffix:=/scan/points \
    -p target_frame:=world \
    -p output_topic:=/common/scan/points \
    -p publish_rate_hz:=8.0 &
AGGREGATOR_PID=$!
sleep 1
echo "  Point cloud aggregator running (PID: $AGGREGATOR_PID)"

# 4. Robot state publisher
echo "[4/6] Starting robot_state_publisher..."
URDF_FILE=""
# Try common URDF locations
for path in \
    ~/turtlebot3_ws/install/turtlebot3_gazebo/share/turtlebot3_gazebo/urdf/turtlebot3_waffle.urdf \
    /opt/ros/humble/share/turtlebot3_gazebo/urdf/turtlebot3_waffle.urdf \
    ~/turtlebot3_ws/install/turtlebot3_description/share/turtlebot3_description/urdf/turtlebot3_waffle.urdf; do
    if [ -f "$path" ]; then
        URDF_FILE="$path"
        break
    fi
done

if [ -n "$URDF_FILE" ]; then
    RSP_PIDS=()
    for i in $(seq 0 $((NUM_ROBOTS-1))); do
        ROBOT_DESC="$(xacro "$URDF_FILE" namespace:=tb3_${i}/ 2>/dev/null || true)"
        if [ -z "$ROBOT_DESC" ]; then
            echo "  WARNING: xacro expansion failed for tb3_$i, falling back to raw URDF"
            ROBOT_DESC="$(cat "$URDF_FILE")"
        fi
        ros2 run robot_state_publisher robot_state_publisher \
            --ros-args -r __node:=rsp_tb3_$i \
                       -r __ns:=/tb3_$i \
                       -r /tf:=/tf \
                       -r /tf_static:=/tf_static \
                       -p "robot_description:=$ROBOT_DESC" &
        RSP_PIDS+=($!)
    done
    sleep 1
    echo "  $NUM_ROBOTS robot_state_publisher instances running"
else
    echo "  WARNING: TurtleBot3 URDF not found — 3D model viewer will not work"
fi

# 5. rosbridge WebSocket server
echo "[5/6] Starting rosbridge_websocket on port 9090..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &
ROSBRIDGE_PID=$!
sleep 2
echo "  rosbridge running (PID: $ROSBRIDGE_PID)"

# 6. Summary
echo ""
echo "============================================"
echo "  ROSViz Web — Simulation Stack Running"
echo "============================================"
echo ""
echo "  Ignition Gazebo:      PID $IGN_PID"
echo "  ros_gz_bridge:        PID $BRIDGE_PID"
echo "  Image compressor:     PID $COMPRESSOR_PID"
echo "  Point cloud aggregate: PID $AGGREGATOR_PID"
[ ${#RSP_PIDS[@]:-0} -gt 0 ] && echo "  robot_state_publisher: ${RSP_PIDS[*]}"
echo "  rosbridge:            PID $ROSBRIDGE_PID"
echo ""
echo "ROS 2 topics:"
ros2 topic list 2>/dev/null || true
echo ""
echo "Now run the dashboard:  npm run dev"
echo "Open http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all processes"

# Cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $ROSBRIDGE_PID 2>/dev/null || true
    if [ ${#RSP_PIDS[@]:-0} -gt 0 ]; then
        kill "${RSP_PIDS[@]}" 2>/dev/null || true
    fi
    kill $AGGREGATOR_PID 2>/dev/null || true
    kill $COMPRESSOR_PID 2>/dev/null || true
    kill $BRIDGE_PID 2>/dev/null || true
    kill $IGN_PID 2>/dev/null || true
    wait 2>/dev/null
    echo "All processes stopped."
}
trap cleanup EXIT INT TERM

wait
