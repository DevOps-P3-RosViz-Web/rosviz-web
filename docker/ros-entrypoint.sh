#!/bin/bash
set -euo pipefail
source /opt/ros/humble/setup.bash

parse_robot_ids() {
    local -a ids=()
    local raw_ids="${ROBOT_IDS:-}"
    local count="${NUM_ROBOTS:-3}"

    if [ -n "$raw_ids" ]; then
        IFS=',' read -r -a ids <<< "$raw_ids"
    else
        for i in $(seq 0 $((count - 1))); do
            ids+=("tb3_$i")
        done
    fi

    if [ "${#ids[@]}" -eq 0 ]; then
        echo "[entrypoint] ERROR: no robot IDs found" >&2
        exit 1
    fi

    for id in "${ids[@]}"; do
        if [[ ! "$id" =~ ^[A-Za-z0-9_]+$ ]]; then
            echo "[entrypoint] ERROR: invalid robot ID '$id' (allowed: letters, numbers, _)" >&2
            exit 1
        fi
    done

    echo "${ids[@]}"
}

read -r -a ROBOT_ID_ARRAY <<< "$(parse_robot_ids)"
export NUM_ROBOTS="${#ROBOT_ID_ARRAY[@]}"
export ROBOT_IDS="$(IFS=,; echo "${ROBOT_ID_ARRAY[*]}")"

# ── Multi-robot config ──
export IGN_GAZEBO_RESOURCE_PATH="/ros_ws/simulation/models/generated:${IGN_GAZEBO_RESOURCE_PATH:-}"

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  ROSViz Web — ROS Stack                     │"
echo "  │  Robots   : $NUM_ROBOTS x TurtleBot3 $TURTLEBOT3_MODEL          │"
echo "  │  IDs      : $ROBOT_IDS"
echo "  └─────────────────────────────────────────────┘"
echo ""

PIDS=()
cleanup() {
    echo "[entrypoint] Shutting down..."
    for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
    wait
}
trap cleanup SIGINT SIGTERM EXIT

# ── 0. Generate per-robot model folders ──
echo "[entrypoint] Generating $NUM_ROBOTS robot model folders..."
bash /ros_ws/simulation/models/generate_robots.sh
bash /ros_ws/simulation/worlds/generate_world.sh
WORLD_FILE="/ros_ws/simulation/worlds/generated/turtlebot3_world.sdf"

# ── 1. Ignition Gazebo ──
echo "[entrypoint] Starting Ignition Gazebo (headless)..."
ign gazebo -s -r "$WORLD_FILE" &
PIDS+=($!)
sleep 5

# ── 2. ros_gz_bridge — namespaced per robot ──
echo "[entrypoint] Starting ros_gz_bridge..."
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
PIDS+=($!)
sleep 2

# ── 3. robot_state_publisher — one per robot ──
echo "[entrypoint] Starting robot_state_publisher x $NUM_ROBOTS..."
URDF_FILE="/opt/ros/humble/share/turtlebot3_description/urdf/turtlebot3_${TURTLEBOT3_MODEL}.urdf"
if [ -f "$URDF_FILE" ]; then
    ROBOT_DESC=$(cat "$URDF_FILE")
    for robot_id in "${ROBOT_ID_ARRAY[@]}"; do
        ros2 run robot_state_publisher robot_state_publisher \
            --ros-args \
            -r __node:=rsp_${robot_id} \
            -r __ns:=/${robot_id} \
            -p use_sim_time:=false \
            -p frame_prefix:=${robot_id}/ \
            -p "robot_description:=$ROBOT_DESC" &
        PIDS+=($!)
    done
    sleep 1
else
    echo "[entrypoint] WARNING: URDF not found at $URDF_FILE"
fi

# ── 4. Image compressor (NUM_ROBOTS already exported) ──
echo "[entrypoint] Starting image compressor..."
python3 /ros_ws/scripts/image_compressor.py &
PIDS+=($!)
sleep 1

# ── 5. rosbridge ──
echo "[entrypoint] Starting rosbridge WebSocket on port 9090..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &
PIDS+=($!)

echo ""
echo "[entrypoint] All processes started. PIDs: ${PIDS[*]}"
echo ""

wait -n "${PIDS[@]}" 2>/dev/null
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE. Stopping container."
exit $EXIT_CODE
