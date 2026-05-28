#!/bin/bash
# =============================================================
#  ROSViz Web — ROS Stack Entrypoint
# =============================================================
#  Launches all ROS 2 / Gazebo processes in a single container.
#  Each process runs in the background; the script waits for all.
#  If any process exits, the container stops.
# =============================================================
set -e # Not -u to allow unset env vars like TURTLEBOT3_MODEL and not -o to allow pipefail since some commands may not output anything
source /opt/ros/humble/setup.bash

# ── Strip Windows CRLF from volume-mounted scripts ──
# simulation/ and scripts/ are bind-mounted from a Windows host, so the
# Dockerfile's sed pass is overridden at runtime. Strip here instead.
find /ros_ws/simulation /ros_ws/scripts -name "*.sh" -exec sed -i 's/\r$//' {} + 2>/dev/null || true

# ── Multi-robot config ──
export NUM_ROBOTS=${NUM_ROBOTS:-3}
export IGN_GAZEBO_RESOURCE_PATH="/ros_ws/simulation/models:${IGN_GAZEBO_RESOURCE_PATH:-}"

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  ROSViz Web — ROS Stack                     │"
echo "  │  Robots   : $NUM_ROBOTS x TurtleBot3 $TURTLEBOT3_MODEL          │"
echo "  └─────────────────────────────────────────────┘"
echo ""

PIDS=()
WORLD_FILE=/tmp/turtlebot3_world.generated.sdf
cleanup() {
    echo "[entrypoint] Shutting down all processes..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait
    echo "[entrypoint] All processes stopped."
}
trap cleanup SIGINT SIGTERM EXIT

# ── 0. Generate per-robot model folders + dynamic world ──
echo "[entrypoint] Generating $NUM_ROBOTS robot model folders..."
bash /ros_ws/simulation/models/generate_robots.sh "$NUM_ROBOTS"
bash /ros_ws/simulation/worlds/generate_world.sh "$NUM_ROBOTS" "$WORLD_FILE"

# ── 1. Ignition Gazebo ──
echo "[entrypoint] Starting Ignition Gazebo (headless)..."
ign gazebo -s -r "$WORLD_FILE" &
PIDS+=($!)
sleep 5

# ── 2. ros_gz_bridge — namespaced per robot, /tf remapped shared ──
echo "[entrypoint] Starting ros_gz_bridge..."
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
        "/tb3_$i/camera/camera_info@sensor_msgs/msg/CameraInfo[ignition.msgs.CameraInfo"
        "/tb3_$i/camera/depth/image_rect_raw@sensor_msgs/msg/Image[ignition.msgs.Image"
        "/tb3_$i/camera/depth/camera_info@sensor_msgs/msg/CameraInfo[ignition.msgs.CameraInfo"
        "/tb3_$i/camera/depth/image_rect_raw/points@sensor_msgs/msg/PointCloud2[ignition.msgs.PointCloudPacked"
        "/tb3_$i/joint_states@sensor_msgs/msg/JointState[ignition.msgs.Model"
        "/tb3_$i/scan/points@sensor_msgs/msg/PointCloud2[ignition.msgs.PointCloudPacked"
    )
    BRIDGE_REMAP_ARGS+=(-r "/tb3_$i/tf:=/tf")
done
ros2 run ros_gz_bridge parameter_bridge "${BRIDGE_ARGS[@]}" --ros-args "${BRIDGE_REMAP_ARGS[@]}" &
PIDS+=($!)
sleep 2


# ── 2.5 Static world -> odom anchors ──
echo "[entrypoint] Starting world -> odom anchors..."

source /ros_ws/simulation/worlds/robot_spawn_utils.sh

