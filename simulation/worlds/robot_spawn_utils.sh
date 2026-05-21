#!/bin/bash

get_robot_spawn_pose() {

    local robot_id="$1"

    local x=$(( (robot_id % 3) - 1 ))

    local y=$(( robot_id / 3 ))

    y=$(( y * -1 ))

    local yaw="0"

    case $((robot_id % 4)) in
        1) yaw="1.5708" ;;
        2) yaw="3.1416" ;;
        3) yaw="-1.5708" ;;
    esac

    echo "$x $y 0.01 $yaw"
}