#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# TurtleBot3 Model Generator
#
# Generates:
#   turtlebot3_waffle_0
#   turtlebot3_waffle_1
#   ...
#
# using a template folder containing placeholders:
#
#   {{ROBOT_MODEL_NAME}}
#   {{ROBOT_NAMESPACE}}
#
# Usage:
#   ./generate_robots.sh 3
#
# -----------------------------------------------------------------------------

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TEMPLATE_DIR="${SCRIPT_DIR}/turtlebot3_waffle"
NUM_ROBOTS="${1:-2}"

MODEL_SDF="model.sdf"
MODEL_CONFIG="model.config"

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

if [[ ! -d "${TEMPLATE_DIR}" ]]; then
    echo "[ERROR] Template directory not found:"
    echo "        ${TEMPLATE_DIR}"
    exit 1
fi

if [[ ! -f "${TEMPLATE_DIR}/${MODEL_SDF}" ]]; then
    echo "[ERROR] Missing ${MODEL_SDF} in template"
    exit 1
fi

if [[ ! -f "${TEMPLATE_DIR}/${MODEL_CONFIG}" ]]; then
    echo "[ERROR] Missing ${MODEL_CONFIG} in template"
    exit 1
fi

# -----------------------------------------------------------------------------
# Generation
# -----------------------------------------------------------------------------

echo ""
echo "Generating ${NUM_ROBOTS} TurtleBot3 models..."
echo ""

for ((i=0; i<NUM_ROBOTS; i++)); do

    ROBOT_NAMESPACE="tb3_${i}"
    ROBOT_MODEL_NAME="turtlebot3_waffle_${i}"

    OUTPUT_DIR="${SCRIPT_DIR}/${ROBOT_MODEL_NAME}"

    echo "[INFO] Generating ${ROBOT_MODEL_NAME}"

    # -------------------------------------------------------------------------
    # Recreate directory
    # -------------------------------------------------------------------------

    rm -rf "${OUTPUT_DIR}"
    cp -r "${TEMPLATE_DIR}" "${OUTPUT_DIR}"

    # -------------------------------------------------------------------------
    # Replace placeholders in SDF
    # -------------------------------------------------------------------------

    sed -i \
        -e "s|{{ROBOT_NAMESPACE}}|${ROBOT_NAMESPACE}|g" \
        -e "s|{{ROBOT_MODEL_NAME}}|${ROBOT_MODEL_NAME}|g" \
        "${OUTPUT_DIR}/${MODEL_SDF}"

    # -------------------------------------------------------------------------
    # Update model.config in output directory
    # -------------------------------------------------------------------------

    sed -i \
        -e "s|turtlebot3_waffle|${ROBOT_MODEL_NAME}|g" \
        "${OUTPUT_DIR}/${MODEL_CONFIG}"

    echo "[OK] ${ROBOT_MODEL_NAME}"

done

echo ""
echo "Done."
echo ""