for ((i = 0; i < NUM_ROBOTS; i++)); do

    read -r x y z yaw <<< "$(get_robot_spawn_pose "$i")"

    ros2 run tf2_ros static_transform_publisher \
        --x "$x" \
        --y "$y" \
        --z "$z" \
        --yaw "$yaw" \
        --pitch 0.0 \
        --roll 0.0 \
        --frame-id world \
        --child-frame-id "tb3_${i}/odom" &

    PIDS+=($!)

done

sleep 1

# ── 3. robot_state_publisher — one per robot ──
echo "[entrypoint] Starting robot_state_publisher x $NUM_ROBOTS..."
URDF_FILE="/opt/ros/humble/share/turtlebot3_description/urdf/turtlebot3_${TURTLEBOT3_MODEL}.urdf"

if [ -f "$URDF_FILE" ]; then
    for i in $(seq 0 $((NUM_ROBOTS-1))); do
        ROBOT_DESC="$(xacro "$URDF_FILE" namespace:=tb3_${i}/ 2>/dev/null || true)"
        
        if [ -z "$ROBOT_DESC" ]; then
            echo "[entrypoint] WARNING: xacro expansion failed for tb3_$i, falling back to raw URDF."
            ROBOT_DESC="$(cat "$URDF_FILE")"
        fi

        ros2 run robot_state_publisher robot_state_publisher \
            --ros-args \
            -r __node:=rsp_tb3_$i \
            -r __ns:=/tb3_$i \
            -r /tf:=/tf \
            -r /tf_static:=/tf_static \
            -p use_sim_time:=true \
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

# ── 4b. Alert monitor node ──
echo "[entrypoint] Starting alert monitor node (Prometheus on :8888)..."
python3 /ros_ws/scripts/alert_monitor_node.py &
PIDS+=($!)
sleep 1

# ── 4.5 Point cloud aggregator (/tb3_i/scan/points -> /common/scan/points) ──
echo "[entrypoint] Starting point cloud aggregator..."
python3 /ros_ws/scripts/pointcloud_aggregator.py \
    --ros-args \
    -p use_sim_time:=true \
    -p num_robots:=$NUM_ROBOTS \
    -p input_topic_suffix:=/scan/points \
    -p target_frame:=world \
    -p output_topic:=/common/scan/points \
    -p transform_timeout_sec:=1.0 \
    -p publish_rate_hz:=1.0 &
PIDS+=($!)
sleep 1

# ── 4.6 Muxes for individual view topics ──
echo "[entrypoint] Starting muxes..."
build_robot_topic_list() {
    local topic_suffix="$1"
    local topics=()
    local robot_id

    for ((robot_id=0; robot_id<NUM_ROBOTS; robot_id++)); do
        topics+=("/tb3_${robot_id}/${topic_suffix}")
    done

    echo "${topics[@]}"
}

ros2 run topic_tools mux /selected/scan_points \
    $(build_robot_topic_list scan/points) \
    --ros-args -r __node:=mux_scan_points &
PIDS+=($!)

ros2 run topic_tools mux /selected/camera_image \
    $(build_robot_topic_list camera/image_raw/compressed) \
    --ros-args -r __node:=mux_camera_image &
PIDS+=($!)

ros2 run topic_tools mux /selected/camera_depth \
    $(build_robot_topic_list camera/depth/image_rect_raw/compressed) \
    --ros-args -r __node:=mux_camera_depth &
PIDS+=($!)
sleep 1

# ── Default muxes to robot 0 ──
echo "[entrypoint] Defaulting muxes to tb3_0..."
sleep 2
ros2 service call /mux_scan_points/select topic_tools_interfaces/srv/MuxSelect \
    "{topic: '/tb3_0/scan/points'}" || true
ros2 service call /mux_camera_image/select topic_tools_interfaces/srv/MuxSelect \
    "{topic: '/tb3_0/camera/image_raw/compressed'}" || true
ros2 service call /mux_camera_depth/select topic_tools_interfaces/srv/MuxSelect \
    "{topic: '/tb3_0/camera/depth/image_rect_raw/compressed'}" || true

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
