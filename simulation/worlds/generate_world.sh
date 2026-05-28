# Use Bash interpreter
#!/bin/bash

# Enable strict mode: exit on error, undefined vars, and pipeline failures
set -euo pipefail

# Resolve absolute path of the directory where this script resides
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Shared robot spawn utilities
source "$SCRIPT_DIR/robot_spawn_utils.sh"

# Define path to the SDF template file
TEMPLATE_FILE="$SCRIPT_DIR/turtlebot3_world.template.sdf"

# Read number of robots from first argument, default to 3
NUM_ROBOTS=${1:-3}

# Read output file path from second argument, default to /tmp
OUTPUT_FILE=${2:-/tmp/turtlebot3_world.generated.sdf}

# Ensure the output directory exists
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Create a secure temporary file to accumulate <include> blocks
INCLUDES_FILE=$(mktemp)

# Define cleanup routine to remove temporary file
cleanup() {
    rm -f "$INCLUDES_FILE"
}

# Register cleanup to run always on script exit (success or failure)
trap cleanup EXIT

# Loop over robot indices from 0 to NUM_ROBOTS-1
for ((i = 0; i < NUM_ROBOTS; i++)); do

    # Calculate spawn pose for this robot using utility function
    read -r x y z yaw < <(get_robot_spawn_pose "$i")

    # Append generated robot <include> block to temporary file using heredoc
    cat >>"$INCLUDES_FILE" <<EOF
    <include>
      <uri>model://turtlebot3_waffle_$i</uri>
      <pose>${x} ${y} ${z} 0 0 ${yaw}</pose>
    </include>
EOF

done

# Insert generated includes at placeholder, remove placeholder, write to output file
sed "/{{ROBOT_INCLUDES}}/r $INCLUDES_FILE" "$TEMPLATE_FILE" | \
sed '/{{ROBOT_INCLUDES}}/d' >"$OUTPUT_FILE"

# Print summary of generated world file
echo "Generated world: $OUTPUT_FILE ($NUM_ROBOTS robots)"