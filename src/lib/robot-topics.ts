const TOPIC_SUFFIXES = [
  '/odom',
  '/imu',
  '/scan',
  '/camera/image_raw',
  '/camera/image_raw/compressed',
  '/cmd_vel',
  '/tf',
  '/joint_states'
];

export function resolveRobotTopic(robotId: string, topic: string): string {
  const normalizedTopic = topic.startsWith('/') ? topic : `/${topic}`;
  const prefix = `/${robotId}`;

  if (normalizedTopic === prefix || normalizedTopic.startsWith(`${prefix}/`)) {
    return normalizedTopic;
  }

  return `${prefix}${normalizedTopic}`;
}

export function extractRobotIdsFromTopics(topics: string[]): string[] {
  const robotIds = new Set<string>();

  for (const topic of topics) {
    for (const suffix of TOPIC_SUFFIXES) {
      if (!topic.endsWith(suffix)) {
        continue;
      }

      const prefix = topic.slice(0, topic.length - suffix.length);
      if (!prefix.startsWith('/') || prefix.length <= 1) {
        continue;
      }

      const candidate = prefix.slice(1);
      if (/^[A-Za-z0-9_]+$/.test(candidate)) {
        robotIds.add(candidate);
      }
    }
  }

  return Array.from(robotIds).sort();
}
