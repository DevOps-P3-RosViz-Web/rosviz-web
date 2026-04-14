#!/bin/bash
# Usage:
#   ./generate_robots.sh                 # uses ROBOT_IDS or NUM_ROBOTS
#   ./generate_robots.sh 4               # creates tb3_0..tb3_3
#   ROBOT_IDS=tb3_0,alpha ./generate_robots.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/templates"
GENERATED_DIR="$SCRIPT_DIR/generated"
TEMPLATE="$TEMPLATE_DIR/turtlebot3_waffle"

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

read -r -a ROBOT_ID_ARRAY <<< "$(parse_robot_ids "${1:-}")"
mkdir -p "$GENERATED_DIR"

for robot_id in "${ROBOT_ID_ARRAY[@]}"; do
    model_name="turtlebot3_waffle_${robot_id}"
    out_dir="$GENERATED_DIR/$model_name"

    rm -rf "$out_dir"
    cp -r "$TEMPLATE" "$out_dir"

    sed -i "s/tb3_0/${robot_id}/g; s/turtlebot3_waffle_0/${model_name}/g" "$out_dir/model.sdf"
    sed -i "s|<name>turtlebot3_waffle</name>|<name>${model_name}</name>|g" "$out_dir/model.config"

    echo "Generated ${model_name}"
done
