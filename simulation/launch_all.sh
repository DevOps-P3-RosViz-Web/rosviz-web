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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Source ROS 2 — edit this if your workspace is elsewhere
source /opt/ros/humble/setup.bash
if [ -f ~/turtlebot3_ws/install/setup.bash ]; then
    source ~/turtlebot3_ws/install/setup.bash
fi

# Set Ignition Gazebo resource path so it finds the turtlebot3_waffle model
export IGN_GAZEBO_RESOURCE_PATH="$SCRIPT_DIR/models/generated:${IGN_GAZEBO_RESOURCE_PATH:-}"

parse_robot_ids() {
    local -a ids=()
    local raw_ids="${ROBOT_IDS:-}"
    local count="${NUM_ROBOTS:-2}"

    if [ -n "$raw_ids" ]; then
        IFS=',' read -r -a ids <<< "$raw_ids"
    else
        for i in $(seq 0 $((count - 1))); do
            ids+=("tb3_$i")
        done
    fi

    if [ "${#ids[@]}" -eq 0 ]; then
        echo "ERROR: no robot IDs found" >&2
        exit 1
    fi

    for id in "${ids[@]}"; do
        if [[ ! "$id" =~ ^[A-Za-z0-9_]+$ ]]; then
            echo "ERROR: invalid robot ID '$id' (allowed: letters, numbers, _)" >&2
            exit 1
        fi
    done

    echo "${ids[@]}"
}

read -r -a ROBOT_ID_ARRAY <<< "$(parse_robot_ids)"
NUM_ROBOTS="${#ROBOT_ID_ARRAY[@]}"
ROBOT_IDS="$(IFS=,; echo "${ROBOT_ID_ARRAY[*]}")"
export NUM_ROBOTS
export ROBOT_IDS
RSP_PIDS=()

# Kill any existing processes
echo "Cleaning up existing processes..."
pkill -f "ign gazebo" 2>/dev/null || true
pkill -f "parameter_bridge" 2>/dev/null || true
pkill -f "robot_state_publisher" 2>/dev/null || true
pkill -f "rosbridge_websocket" 2>/dev/null || true
pkill -f "image_compressor" 2>/dev/null || true
sleep 2

# 0 Generate robots
echo "Generating $NUM_ROBOTS robot model folders..."
bash "$SCRIPT_DIR/models/generate_robots.sh"
bash "$SCRIPT_DIR/worlds/generate_world.sh"
WORLD_FILE="$SCRIPT_DIR/worlds/generated/turtlebot3_world.sdf"


# 1. Ignition Gazebo (headless server)
echo "[1/6] Starting Ignition Gazebo (headless)..."
ign gazebo -s -r "$WORLD_FILE" &
IGN_PID=$! # Get the PID of the Gazebo server
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

BRIDGE_ARGS=""
for robot_id in "${ROBOT_ID_ARRAY[@]}"; do
    BRIDGE_ARGS="$BRIDGE_ARGS \
        /${robot_id}/cmd_vel@geometry_msgs/msg/Twist]ignition.msgs.Twist \
        /${robot_id}/odom@nav_msgs/msg/Odometry[ignition.msgs.Odometry \
        /${robot_id}/tf@tf2_msgs/msg/TFMessage[ignition.msgs.Pose_V \
        /${robot_id}/scan@sensor_msgs/msg/LaserScan[ignition.msgs.LaserScan \
        /${robot_id}/imu@sensor_msgs/msg/Imu[ignition.msgs.IMU \
        /${robot_id}/camera/image_raw@sensor_msgs/msg/Image[ignition.msgs.Image \
        /${robot_id}/joint_states@sensor_msgs/msg/JointState[ignition.msgs.Model"
done

ros2 run ros_gz_bridge parameter_bridge $BRIDGE_ARGS &
BRIDGE_PID=$!  # Get the PID of the last background process (the bridge)

sleep 3
echo "  ros_gz_bridge running (PID: $BRIDGE_PID)"

# 3. Image compressor (raw → JPEG for the browser)
echo "[3/6] Starting image compressor..."
# python3 "$PROJECT_DIR/scripts/image_compressor.py" &
NUM_ROBOTS=$NUM_ROBOTS python3 "$PROJECT_DIR/scripts/image_compressor.py" &
COMPRESSOR_PID=$! # Get the PID of the image compressor
sleep 1
echo "  Image compressor running (PID: $COMPRESSOR_PID)"

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
    for robot_id in "${ROBOT_ID_ARRAY[@]}"; do
        ros2 run robot_state_publisher robot_state_publisher \
            --ros-args -r __node:=rsp_${robot_id} \
                       -r __ns:=/${robot_id} \
                       -p frame_prefix:=${robot_id}/ \
            -- "$URDF_FILE" &
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
[ "${#RSP_PIDS[@]}" -gt 0 ] && echo "  robot_state_publisher: PIDs ${RSP_PIDS[*]}"
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
    [ "${#RSP_PIDS[@]}" -gt 0 ] && kill "${RSP_PIDS[@]}" 2>/dev/null || true
    kill $COMPRESSOR_PID 2>/dev/null || true
    kill $BRIDGE_PID 2>/dev/null || true
    kill $IGN_PID 2>/dev/null || true
    wait 2>/dev/null
    echo "All processes stopped."
}
trap cleanup EXIT INT TERM

wait
