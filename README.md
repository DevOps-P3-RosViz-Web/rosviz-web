# ROSViz Web

A real-time web dashboard for monitoring and controlling ROS 2 robots. Built with Next.js + React + Three.js on the frontend, talking to rosbridge over a WebSocket. The repository ships a Docker-compose stack that spins up ROS 2 Humble + Ignition Gazebo Fortress + a simulated TurtleBot3 Waffle alongside the dashboard, so you can get a working demo in two commands on any machine with Docker.

![ROS 2](https://img.shields.io/badge/ROS_2-Humble-blue) ![Gazebo](https://img.shields.io/badge/Gazebo-Fortress-orange) ![Container_OS](https://img.shields.io/badge/Container-Ubuntu_22.04-purple) ![Next.js](https://img.shields.io/badge/Next.js-15-black) ![Node.js](https://img.shields.io/badge/Node.js-20-green)

## Demo

Single-robot dashboard driving a TurtleBot3 Waffle in Ignition Gazebo Fortress:

![Single-robot demo](docs/rosviz_singleBot.gif)

## Architecture

Sensor data from Gazebo flows through a Python ROS 2 node (`scripts/alert_monitor_node.py`) that evaluates thresholds and publishes alerts on two paths simultaneously: as ROS topic messages consumed by the Next.js dashboard via rosbridge, and as Prometheus metrics scraped by Grafana. The browser's AlertHistory panel receives live alerts over the WebSocket and hydrates from the persistent history file on connect.

```
Gazebo / TurtleBot3  ──scan/odom/imu/battery──▶  alert_monitor_node.py
                                                        │
                           ┌────────────────────────────┼─────────────────────┐
                           ▼                            ▼                     ▼
                  /robot_alerts (ROS)          Prometheus :8888      /robot_alerts_history
                           │                            │                     │
                    rosbridge :9090             Grafana :3001          rosbridge :9090
                           │                            │                     │
                    Next.js dashboard ◀─────────────────┘             Next.js dashboard
                       (AlertHistory panel)                             (history hydration)
```

## Project status

### Done

- [x] **Dockerized stack.** Single `docker compose up --build` brings up ROS 2 Humble + Gazebo Fortress + rosbridge + the dashboard. CPU, AMD-GPU and NVIDIA-GPU overrides all configured.
- [x] **Realistic simulated TurtleBot3 Waffle.** Swapped the primitive-shape placeholder visuals for the real STL/DAE meshes (waffle_base, left/right tires, LDS LiDAR) shipped in `ros-humble-turtlebot3-description`.
- [x] **Intel RealSense D435 sensor.** Replaced the R200 camera mesh with the D435 from `ros-humble-realsense2-description` and added a `depth_camera` sensor beside the RGB one (640×480 @ 30 Hz, 87° HFOV, R_FLOAT32).
- [x] **Depth pipeline to the browser.** `scripts/image_compressor.py` now colorises the depth stream (turbo colormap, 0.1–5 m window) and publishes it as JPEG alongside the RGB stream — the browser consumes both via rosbridge.
- [x] **Real-time physics.** Added a `<physics>` block (4 ms step, 250 Hz) so the sim holds ~1.0 real-time factor instead of ~0.46 on a saturated host.
- [x] **Ground-robot controls.** Remapped the D-pad so ← / → publish `angular.z` (yaw) instead of `linear.y` (strafe), which the differential-drive TurtleBot3 ignores.
- [x] **Design wireframes.** Four static mockup pages under `/wireframes/…` (Fleet, Common, Robot, Sensor) scaffold the planned redesign — see the `wireframes` branch.

### In progress

- [ ] **Multi-robot simulation — partially done.** `NUM_ROBOTS=3` spawns three TurtleBot3 Waffles via `simulation/models/generate_robots.sh`, each `robot_state_publisher` runs with `frame_prefix:=tb3_<i>/`, and all bridge topics are namespaced `/tb3_<i>/…`. Remaining gaps:
  - The world file hard-codes three `<include>` entries (`turtlebot3_waffle_0`, `_1`, `_2`). Needs a generated world (or a loop in the entrypoint) so `NUM_ROBOTS` truly drives robot count.
  - Every robot publishes its TF to its own namespaced `/tb3_<i>/tf` — the recommended ROS 2 multi-robot pattern is shared `/tf` + `frame_prefix`, so a single subscription sees every robot and you can reason about inter-robot transforms in one tree ([Discourse](https://discourse.openrobotics.org/t/tf-tree-in-a-multi-robot-setup-in-ros2/41426), [Stack Exchange](https://answers.ros.org/question/405822/multi-robot-tf-with-namespaces-for-tf-or-with-frame_prefix-what-is-the-right-way-to-do-it-ros2/)). Fix is a remap on the `robot_state_publisher` and `ros_gz_bridge` so `/tb3_<i>/tf` → `/tf`.
  - The dashboard is still single-robot — see the roadmap below.

### Up next — dashboard catch-up

The ROS side already publishes per-robot namespaced topics, but the dashboard still subscribes to the old single-robot `/odom`, `/camera/image_raw/compressed`, `/imu`, `/cmd_vel`, `/scan`, `/battery_state`, `/tf` names. Priorities, in order:

- [x] **Remap per-robot TF onto a shared `/tf` tree.** Launch each `robot_state_publisher` with `--ros-args -r /tf:=/tf -r /tf_static:=/tf_static` (or equivalent in the gz bridge) so the dashboard can read every robot's pose from one `/tf` subscription. Requires `frame_prefix` (already set) so frame IDs stay unique.
- [x] **Port the wireframes into the real dashboard.** Turn the four static `/wireframes/*` pages into functional routes: `/` → Fleet Overview, `/common`, `/robot/[id]` for the per-robot Dashboard + Sensor tabs.
- [x] **Drop UAV-only controls.** Remove the altitude (↑ / ↓ `linear.z`), force-land descent, and any other drone-only buttons from `Controls.tsx` — the TurtleBot3 plugin ignores them anyway.
- [ ] **Parameterise every component by robot id.** Every `subscribe(...)` / `publish(...)` in `src/components/dashboard/**` should accept a `namespace` prop and prefix topic names with `/tb3_<i>/`. Add a robot-picker to the top bar (matches the wireframe's "Robot Red" label).
- [ ] **Wire up the Fleet Overview.** Subscribe each robot card to its own `/tb3_<i>/camera/image_raw/compressed`, `/odom`, `/battery_state` and render name / status / battery live.
- [ ] **Cross-robot panels on the Common tab.** Overlay every robot's position on one 2D map (driven by the shared `/tf` once the remap above lands), merge point clouds (colour-coded per robot), and gate the "Move all Robots" button on valid lat/lon inputs.
  - Point-cloud merge now runs server-side via `scripts/pointcloud_aggregator.py`, publishing `/common/scan/points` from all `/tb3_<i>/scan/points` inputs in a shared frame.
- [ ] **Fill the TBD sensor widgets.** Decide how to render Trajectory History (path plot from `/odom` buffer?) and Velocity Gauge (gauge of `|linear.x|` + `|angular.z|`?).
- [ ] **Camera feed with object detection.** Run YOLO (or similar) on `/tb3_<i>/camera/image_raw` inside a small ROS node, publish both the annotated JPEG (`.../image_detect/compressed`) and a structured `/camera/detections` topic (class, confidence, bbox). Dashboard adds a "Detection" tile next to RGB + Depth and optionally overlays bbox rectangles on the live feed.
- [ ] **Alert history backend.** The wireframe shows alerts but nothing produces them yet — need a source (collision / velocity thresholds / connection loss) and a ring-buffer publisher.

## Features

- **Live Camera Feed** — streaming compressed camera images with HUD telemetry overlay
- **6-Camera Grid** — multi-camera view with maximize/minimize per feed
- **3D Robot Model** — URDF-based robot visualization using Three.js, updated via TF
- **LiDAR Point Cloud** — real-time 3D point cloud rendering from `PointCloud2` messages
- **Telemetry Panel** — 12-card grid: position, orientation, velocities from odometry + IMU
- **Depth Data** — LaserScan range statistics with live chart
- **Battery Monitor** — voltage tracking with time-series graph
- **2D Map** — Leaflet-based map view with robot marker
- **Robot Controls** — D-pad, speed slider, waypoints, emergency stop, publishing to `/cmd_vel`
- **Resizable Panels** — drag-to-resize layout using split.js + react-resizable-panels

## Tested Environment

| Layer | Version |
| --- | --- |
| Host OS | Any Linux with Docker 20+ (tested on Ubuntu 22.04 and 24.04) |
| Docker / Compose | Docker 20+, Compose v2+ |
| Container ROS 2 | Humble Hawksbill |
| Container OS | Ubuntu 22.04 (Jammy) |
| Simulator | Ignition Gazebo Fortress |
| Robot | TurtleBot3 Waffle |
| Bridge | rosbridge_suite (WebSocket on port 9090) |
| Dashboard runtime | Node.js 20 (in container) / Next.js 15 |
| Browser | Chromium / Chrome |

## Quick start (Docker — recommended)

### Prerequisites

- Docker Engine 20+ and Docker Compose v2+
- (Optional) a dedicated GPU + driver for hardware rendering — see the [rendering modes](#rendering-modes) table below

### 1. Clone the repository

```bash
git clone https://github.com/prakash-aryan/rosviz-web.git
cd rosviz-web
```

### 2. Pick a rendering mode and launch

### Rendering modes

All three modes bring up the same **ros-stack** (Gazebo Fortress + rosbridge + bridges + robot_state_publisher + image_compressor) and **dashboard** (Next.js on `http://localhost:3000`). The difference is how Gazebo's sensor camera renders.

| Mode | Command | Sensor rendering | Gazebo GUI window |
| --- | --- | --- | --- |
| **CPU** (default) | `docker compose up --build` | Mesa software (llvmpipe) — slow | Not supported (headless) |
| **AMD GPU** | `docker compose -f docker-compose.yml -f docker-compose.amdgpu.yml up --build` | Mesa `radeonsi` via `/dev/dri` | Not supported (headless) |
| **NVIDIA GPU** | `docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up --build` | NVIDIA OpenGL via Container Toolkit | Supported via X11 forwarding |

First build pulls the ROS 2 Humble base image and installs Gazebo Fortress + TurtleBot3 packages — expect 5–15 min depending on bandwidth. Subsequent runs are cached and start in seconds. Once the logs report `Ready`, open <http://localhost:3000>.

#### AMD-GPU prerequisites

```bash
# Kernel module loaded?
lsmod | grep amdgpu

# Add your user to the video + render groups (then log out/in)
sudo usermod -aG video,render "$USER"
```

> `docker-compose.amdgpu.yml` sets `group_add: ["303", "26"]`. If your host's `video` / `render` GIDs differ, edit those two values (check with `getent group video render`).

#### NVIDIA-GPU prerequisites

1. NVIDIA proprietary driver installed (`nvidia-smi` should print the GPU). Driver 525+ recommended.
2. [NVIDIA Container Toolkit 1.14+](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) — installs `libnvidia-container1` and registers the `nvidia` runtime with Docker:

   ```bash
   # Abbreviated — see the linked install guide for the full repo setup
   sudo apt install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```

3. To view the Gazebo GUI on your desktop, also allow X11 connections from Docker:

   ```bash
   xhost +local:root
   ```

   Once the stack is up, launch the GUI client inside the ros container:

   ```bash
   docker exec -d rosviz-ros bash -c "source /opt/ros/humble/setup.bash && ign gazebo -g"
   ```

### Shut down

```bash
docker compose down
```

### Editing code with hot reload

Source folders are bind-mounted into the containers, so host edits propagate:

| Edit | Effect |
| --- | --- |
| `src/`, `public/` | Next.js hot-reloads automatically |
| `simulation/`, `scripts/` | Restart the ros-stack: `docker compose restart ros-stack` |
| `docker/`, `package.json`, `Dockerfile*` | Rebuild: `docker compose up -d --build` |

## Native install (without Docker)

Use this path only if you want to run ROS 2 and Gazebo directly on the host — the Docker path is simpler and is what the demo GIF uses.

### System prerequisites

- Ubuntu 22.04 (Humble and Fortress have apt packages only for Jammy)
- Node.js 20+ and npm
- ROS 2 Humble — [install guide](https://docs.ros.org/en/humble/Installation/Ubuntu-Install-Debs.html)
- Ignition Gazebo Fortress — [install guide](https://gazebosim.org/docs/fortress/install_ubuntu)

### ROS 2 packages

```bash
sudo apt install \
  ros-humble-turtlebot3* \
  ros-humble-robot-state-publisher \
  ros-humble-image-transport \
  ros-humble-rosbridge-suite \
  ros-humble-ros-gz-bridge \
  ros-humble-ros-gz-sim
```

> If you don't have sudo, build `rosbridge_suite` and `ros_gz` from source in a colcon workspace. See [Building ROS packages from source](#building-ros-packages-from-source) below.

### Python deps (for the image compression node)

```bash
pip3 install opencv-python numpy
```

### Install dashboard deps

```bash
npm install
```

### Run everything (6 terminals)

**Terminal 1 — Ignition Gazebo (headless)**

```bash
source /opt/ros/humble/setup.bash
export IGN_GAZEBO_RESOURCE_PATH=$(pwd)/simulation/models
bash simulation/worlds/generate_world.sh "${NUM_ROBOTS:-3}" /tmp/turtlebot3_world.generated.sdf
ign gazebo -s -r /tmp/turtlebot3_world.generated.sdf
```

**Terminal 2 — ros_gz_bridge**

```bash
source /opt/ros/humble/setup.bash
ros2 run ros_gz_bridge parameter_bridge \
  /cmd_vel@geometry_msgs/msg/Twist]ignition.msgs.Twist \
  /odom@nav_msgs/msg/Odometry[ignition.msgs.Odometry \
  /tf@tf2_msgs/msg/TFMessage[ignition.msgs.Pose_V \
  /scan@sensor_msgs/msg/LaserScan[ignition.msgs.LaserScan \
  /imu@sensor_msgs/msg/Imu[ignition.msgs.IMU \
  /camera/image_raw@sensor_msgs/msg/Image[ignition.msgs.Image \
  /joint_states@sensor_msgs/msg/JointState[ignition.msgs.Model \
  /scan/points@sensor_msgs/msg/PointCloud2[ignition.msgs.PointCloudPacked
```

**Terminal 3 — Image compressor (raw → JPEG for the browser)**

```bash
source /opt/ros/humble/setup.bash
python3 scripts/image_compressor.py
```

**Terminal 4 — Robot state publisher**

```bash
source /opt/ros/humble/setup.bash
ros2 run robot_state_publisher robot_state_publisher \
  --ros-args -p use_sim_time:=false \
  -p "robot_description:=$(cat /opt/ros/humble/share/turtlebot3_description/urdf/turtlebot3_waffle.urdf)"
```

**Terminal 5 — rosbridge WebSocket server**

```bash
source /opt/ros/humble/setup.bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

**Terminal 6 — Dashboard**

```bash
npm run dev
```

## Tauri Development

With Tauri you can develop and build the desktop version of this app.

1. Install system dependencies and Rust, see [Prerequisites | Tauri](https://v2.tauri.app/start/prerequisites/#linux).
2. Install dependencies: `npm install`
3. Run the app: `npm run tauri dev`

Run `npm run tauri build` to build the desktop application (deb, rpm, and AppImage).

## Project structure

```
rosviz-web/
├── docker/
│   ├── Dockerfile.dashboard        # Next.js dashboard container
│   ├── Dockerfile.ros              # ROS 2 + Gazebo container
│   └── ros-entrypoint.sh           # Boots Gazebo + bridges + rosbridge
├── docker-compose.yml              # CPU-rendering stack (default)
├── docker-compose.amdgpu.yml       # AMD Radeon GPU override (layer on top)
├── docker-compose.nvidia.yml       # NVIDIA GPU + X11 GUI forwarding override
├── docs/
│   └── rosviz_singleBot.gif        # Demo shown in this README
├── public/
│   └── meshes/turtlebot3/          # STL meshes for the browser's 3D robot model
├── scripts/
│   ├── alert_monitor_node.py       # ROS 2 node: threshold evaluation + alert publishing
│   ├── image_compressor.py         # ROS 2 node: raw Image → JPEG CompressedImage
│   └── inject_test_alerts.py       # CLI tool: inject synthetic alerts for pipeline testing
├── simulation/
│   ├── launch_all.sh               # Native one-command launcher
│   ├── models/
│   │   └── turtlebot3_waffle/      # Ignition Gazebo SDF model
│   └── worlds/
│       ├── turtlebot3_world.template.sdf  # Static room template with include placeholder
│       └── generate_world.sh              # Builds a world file for NUM_ROBOTS robots
├── src/
│   ├── app/                        # Next.js App Router pages + layout
│   ├── components/
│   │   ├── dashboard/              # React dashboard panels
│   │   │   ├── Controls.tsx        # D-pad, speed slider, waypoints, e-stop
│   │   │   ├── TelemetryPanel.tsx  # 12-card telemetry grid
│   │   │   ├── VideoGrid.tsx       # Multi-camera grid view
│   │   │   ├── VideoStream.tsx     # Single compressed image stream
│   │   │   ├── MapView.tsx         # 2D Leaflet map
│   │   │   └── sensor-components/  # Battery, depth, robot model, point cloud, video feed
│   │   └── ui/                     # shadcn-style primitives
│   ├── hooks/useROS.ts             # React hook for rosbridge connection
│   ├── lib/rosbridge.ts            # WebSocket client singleton
│   └── types/ros.ts                # ROS message type definitions
├── package.json
└── README.md
```

## ROS topics used

| Topic | Type | Direction | Description |
|---|---|---|---|
| `/odom` | `nav_msgs/Odometry` | Sub | Robot odometry (position, velocity) |
| `/tf` | `tf2_msgs/TFMessage` | Sub | Transform tree for the 3D model |
| `/scan` | `sensor_msgs/LaserScan` | Sub | LiDAR range data |
| `/scan/points` | `sensor_msgs/PointCloud2` | Sub | LiDAR point cloud |
| `/common/scan/points` | `sensor_msgs/PointCloud2` | Sub | Aggregated multi-robot LiDAR cloud (Common tab) |
| `/imu` | `sensor_msgs/Imu` | Sub | IMU orientation + angular velocity |
| `/camera/image_raw/compressed` | `sensor_msgs/CompressedImage` | Sub | JPEG camera feed |
| `/battery_state` | `sensor_msgs/BatteryState` | Sub | Voltage, percentage |
| `/robot_description` | `std_msgs/String` | Param | URDF for the 3D model |
| `/cmd_vel` | `geometry_msgs/Twist` | Pub | Velocity commands to the robot |

## Alert types

The `alert_monitor_node` evaluates eight conditions. Thresholds are all configurable via environment variables (see `.env.example`).

| Alert Type | Severity | Trigger condition | Operator action |
|---|---|---|---|
| `COLLISION` | Critical | Laser scan min range < dynamic threshold (footprint + margin + speed × reaction time) | Stop robot; clear obstruction |
| `VELOCITY_EXCEEDED` | Warning | Linear speed > `ALERT_VEL_LINEAR_MAX` or angular speed > `ALERT_VEL_ANGULAR_MAX` | Reduce commanded velocity |
| `CONNECTION_LOSS` | Critical | No sensor data received for > `ALERT_CONN_TIMEOUT_S` seconds | Check network; restart rosbridge |
| `LOW_BATTERY` | Warning | Battery % < `ALERT_BATTERY_PCT_MIN` or voltage < `ALERT_BATTERY_VOLT_MIN` | Return to dock; swap battery |
| `IMPACT_DETECTED` | Warning | Horizontal IMU acceleration > `ALERT_IMPACT_ACCEL_MS2` m/s² | Inspect for collision damage |
| `TILT_WARNING` | Critical | Roll or pitch angle > `ALERT_TILT_DEG` degrees | Stop robot; check terrain |
| `MOTOR_STALL` | Warning | Wheel velocity near zero while active drive command is present for > `ALERT_STALL_DURATION_S` s | Clear obstruction; check motors |
| `GEOFENCE_BREACH` | Critical | Robot position outside configured bounding box (`ALERT_GEOFENCE_*`) | Stop robot; return to safe zone |

To test the full alert pipeline without a running simulation:

```bash
docker exec rosviz-ros python3 /ros_ws/scripts/inject_test_alerts.py --all
# or a specific type:
docker exec rosviz-ros python3 /ros_ws/scripts/inject_test_alerts.py --type COLLISION --robot-id 1
```

## Troubleshooting

**Alerts not appearing in the dashboard**
Check the green/red connection dot in the AlertHistory panel header. If red, verify `ws://localhost:9090` is reachable and the ros-stack container is up: `docker compose ps`. Check logs: `docker compose logs rosviz-ros`.

**Grafana shows no data / "No data" panels**
Check the Prometheus scrape target at `http://localhost:9091/targets` — the `ros-stack` job should be green. Verify the ros-stack container is healthy: `docker compose ps`. If the target is down, wait for the `start_period` healthcheck (30 s) to pass.

**The same alert fires repeatedly / alert spam**
The sensor reading may be oscillating near the threshold. Increase `ALERT_REFIRE_COOLDOWN_S` in `.env` (default 10 s). You can also inspect the Grafana `for: 10s` stability window — it only fires after the condition holds for 10 consecutive seconds.

**Alert history is empty after restarting the stack**
Confirm the `alert-data` Docker volume exists: `docker volume ls | grep alert-data`. Inspect the file inside the container: `docker exec rosviz-ros cat /data/alert_history.json`. If the file is missing, ensure `ALERT_HISTORY_FILE=/data/alert_history.json` is set and the volume is mounted in `docker-compose.yml`.

**Disk usage growing unexpectedly**
Set `PROMETHEUS_RETENTION` in `.env` (default 30 d) and restart Prometheus. Check the TSDB status page at `http://localhost:9091/tsdb-status` to see which series are consuming the most space.

**Auto-stop not working**
The auto-stop toggle in the AlertHistory panel publishes to `/safety_auto_stop`. Verify the toggle shows "Auto-stop ON". Auto-stop only fires a zero-velocity command for `critical` alerts — warning-level alerts do not trigger it.

**Suppressing alerts during planned maintenance**
Edit `monitoring/grafana/provisioning/alerting/alert_rules.yml` and populate `time_intervals` under `maintenance-window` with your maintenance schedule, then `docker compose restart grafana`. Set `time_intervals: []` to deactivate. The mute timing appears under `http://localhost:3001/alerting/notifications` for verification.

## Customizing topics

All topic names are defined in the component files under `src/components/dashboard/`. Each component's `useEffect` / `subscribe` call specifies the topic name and message type — change them to match your robot's namespace.

The default rosbridge WebSocket URL (`ws://localhost:9090`) is set in `src/hooks/useROS.ts`.

For the Common tab cloud merge, verify the aggregator with:

```bash
ros2 topic info /common/scan/points
ros2 topic echo /common/scan/points --once
```

The aggregator node is `scripts/pointcloud_aggregator.py` and uses:
- `num_robots`
- `input_topic_suffix` (default `/scan/points`)
- `target_frame` (default `world`)
- `output_topic` (default `/common/scan/points`)
- `publish_rate_hz` (default `8.0`)

## Building ROS packages from source

If you can't install via apt (e.g., no sudo), build the bridges in a colcon workspace:

```bash
mkdir -p ~/turtlebot3_ws/src && cd ~/turtlebot3_ws/src

# rosbridge_suite
git clone https://github.com/RobotWebTools/rosbridge_suite.git -b ros2

# ros_gz (Fortress)
git clone https://github.com/gazebosim/ros_gz.git -b humble

# Dependencies ros_gz may need
git clone https://github.com/rudislabs/actuator_msgs.git
git clone https://github.com/swri-robotics/gps_umd.git

cd ~/turtlebot3_ws
source /opt/ros/humble/setup.bash
colcon build --cmake-args -DBUILD_TESTING=OFF
source install/setup.bash
```

## License

[MIT](LICENSE)
