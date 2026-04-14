#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR}/templates"
GENERATED_DIR="${SCRIPT_DIR}/generated"
BASE_WORLD="${TEMPLATE_DIR}/turtlebot3_world.sdf"
OUT_WORLD="${GENERATED_DIR}/turtlebot3_world.sdf"

parse_robot_ids() {
    local -a ids=()
    local raw_ids="${ROBOT_IDS:-}"
    local count="${1:-${NUM_ROBOTS:-2}}"

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

build_include_block() {
    local -a ids=("$@")
    local idx=0

    echo "    <!-- TurtleBot3 robots (generated) -->"
    for robot_id in "${ids[@]}"; do
        local row=$((idx / 3))
        local col=$((idx % 3))
        local x
        local y
        local yaw
        x=$(awk "BEGIN { printf \"%.3f\", (${col} - 1) * 1.5 }")
        y=$(awk "BEGIN { printf \"%.3f\", (${row} - 1) * 1.5 }")
        yaw=$(awk "BEGIN { printf \"%.4f\", (${idx} % 8) * 0.785398 }")

        cat <<EOF
    <include>
      <uri>model://turtlebot3_waffle_${robot_id}</uri>
      <pose>${x} ${y} 0.01 0 0 ${yaw}</pose>
    </include>
EOF
        idx=$((idx + 1))
    done
}

main() {
    read -r -a robot_ids <<< "$(parse_robot_ids "${1:-}")"
    include_block="$(build_include_block "${robot_ids[@]}")"
    mkdir -p "$GENERATED_DIR"

    awk -v includes="$include_block" '
        /<\/world>/ {
            print includes
            print $0
            next
        }
        { print $0 }
    ' "$BASE_WORLD" > "$OUT_WORLD"

    echo "Generated world file: $OUT_WORLD"
}

main "$@"
